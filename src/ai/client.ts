// App-side AI orchestration. Decides between live AI, demo mode, and offline fallbacks,
// and validates everything that comes back before the domain layer sees it.
import { uuidv7 } from '../domain/ids';
import { previewRefinement, type RefineOp, type RefinePreview } from '../domain/plan';
import { easierStep, templateSteps } from '../domain/templates';
import type { AppSettings, StepOrigin, Task, TaskStep } from '../domain/types';
import { demoBreakdown, demoEasier } from './demo';
import { ruleBasedRefine } from './rules';
import {
  LIMITS,
  normalizeBreakdown,
  normalizeEasier,
  normalizeRefine,
  type AiErrorCode,
  type AiRequest,
  type BreakdownResult,
  type RefineResultOp,
} from './schemas';

export const CLIENT_TIMEOUT_MS = 25_000;

export class AiError extends Error {
  constructor(
    public readonly code: AiErrorCode | 'off' | 'consent',
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

/** Plain-language message for each failure. Always paired with a fallback in the UI. */
export function friendlyAiMessage(code: AiError['code']): string {
  switch (code) {
    case 'network':
      return "You're offline or AI can't be reached.";
    case 'timeout':
      return 'AI took too long.';
    case 'rate_limited':
      return 'AI is busy right now.';
    case 'not_configured':
    case 'auth_failed':
      return "AI isn't set up yet.";
    case 'access_required':
      return 'AI needs an access code (see Settings).';
    case 'invalid_output':
      return "AI couldn't produce usable steps this time.";
    case 'refused':
      return "AI couldn't help with this one.";
    case 'too_large':
      return 'That was too long to send.';
    case 'off':
      return 'AI is turned off.';
    default:
      return "AI isn't available right now.";
  }
}

type Fetcher = typeof fetch;
let fetcher: Fetcher = (...args) => fetch(...args);
export function setFetcher(f: Fetcher): void {
  fetcher = f;
}

async function callProxy(req: AiRequest, settings: AppSettings): Promise<unknown> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new AiError('network', friendlyAiMessage('network'));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetcher('/api/ai', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(settings.aiAccessCode ? { 'x-access-code': settings.aiAccessCode } : {}),
      },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
  } catch {
    throw new AiError(
      controller.signal.aborted ? 'timeout' : 'network',
      friendlyAiMessage(controller.signal.aborted ? 'timeout' : 'network'),
    );
  } finally {
    clearTimeout(timer);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new AiError('provider_unavailable', friendlyAiMessage('provider_unavailable'));
  }
  const b = body as { ok?: boolean; result?: unknown; error?: { code?: AiErrorCode } };
  if (res.ok && b.ok === true) return b.result;
  const code = b.error?.code ?? (res.status === 429 ? 'rate_limited' : 'provider_unavailable');
  throw new AiError(code, friendlyAiMessage(code));
}

function taskContext(task: Task): AiRequest['task'] {
  return {
    title: task.title.slice(0, LIMITS.title),
    ...(task.barrier ? { barrier: task.barrier } : {}),
    ...(Object.keys(task.constraints).length ? { constraints: task.constraints } : {}),
  };
}

function ensureLiveAllowed(settings: AppSettings): void {
  if (settings.aiMode === 'off') throw new AiError('off', friendlyAiMessage('off'));
  if (settings.aiMode === 'live' && !settings.aiConsentAt) {
    throw new AiError('consent', 'Needs your OK before sending task text.');
  }
}

// Short-lived cache so repeat requests for the same task don't cost twice.
const cache = new Map<string, { at: number; value: BreakdownResult }>();
const CACHE_MS = 10 * 60 * 1000;
export function clearAiCache(): void {
  cache.clear();
}

export interface PlanOutcome {
  result: BreakdownResult;
  origin: StepOrigin;
  /** Set when we fell back to quick steps, explaining why. */
  fallbackReason?: string;
}

/** Breaks a task down. Never throws for AI problems: falls back to quick template steps. */
export async function generatePlan(task: Task, settings: AppSettings): Promise<PlanOutcome> {
  const fallback = (reason?: string): PlanOutcome => ({
    result: { steps: templateSteps(task.title, task.barrier), firstStepIndex: 0 },
    origin: 'template',
    ...(reason ? { fallbackReason: reason } : {}),
  });
  if (settings.aiMode === 'off') return fallback();
  if (settings.aiMode === 'demo') {
    return { result: demoBreakdown(task.title), origin: 'demo' };
  }
  try {
    ensureLiveAllowed(settings);
    const key = JSON.stringify(taskContext(task));
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return { result: hit.value, origin: 'ai' };
    const raw = await callProxy({ kind: 'breakdown', task: taskContext(task) }, settings);
    const result = normalizeBreakdown(raw);
    cache.set(key, { at: Date.now(), value: result });
    return { result, origin: 'ai' };
  } catch (err) {
    if (err instanceof AiError && err.code === 'consent') throw err;
    const code = err instanceof AiError ? err.code : 'invalid_output';
    return fallback(friendlyAiMessage(code));
  }
}

