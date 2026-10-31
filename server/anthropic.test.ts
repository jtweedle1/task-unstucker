// @vitest-environment node
// Contract test for the Anthropic adapter against a fake network layer. This checks the
// request we send and how responses map to results and errors. It does not call the real API.
import { describe, expect, it } from 'vitest';
import { BreakdownWireSchema, InvalidOutputError } from '../src/ai/schemas.ts';
import { createAnthropicProvider } from './anthropic.ts';
import { ProviderError } from './provider.ts';

const wire = {
  steps: [{ text: 'Open the email', tier: 'required', estimateMin: 1 }],
  firstStepIndex: 0,
  question: null,
  safetyNote: null,
};

function message(text: string, stop_reason = 'end_turn') {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text }],
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const r = url instanceof Request ? url : undefined;
    calls.push({
      url: String(r?.url ?? url),
      headers: new Headers(init?.headers ?? r?.headers),
      body: JSON.parse(String(init?.body)),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  }) as typeof fetch;
  return { f, calls };
}

const req = { system: 'sys', user: '<task>x</task>', schema: BreakdownWireSchema, maxTokens: 4000 };

describe('Anthropic adapter', () => {
  it('sends a structured-output request and returns the parsed object', async () => {
    const { f, calls } = fakeFetch(200, message(JSON.stringify(wire)));
    const p = createAnthropicProvider({ apiKey: 'test', fetch: f, maxRetries: 0 });
    expect(await p.generate(req)).toEqual(wire);
    const sent = calls[0]!;
    expect(sent.url).toContain('/v1/messages');
    expect(sent.headers.get('authorization')).toBe('Bearer test');
    expect(sent.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(sent.body.model).toBe('claude-haiku-5-5');
    expect(sent.body.thinking).toEqual({ type: 'adaptive' });
    expect(sent.body.output_config).toMatchObject({
      effort: 'low',
      format: { type: 'json_schema' },
    });
    expect(sent.body.system).toBe('sys');
  });

  it('honours the model override', async () => {
    const { f, calls } = fakeFetch(200, message(JSON.stringify(wire)));
    await createAnthropicProvider({
      apiKey: 'k',
      model: 'claude-opus-5-5',
      fetch: f,
      maxRetries: 0,
    }).generate(req);
    expect(calls[0]!.body.model).toBe('claude-opus-5-5');
  });

  it('maps refusals, truncation and bad JSON', async () => {
    const refusal = createAnthropicProvider({
      apiKey: 'k',
      fetch: fakeFetch(200, message('', 'refusal')).f,
      maxRetries: 0,
    });
    await expect(refusal.generate(req)).rejects.toMatchObject({ code: 'refused' });
    const cut = createAnthropicProvider({
      apiKey: 'k',
      fetch: fakeFetch(200, message('{"steps":', 'max_tokens')).f,
      maxRetries: 0,
    });
    await expect(cut.generate(req)).rejects.toBeInstanceOf(InvalidOutputError);
    const junk = createAnthropicProvider({
      apiKey: 'k',
      fetch: fakeFetch(200, message('not json')).f,
      maxRetries: 0,
    });
    await expect(junk.generate(req)).rejects.toBeInstanceOf(InvalidOutputError);
  });

  it('maps HTTP errors to safe codes', async () => {
    const err = (status: number, headers: Record<string, string> = {}) =>
      createAnthropicProvider({
        apiKey: 'k',
        fetch: fakeFetch(
          status,
          { type: 'error', error: { type: 'x', message: 'detail' } },
          headers,
        ).f,
        maxRetries: 0,
      }).generate(req);
    await expect(err(401)).rejects.toMatchObject({ code: 'auth_failed' });
    await expect(err(429, { 'retry-after': '12' })).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfterSec: 12,
    });
    await expect(err(400)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(err(529)).rejects.toBeInstanceOf(ProviderError);
  });
});
