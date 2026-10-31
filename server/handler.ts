// The AI proxy: a single Fetch-standard handler that runs on Cloudflare Pages Functions,
// in the Vite dev server, or any runtime with Request/Response.
// It holds the API key, enforces size and rate limits, and re-validates model output.
import {
  AiRequestSchema,
  BreakdownWireSchema,
  DumpWireSchema,
  FinishWireSchema,
  EasierWireSchema,
  InvalidOutputError,
  LIMITS,
  RefineWireSchema,
  normalizeBreakdown,
  normalizeDump,
  normalizeEasier,
  normalizeFinish,
  normalizeRefine,
  type AiErrorBody,
  type AiErrorCode,
  type AiRequest,
  type AiResult,
} from '../src/ai/schemas.ts';
import { createAnthropicProvider } from './anthropic.ts';
import { systemPrompt, userPrompt } from './prompts.ts';
import { ProviderError, type AiProvider } from './provider.ts';

export interface ProxyEnv {
  ANTHROPIC_API_KEY?: string;
  AI_MODEL?: string;
  APP_ACCESS_CODE?: string;
}

export interface HandlerOptions {
  /** Inject a provider (tests). Defaults to Anthropic when a key is configured. */
  provider?: AiProvider;
  rateLimiter?: RateLimiter;
  deadlineMs?: number;
}

const STATUS: Record<AiErrorCode, number> = {
  invalid_request: 400,
  too_large: 413,
  access_required: 401,
  rate_limited: 429,
  not_configured: 503,
  auth_failed: 502,
  provider_unavailable: 502,
  timeout: 504,
  invalid_output: 502,
  refused: 422,
  network: 502,
};

const MESSAGES: Record<AiErrorCode, string> = {
  invalid_request: 'That request could not be processed.',
  too_large: 'That was too long to send.',
  access_required: 'An access code is needed to use AI.',
  rate_limited: 'AI is busy. Try again in a bit.',
  not_configured: "AI isn't set up on this server.",
  auth_failed: "AI isn't set up correctly right now.",
  provider_unavailable: "AI isn't available right now.",
  timeout: 'AI took too long.',
  invalid_output: "AI couldn't produce usable steps this time.",
  refused: "AI couldn't help with this one.",
  network: "AI isn't available right now.",
};

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extra,
    },
  });
}

function fail(code: AiErrorCode, retryAfterSec?: number): Response {
  const body: AiErrorBody = {
    ok: false,
    error: { code, message: MESSAGES[code], ...(retryAfterSec ? { retryAfterSec } : {}) },
  };
  return json(body, STATUS[code], retryAfterSec ? { 'retry-after': String(retryAfterSec) } : {});
}

/** Simple sliding-window limiter. Per isolate only: a best-effort guard, not a hard quota. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  constructor(limit = 30, windowMs = 60 * 60 * 1000) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  check(key: string, now = Date.now()): { ok: true } | { ok: false; retryAfterSec: number } {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      const retryAfterSec = Math.ceil((this.windowMs - (now - recent[0]!)) / 1000);
      this.hits.set(key, recent);
      return { ok: false, retryAfterSec };
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) this.hits.clear(); // bound memory
    return { ok: true };
  }
}

const defaultLimiter = new RateLimiter();

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function runOnce(
  provider: AiProvider,
  req: AiRequest,
  signal: AbortSignal,
): Promise<AiResult> {
  const system = systemPrompt(req.kind);
  const user = userPrompt(req);
  if (req.kind === 'breakdown') {
    const raw = await provider.generate({
      system,
      user,
      schema: BreakdownWireSchema,
      maxTokens: 4000,
      signal,
    });
    return normalizeBreakdown(raw);
  }
  if (req.kind === 'refine') {
    const raw = await provider.generate({
      system,
      user,
      schema: RefineWireSchema,
      maxTokens: 4000,
      signal,
    });
    return normalizeRefine(raw, new Set(req.steps.map((s) => s.id)));
  }
  if (req.kind === 'dump') {
    const raw = await provider.generate({
      system,
      user,
      schema: DumpWireSchema,
      maxTokens: 3000,
      signal,
    });
    return normalizeDump(raw);
  }
  if (req.kind === 'finish') {
    const raw = await provider.generate({
      system,
      user,
      schema: FinishWireSchema,
      maxTokens: 2000,
      signal,
    });
    const eligible = req.steps.filter((s) => s.status === 'todo' && s.tier === 'required');
    return normalizeFinish(raw, new Set(eligible.map((s) => s.id)));
  }
  const raw = await provider.generate({
    system,
    user,
    schema: EasierWireSchema,
    maxTokens: 2000,
    signal,
  });
  return normalizeEasier(raw);
}

export async function handleAiRequest(
  request: Request,
  env: ProxyEnv,
  opts: HandlerOptions = {},
): Promise<Response> {
  if (request.method !== 'POST')
    return json({ ok: false, error: { code: 'invalid_request', message: 'POST only' } }, 405);
  if (!(request.headers.get('content-type') ?? '').includes('application/json'))
    return fail('invalid_request');

  const accessCode = env.APP_ACCESS_CODE?.trim();
  if (accessCode && !timingSafeEqual(request.headers.get('x-access-code') ?? '', accessCode)) {
    return fail('access_required');
  }

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > LIMITS.bodyBytes) return fail('too_large');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > LIMITS.bodyBytes) return fail('too_large');

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail('invalid_request');
  }
  const parsed = AiRequestSchema.safeParse(body);
  if (!parsed.success) return fail('invalid_request');

  const ip =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'local';
  const limited = (opts.rateLimiter ?? defaultLimiter).check(ip);
  if (!limited.ok) return fail('rate_limited', limited.retryAfterSec);

  let provider = opts.provider;
  if (!provider) {
    if (!env.ANTHROPIC_API_KEY) return fail('not_configured');
    provider = createAnthropicProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      ...(env.AI_MODEL ? { model: env.AI_MODEL } : {}),
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.deadlineMs ?? 20_000);
  try {
    let result: AiResult;
    try {
      result = await runOnce(provider, parsed.data, controller.signal);
    } catch (err) {
      // One bounded retry, only for unusable output.
      if (!(err instanceof InvalidOutputError) || controller.signal.aborted) throw err;
      result = await runOnce(provider, parsed.data, controller.signal);
    }
    return json({ ok: true, result }, 200);
  } catch (err) {
    if (controller.signal.aborted) return fail('timeout');
    if (err instanceof InvalidOutputError) return fail('invalid_output');
    if (err instanceof ProviderError) return fail(err.code, err.retryAfterSec);
    // Log the category only: never task text.
    console.error('ai-proxy: unexpected error', err instanceof Error ? err.name : typeof err);
    return fail('provider_unavailable');
  } finally {
    clearTimeout(timer);
  }
}
