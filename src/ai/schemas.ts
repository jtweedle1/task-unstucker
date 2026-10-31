// Contracts shared by the app and the AI proxy. Everything that crosses the network is
// validated with these schemas on both sides; model output is untrusted until it passes.
import { z } from 'zod';

export const LIMITS = {
  title: 300,
  instruction: 500,
  notes: 300,
  stepText: 300,
  stepsSent: 30,
  bodyBytes: 16_000,
  outStepText: 200,
  outSteps: 12,
  outOps: 20,
  outSummary: 160,
  outQuestion: 140,
  outOption: 48,
} as const;

const barrier = z.enum([
  'no-start',
  'too-much',
  'boring',
  'distracted',
  'perfect',
  'low-energy',
  'cant-decide',
  'almost-done',
]);

export const TaskContextSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.title),
  barrier: barrier.optional(),
  constraints: z
    .object({
      minutesAvailable: z.number().int().min(1).max(600).optional(),
      energy: z.enum(['low', 'medium', 'high']).optional(),
      notes: z.string().max(LIMITS.notes).optional(),
    })
    .optional(),
});

export const StepContextSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().max(LIMITS.stepText),
  tier: z.enum(['required', 'optional']),
  status: z.enum(['todo', 'done', 'skipped']),
  userEdited: z.boolean(),
  estimateMin: z.number().int().min(1).max(600).optional(),
});

export const AiRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('breakdown'), task: TaskContextSchema }),
  z.object({
    kind: z.literal('refine'),
    task: TaskContextSchema,
    steps: z.array(StepContextSchema).max(LIMITS.stepsSent),
    instruction: z.string().trim().min(1).max(LIMITS.instruction),
  }),
  z.object({
    kind: z.literal('easier'),
    task: TaskContextSchema,
    step: z.object({ text: z.string().trim().min(1).max(LIMITS.stepText) }),
  }),
]);
export type AiRequest = z.infer<typeof AiRequestSchema>;
export type AiRequestKind = AiRequest['kind'];

// ---------------------------------------------------------------------------
// Wire formats requested from the model. Kept simple (no unions, no length limits) so they
// work with structured-output modes; tighter checks happen in the normalizers below.
// ---------------------------------------------------------------------------

const tier = z.enum(['required', 'optional']);

export const BreakdownWireSchema = z.object({
  steps: z.array(z.object({ text: z.string(), tier, estimateMin: z.number() })),
  firstStepIndex: z.number(),
  question: z.object({ text: z.string(), options: z.array(z.string()) }).nullable(),
  safetyNote: z.string().nullable(),
});

export const RefineWireSchema = z.object({
  ops: z.array(
    z.object({
      op: z.enum(['keep', 'update', 'add', 'remove', 'markDone']),
      stepId: z.string().nullable(),
      afterStepId: z.string().nullable(),
      text: z.string().nullable(),
      tier: tier.nullable(),
      estimateMin: z.number().nullable(),
    }),
  ),
  summary: z.string(),
});

export const EasierWireSchema = z.object({
  text: z.string(),
  estimateMin: z.number(),
});

// ---------------------------------------------------------------------------
// Normalized results returned to the app.
// ---------------------------------------------------------------------------

export interface BreakdownResult {
  steps: { text: string; tier: 'required' | 'optional'; estimateMin?: number }[];
  firstStepIndex: number;
  question?: { text: string; options: string[] };
  safetyNote?: string;
}

export interface RefineResultOp {
  op: 'keep' | 'update' | 'add' | 'remove' | 'markDone';
  stepId?: string;
  afterStepId?: string | null;
  text?: string;
  tier?: 'required' | 'optional';
  estimateMin?: number;
}

export interface RefineResult {
  ops: RefineResultOp[];
  summary: string;
}

export interface EasierResult {
  text: string;
  estimateMin?: number;
}

export type AiResult = BreakdownResult | RefineResult | EasierResult;

export class InvalidOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOutputError';
  }
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const TAGS = /<[^>]{0,200}>/g;
const URLS = /\bhttps?:\/\/\S+/gi;

