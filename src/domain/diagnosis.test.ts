import { describe, expect, it } from 'vitest';
import { BARRIERS, DEFAULT_RECOMMENDATION, METHODS, recommend } from './diagnosis';
import type { Barrier } from './types';

const expected: Record<Barrier, string> = {
  'no-start': 'breakdown',
  'too-much': 'breakdown',
  boring: 'launch',
  distracted: 'focus',
  perfect: 'breakdown',
  'low-energy': 'breakdown',
  'cant-decide': 'launch',
  'almost-done': 'breakdown',
};

describe('stuck diagnosis rules', () => {
  it.each(Object.entries(expected))('%s recommends %s', (barrier, method) => {
    expect(recommend(barrier as Barrier).recommended).toBe(method);
  });

  it('covers every barrier with a reason and distinct, valid alternatives', () => {
    for (const b of BARRIERS) {
      const r = recommend(b.id);
      expect(r.reason.length).toBeGreaterThan(10);
      expect(r.alternatives.length).toBeGreaterThan(0);
      expect(r.alternatives).not.toContain(r.recommended);
      for (const m of [r.recommended, ...r.alternatives]) expect(METHODS[m]).toBeDefined();
    }
  });

  it('falls back to a default when no barrier is chosen', () => {
    expect(recommend(undefined)).toBe(DEFAULT_RECOMMENDATION);
  });

  it('never uses diagnostic or judgmental language', () => {
    const text = [
      ...BARRIERS.map((b) => b.label),
      ...BARRIERS.map((b) => recommend(b.id).reason),
    ].join(' ');
    expect(text).not.toMatch(/adhd|disorder|lazy|procrastinat|fail/i);
  });
});