export interface RefineOutcome {
  preview: RefinePreview;
  summary: string;
  origin: StepOrigin;
}

function toDomainOps(ops: RefineResultOp[]): RefineOp[] {
  const out: RefineOp[] = [];
  for (const o of ops) {
    if (o.op === 'add' && o.text) {
      out.push({
        op: 'add',
        afterStepId: o.afterStepId ?? null,
        text: o.text,
        tier: o.tier ?? 'required',
        ...(o.estimateMin !== undefined ? { estimateMin: o.estimateMin } : {}),
      });
    } else if (o.op === 'update' && o.stepId) {
      out.push({
        op: 'update',
        stepId: o.stepId,
        ...(o.text ? { text: o.text } : {}),
        ...(o.tier ? { tier: o.tier } : {}),
        ...(o.estimateMin !== undefined ? { estimateMin: o.estimateMin } : {}),
      });
    } else if ((o.op === 'remove' || o.op === 'markDone' || o.op === 'keep') && o.stepId) {
      out.push({ op: o.op, stepId: o.stepId });
    }
  }
  return out;
}

/**
 * Proposes a refined plan. Live AI when available; otherwise deterministic rules that cover
 * common phrases. Throws AiError only when nothing could interpret the instruction.
 */
export async function refinePlan(
  task: Task,
  steps: TaskStep[],
  instruction: string,
  settings: AppSettings,
): Promise<RefineOutcome> {
  const ctx = { taskId: task.id, newId: () => uuidv7(), now: Date.now() };
  const viaRules = (origin: StepOrigin, why?: AiError): RefineOutcome => {
    const r = ruleBasedRefine(steps, instruction);
    if (!r.understood) {
      throw (
        why ??
        new AiError(
          'off',
          'Quick changes only understand a few phrases. Try a chip, or turn on AI.',
        )
      );
    }
    return {
      preview: previewRefinement(steps, r.ops, { ...ctx, origin }),
      summary: r.summary,
      origin,
    };
  };

  if (settings.aiMode === 'demo') return viaRules('demo');
  if (settings.aiMode === 'off') return viaRules('template');
  ensureLiveAllowed(settings);
  try {
    const sent = steps.slice(0, LIMITS.stepsSent);
    const raw = await callProxy(
      {
        kind: 'refine',
        task: taskContext(task),
        instruction: instruction.slice(0, LIMITS.instruction),
        steps: sent.map((s) => ({
          id: s.id,
          text: s.text.slice(0, LIMITS.stepText),
          tier: s.tier,
          status: s.status,
          userEdited: s.userEdited,
          ...(s.estimateMin ? { estimateMin: s.estimateMin } : {}),
        })),
      },
      settings,
    );
    const result = normalizeRefine(raw, new Set(sent.map((s) => s.id)));
    return {
      preview: previewRefinement(steps, toDomainOps(result.ops), { ...ctx, origin: 'ai' }),
      summary: result.summary,
      origin: 'ai',
    };
  } catch (err) {
    const aiErr =
      err instanceof AiError
        ? err
        : new AiError('invalid_output', friendlyAiMessage('invalid_output'));
    // Offline or failing: try the quick rules before giving up.
    return viaRules('template', aiErr);
  }
}

export interface EasierOutcome {
  text: string;
  estimateMin?: number;
  origin: StepOrigin;
}

export async function makeStepEasier(
  task: Task,
  step: TaskStep,
  settings: AppSettings,
): Promise<EasierOutcome> {
  if (settings.aiMode === 'demo')
    return { text: demoEasier(step.text), estimateMin: 1, origin: 'demo' };
  if (settings.aiMode === 'live' && settings.aiConsentAt) {
    try {
      const raw = await callProxy(
        { kind: 'easier', task: taskContext(task), step: { text: step.text } },
        settings,
      );
      const r = normalizeEasier(raw);
      return { ...r, origin: 'ai' };
    } catch {
      // fall through to the deterministic ladder
    }
  }
  return { text: easierStep(step.text), estimateMin: 1, origin: 'template' };
}