/** Makes model text safe and tidy to show as plain text. */
export function cleanText(input: string, max: number): string {
  const t = input
    .replace(CONTROL, '')
    .replace(TAGS, '')
    .replace(URLS, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function cleanMinutes(n: number | null | undefined): number | undefined {
  if (n === null || n === undefined || !Number.isFinite(n)) return undefined;
  return Math.min(600, Math.max(1, Math.round(n)));
}

export function normalizeBreakdown(raw: unknown): BreakdownResult {
  const parsed = BreakdownWireSchema.safeParse(raw);
  if (!parsed.success) throw new InvalidOutputError('Breakdown did not match the schema');
  const steps = parsed.data.steps
    .map((s) => {
      const estimateMin = cleanMinutes(s.estimateMin);
      return {
        text: cleanText(s.text, LIMITS.outStepText),
        tier: s.tier,
        ...(estimateMin !== undefined ? { estimateMin } : {}),
      };
    })
    .filter((s) => s.text.length > 0)
    .slice(0, LIMITS.outSteps);
  if (steps.length === 0) throw new InvalidOutputError('Breakdown had no usable steps');
  const idx = Math.round(parsed.data.firstStepIndex);
  const firstStepIndex = Number.isFinite(idx) && idx >= 0 && idx < steps.length ? idx : 0;
  const q = parsed.data.question;
  const options = q
    ? q.options
        .map((o) => cleanText(o, LIMITS.outOption))
        .filter(Boolean)
        .slice(0, 4)
    : [];
  const questionText = q ? cleanText(q.text, LIMITS.outQuestion) : '';
  const safety = parsed.data.safetyNote ? cleanText(parsed.data.safetyNote, LIMITS.outSummary) : '';
  return {
    steps,
    firstStepIndex,
    ...(questionText && options.length >= 2 ? { question: { text: questionText, options } } : {}),
    ...(safety ? { safetyNote: safety } : {}),
  };
}

export function normalizeRefine(raw: unknown, knownIds: ReadonlySet<string>): RefineResult {
  const parsed = RefineWireSchema.safeParse(raw);
  if (!parsed.success) throw new InvalidOutputError('Refinement did not match the schema');
  const ops: RefineResultOp[] = [];
  for (const o of parsed.data.ops.slice(0, LIMITS.outOps)) {
    const text = o.text ? cleanText(o.text, LIMITS.outStepText) : undefined;
    const estimateMin = cleanMinutes(o.estimateMin);
    if (o.op === 'add') {
      if (!text) continue;
      const anchor = o.afterStepId && knownIds.has(o.afterStepId) ? o.afterStepId : null;
      ops.push({
        op: 'add',
        afterStepId: o.afterStepId === null ? null : anchor,
        text,
        tier: o.tier ?? 'required',
        ...(estimateMin !== undefined ? { estimateMin } : {}),
      });
      continue;
    }
    if (!o.stepId || !knownIds.has(o.stepId)) continue; // never trust unknown IDs
    if (o.op === 'update') {
      ops.push({
        op: 'update',
        stepId: o.stepId,
        ...(text ? { text } : {}),
        ...(o.tier ? { tier: o.tier } : {}),
        ...(estimateMin !== undefined ? { estimateMin } : {}),
      });
    } else {
      ops.push({ op: o.op, stepId: o.stepId });
    }
  }
  return { ops, summary: cleanText(parsed.data.summary, LIMITS.outSummary) || 'Updated the plan.' };
}

export function normalizeEasier(raw: unknown): EasierResult {
  const parsed = EasierWireSchema.safeParse(raw);
  if (!parsed.success) throw new InvalidOutputError('Easier step did not match the schema');
  const text = cleanText(parsed.data.text, LIMITS.outStepText);
  if (!text) throw new InvalidOutputError('Easier step was empty');
  const estimateMin = cleanMinutes(parsed.data.estimateMin);
  return { text, ...(estimateMin !== undefined ? { estimateMin } : {}) };
}

/** Error codes shared by the proxy and the app. */
export type AiErrorCode =
  | 'invalid_request'
  | 'too_large'
  | 'access_required'
  | 'rate_limited'
  | 'not_configured'
  | 'auth_failed'
  | 'provider_unavailable'
  | 'timeout'
  | 'invalid_output'
  | 'refused'
  | 'network';

export interface AiErrorBody {
  ok: false;
  error: { code: AiErrorCode; message: string; retryAfterSec?: number };
}

export interface AiSuccessBody<T = unknown> {
  ok: true;
  result: T;
}
