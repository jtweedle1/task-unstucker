import { describe, expect, it } from 'vitest';
import {
  acceptSuggestions,
  buildSteps,
  moveStep,
  normalizeRanks,
  pickAnotherStep,
  pickCurrentStep,
  previewRefinement,
  progressOf,
  rankBetween,
  sortSteps,
} from './plan';
import type { TaskStep } from './types';

let n = 0;
const newId = () => `new-${++n}`;
const ctx = { taskId: 't', origin: 'ai' as const, newId, now: 1 };

function plan(): TaskStep[] {
  const steps = buildSteps(
    't',
    [
      { text: 'Put three dishes in the sink', tier: 'required' },
      { text: 'Wipe the counter', tier: 'required' },
      { text: 'Sweep the floor', tier: 'optional' },
      { text: 'Take out trash', tier: 'optional' },
    ],
    'ai',
    (() => {
      let i = 0;
      return () => `s${++i}`;
    })(),
    0,
  );
  return steps;
}

describe('ordering helpers', () => {
  it('ranks between neighbours', () => {
    expect(rankBetween(undefined, undefined)).toBe(1024);
    expect(rankBetween(1024, 2048)).toBe(1536);
    expect(rankBetween(undefined, 1024)).toBe(0);
    expect(rankBetween(1024, undefined)).toBe(2048);
  });

  it('moves steps without touching array identity', () => {
    const moved = moveStep(plan(), 's3', -1);
    expect(moved.map((s) => s.id)).toEqual(['s1', 's3', 's2', 's4']);
    expect(moveStep(plan(), 's1', -1).map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('normalizes crowded ranks', () => {
    const crowded = plan().map((s, i) => ({ ...s, rank: 1 + i * 1e-9 }));
    expect(normalizeRanks(crowded).map((s) => s.rank)).toEqual([1024, 2048, 3072, 4096]);
  });

  it('picks the current step, preferring required ones', () => {
    const steps = plan().map((s) => (s.id === 's1' ? { ...s, status: 'done' as const } : s));
    expect(pickCurrentStep(steps)?.id).toBe('s2');
    expect(pickCurrentStep(steps, 's4')?.id).toBe('s4');
    expect(pickCurrentStep(steps, 's1')?.id).toBe('s2'); // done steps are not current
    expect(pickAnotherStep(steps, 's4')?.id).toBe('s2'); // wraps around
    expect(progressOf(steps)).toEqual({ done: 1, total: 4 });
  });
});

describe('previewRefinement', () => {
  it('applies updates, adds, and removes to unprotected steps, keeping IDs stable', () => {
    const p = previewRefinement(
      plan(),
      [
        { op: 'update', stepId: 's2', text: 'Wipe one corner of the counter' },
        { op: 'remove', stepId: 's3' },
        { op: 'add', afterStepId: 's1', text: 'Run hot water', tier: 'required' },
        { op: 'keep', stepId: 's4' },
      ],
      ctx,
    );
    expect(p.steps.map((s) => s.text)).toEqual([
      'Put three dishes in the sink',
      'Run hot water',
      'Wipe one corner of the counter',
      'Take out trash',
    ]);
    expect(p.steps.find((s) => s.text.startsWith('Wipe'))?.id).toBe('s2');
    expect(p.changes.map((c) => c.kind).sort()).toEqual(['added', 'changed', 'removed']);
    expect(p.suggestions).toEqual([]);
  });

  it('never silently changes or removes completed work', () => {
    const steps = plan().map((s) => (s.id === 's1' ? { ...s, status: 'done' as const } : s));
    const p = previewRefinement(
      steps,
      [
        { op: 'update', stepId: 's1', text: 'Something else' },
        { op: 'remove', stepId: 's1' },
      ],
      ctx,
    );
    const s1 = p.steps.find((s) => s.id === 's1')!;
    expect(s1.text).toBe('Put three dishes in the sink');
    expect(s1.status).toBe('done');
    expect(p.suggestions.map((s) => s.kind)).toEqual(['change-protected']);
    expect(p.changes).toEqual([]);
  });

  it('protects user-edited steps', () => {
    const steps = plan().map((s) => (s.id === 's2' ? { ...s, userEdited: true } : s));
    const p = previewRefinement(steps, [{ op: 'remove', stepId: 's2' }], ctx);
    expect(p.steps.some((s) => s.id === 's2')).toBe(true);
    expect(p.suggestions[0]?.kind).toBe('remove-protected');
    const accepted = acceptSuggestions(p, new Set([p.suggestions[0]!.key]));
    expect(accepted.some((s) => s.id === 's2')).toBe(false);
  });

  it('only marks steps done after confirmation', () => {
    const p = previewRefinement(
      plan(),
      [
        { op: 'markDone', stepId: 's1' },
        { op: 'markDone', stepId: 's2' },
      ],
      ctx,
    );
    expect(p.steps.every((s) => s.status === 'todo')).toBe(true);
    const accepted = acceptSuggestions(p, new Set(p.suggestions.map((s) => s.key)));
    expect(accepted.filter((s) => s.status === 'done').map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('ignores unknown IDs, duplicate ops, and empty additions', () => {
    const p = previewRefinement(
      plan(),
      [
        { op: 'remove', stepId: 'nope' },
        { op: 'update', stepId: 's2', text: 'A' },
        { op: 'remove', stepId: 's2' },
        { op: 'add', afterStepId: null, text: '   ', tier: 'required' },
      ],
      ctx,
    );
    expect(p.ignored).toBe(3);
    expect(p.steps.find((s) => s.id === 's2')?.text).toBe('A');
  });

  it('keeps steps the model did not mention', () => {
    const p = previewRefinement(plan(), [], ctx);
    expect(sortSteps(p.steps).map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('adds at the start when afterStepId is null and appends for unknown anchors', () => {
    const p = previewRefinement(
      plan(),
      [
        { op: 'add', afterStepId: null, text: 'First', tier: 'required' },
        { op: 'add', afterStepId: 'missing', text: 'Last', tier: 'optional' },
      ],
      ctx,
    );
    expect(p.steps[0]?.text).toBe('First');
    expect(p.steps.at(-1)?.text).toBe('Last');
  });
});
