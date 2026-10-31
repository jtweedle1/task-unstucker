import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type AppSettings, type Task, type TaskStep } from '../domain/types';
import {
  AiError,
  clearAiCache,
  generatePlan,
  makeStepEasier,
  refinePlan,
  setFetcher,
} from './client';

const task: Task = {
  id: 't1',
  title: 'Reply to the landlord',
  status: 'active',
  constraints: {},
  createdAt: 0,
  updatedAt: 0,
} as Task;

const live: AppSettings = { ...DEFAULT_SETTINGS, aiMode: 'live', aiConsentAt: 1 };
const steps: TaskStep[] = [
  {
    id: 's1',
    taskId: 't1',
    text: 'Open the email',
    tier: 'required',
    status: 'todo',
    rank: 1,
    userEdited: false,
    origin: 'ai',
    createdAt: 0,
    updatedAt: 0,
  } as TaskStep,
];

let calls: { url: string; init?: RequestInit }[] = [];
function respond(status: number, body: unknown) {
  setFetcher(async (url, init) => {
    calls.push({ url: String(url), ...(init ? { init } : {}) });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  });
}

beforeEach(() => {
  calls = [];
  clearAiCache();
});
afterEach(() => setFetcher((...a) => fetch(...a)));

describe('generatePlan', () => {
  it('uses live AI when consented and validates the result', async () => {
    respond(200, {
      ok: true,
      result: {
        steps: [{ text: 'Open the email', tier: 'required', estimateMin: 1 }],
        firstStepIndex: 0,
        question: null,
        safetyNote: null,
      },
    });
    const out = await generatePlan(task, live);
    expect(out.origin).toBe('ai');
    expect(out.result.steps[0]!.text).toBe('Open the email');
    expect(calls[0]!.url).toBe('/api/ai');
  });

  it('caches identical requests', async () => {
    respond(200, {
      ok: true,
      result: {
        steps: [{ text: 'A', tier: 'required', estimateMin: 1 }],
        firstStepIndex: 0,
        question: null,
        safetyNote: null,
      },
    });
    await generatePlan(task, live);
    await generatePlan(task, live);
    expect(calls).toHaveLength(1);
  });

  it('sends the access code header when set', async () => {
    respond(200, {
      ok: true,
      result: {
        steps: [{ text: 'A', tier: 'required', estimateMin: 1 }],
        firstStepIndex: 0,
        question: null,
        safetyNote: null,
      },
    });
    await generatePlan(task, { ...live, aiAccessCode: 'abc' });
    expect((calls[0]!.init!.headers as Record<string, string>)['x-access-code']).toBe('abc');
  });

  it('falls back to template steps on malformed output', async () => {
    respond(200, { ok: true, result: { steps: 'not an array' } });
    const out = await generatePlan(task, live);
    expect(out.origin).toBe('template');
    expect(out.fallbackReason).toMatch(/usable/);
    expect(out.result.steps.length).toBeGreaterThan(0);
  });

  it('falls back with a friendly reason on 429 and network errors', async () => {
    respond(429, { ok: false, error: { code: 'rate_limited', message: 'x' } });
    expect((await generatePlan(task, live)).fallbackReason).toMatch(/busy/);
    setFetcher(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect((await generatePlan(task, live)).fallbackReason).toMatch(/offline/);
    respond(502, '<html>bad gateway</html>');
    expect((await generatePlan(task, live)).origin).toBe('template');
  });

  it('asks for consent before the first live call and sends nothing', async () => {
    respond(200, {});
    await expect(generatePlan(task, { ...live, aiConsentAt: undefined })).rejects.toBeInstanceOf(
      AiError,
    );
    expect(calls).toHaveLength(0);
  });

  it('demo and off modes never touch the network', async () => {
    respond(200, {});
    expect((await generatePlan(task, { ...DEFAULT_SETTINGS, aiMode: 'demo' })).origin).toBe('demo');
    expect((await generatePlan(task, { ...DEFAULT_SETTINGS, aiMode: 'off' })).origin).toBe(
      'template',
    );
    expect(calls).toHaveLength(0);
  });
});

describe('refinePlan and makeStepEasier', () => {
  it('falls back to quick rules when live AI fails', async () => {
    respond(503, { ok: false, error: { code: 'not_configured', message: 'x' } });
    const out = await refinePlan(task, steps, 'make it smaller', live);
    expect(out.origin).toBe('template');
  });

  it('throws a helpful error when rules cannot understand the request offline', async () => {
    respond(503, { ok: false, error: { code: 'not_configured', message: 'x' } });
    await expect(refinePlan(task, steps, 'rewrite it as a sonnet', live)).rejects.toBeInstanceOf(
      AiError,
    );
  });

  it('makeStepEasier falls back to the built-in ladder', async () => {
    setFetcher(async () => {
      throw new TypeError('offline');
    });
    const out = await makeStepEasier(task, steps[0]!, live);
    expect(out.origin).toBe('template');
    expect(out.text.length).toBeGreaterThan(0);
  });
});
