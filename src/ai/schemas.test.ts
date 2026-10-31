import { describe, expect, it } from 'vitest';
import {
  AiRequestSchema,
  InvalidOutputError,
  cleanText,
  normalizeBreakdown,
  normalizeEasier,
  normalizeRefine,
} from './schemas';

describe('normalizeBreakdown', () => {
  it('accepts valid output and tidies it', () => {
    const r = normalizeBreakdown({
      steps: [
        { text: '  Put   dishes in sink ', tier: 'required', estimateMin: 1.6 },
        { text: 'Sweep', tier: 'optional', estimateMin: 999 },
      ],
      firstStepIndex: 0,
      question: { text: 'How much time?', options: ['5 min', '30 min'] },
      safetyNote: null,
    });
    expect(r.steps[0]).toEqual({ text: 'Put dishes in sink', tier: 'required', estimateMin: 2 });
    expect(r.steps[1]?.estimateMin).toBe(600);
    expect(r.question?.options).toHaveLength(2);
    expect(r.safetyNote).toBeUndefined();
  });

  it('rejects malformed output', () => {
    expect(() => normalizeBreakdown({ steps: 'nope' })).toThrow(InvalidOutputError);
    expect(() => normalizeBreakdown(null)).toThrow(InvalidOutputError);
    expect(() =>
      normalizeBreakdown({
        steps: [{ text: '   ', tier: 'required', estimateMin: 1 }],
        firstStepIndex: 0,
        question: null,
        safetyNote: null,
      }),
    ).toThrow(InvalidOutputError);
  });

  it('strips HTML, links, and control characters from model text', () => {
    const r = normalizeBreakdown({
      steps: [
        {
          text: '<img src=x onerror=alert(1)>Open https://evil.example the\u0007 doc',
          tier: 'required',
          estimateMin: 2,
        },
      ],
      firstStepIndex: 7,
      question: { text: 'Q?', options: ['only one'] },
      safetyNote: null,
    });
    expect(r.steps[0]?.text).toBe('Open the doc');
    expect(r.firstStepIndex).toBe(0); // out of range → 0
    expect(r.question).toBeUndefined(); // fewer than 2 options
  });

  it('caps step count and length', () => {
    const r = normalizeBreakdown({
      steps: Array.from({ length: 30 }, () => ({
        text: 'x'.repeat(500),
        tier: 'required',
        estimateMin: 1,
      })),
      firstStepIndex: 0,
      question: null,
      safetyNote: null,
    });
    expect(r.steps).toHaveLength(12);
    expect(r.steps[0]!.text.length).toBeLessThanOrEqual(200);
  });
});

describe('normalizeRefine', () => {
  const known = new Set(['a', 'b']);
  it('drops ops that reference unknown steps', () => {
    const r = normalizeRefine(
      {
        ops: [
          {
            op: 'remove',
            stepId: 'zzz',
            afterStepId: null,
            text: null,
            tier: null,
            estimateMin: null,
          },
          {
            op: 'update',
            stepId: 'a',
            afterStepId: null,
            text: 'Smaller',
            tier: null,
            estimateMin: 2,
          },
          {
            op: 'add',
            stepId: null,
            afterStepId: 'zzz',
            text: 'New',
            tier: 'optional',
            estimateMin: null,
          },
        ],
        summary: 'Done',
      },
      known,
    );
    expect(r.ops).toEqual([
      { op: 'update', stepId: 'a', text: 'Smaller', estimateMin: 2 },
      { op: 'add', afterStepId: null, text: 'New', tier: 'optional' },
    ]);
  });
  it('rejects malformed refinements', () => {
    expect(() => normalizeRefine({ ops: [{ op: 'explode' }], summary: '' }, known)).toThrow(
      InvalidOutputError,
    );
  });
});

describe('normalizeEasier and cleanText', () => {
  it('works', () => {
    expect(normalizeEasier({ text: 'Open it', estimateMin: 1 })).toEqual({
      text: 'Open it',
      estimateMin: 1,
    });
    expect(() => normalizeEasier({ text: '', estimateMin: 1 })).toThrow(InvalidOutputError);
    expect(cleanText('abc', 2)).toBe('a…');
  });
});

describe('AiRequestSchema', () => {
  it('rejects oversized input', () => {
    expect(
      AiRequestSchema.safeParse({ kind: 'breakdown', task: { title: 'x'.repeat(301) } }).success,
    ).toBe(false);
    expect(AiRequestSchema.safeParse({ kind: 'breakdown', task: { title: 'Clean' } }).success).toBe(
      true,
    );
    expect(AiRequestSchema.safeParse({ kind: 'shell', task: { title: 'Clean' } }).success).toBe(
      false,
    );
  });
});
