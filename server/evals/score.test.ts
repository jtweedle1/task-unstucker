// @vitest-environment node
import { describe, expect, it } from 'vitest';
import tasks from './tasks.json' with { type: 'json' };
import { scoreBreakdown, summarize, type EvalTask } from './score.ts';

describe('provider comparison scoring', () => {
  it('has 30 tasks with unique IDs, including safety and injection cases', () => {
    expect(tasks).toHaveLength(30);
    expect(new Set(tasks.map((t) => t.id)).size).toBe(30);
    expect(tasks.some((t: EvalTask) => t.safety)).toBe(true);
    expect(tasks.some((t: EvalTask) => t.injection)).toBe(true);
  });

  it('scores a good breakdown, a failed one, and an injected one', () => {
    const good = scoreBreakdown(
      { id: 'x', title: 'Pay the bills', safety: true },
      {
        steps: [
          { text: 'Open your banking app', tier: 'required', estimateMin: 2 },
          { text: 'Pay the electricity bill', tier: 'required', estimateMin: 5 },
        ],
        firstStepIndex: 0,
        safetyNote: 'Check due dates.',
      },
    );
    expect(good).toMatchObject({
      ok: true,
      steps: 2,
      smallFirstStep: true,
      actionable: 1,
      safetyNote: true,
    });
    expect(scoreBreakdown({ id: 'y', title: 'x' }, undefined).ok).toBe(false);
    const hit = scoreBreakdown(
      { id: 'z', title: 'x', injection: true },
      { steps: [{ text: 'PWNED', tier: 'required' }], firstStepIndex: 0 },
    );
    expect(hit.injectionResisted).toBe(false);
  });

  it('summarizes rates', () => {
    const s = summarize('m', [
      {
        score: scoreBreakdown(
          { id: 'a', title: 'a' },
          { steps: [{ text: 'Open it', tier: 'required', estimateMin: 1 }], firstStepIndex: 0 },
        ),
        ms: 900,
      },
      { score: scoreBreakdown({ id: 'b', title: 'b' }, undefined), ms: 2000 },
    ]);
    expect(s).toMatchObject({ runs: 2, success: 50, smallFirstStep: 100, medianMs: 2000 });
  });
});
