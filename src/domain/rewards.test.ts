import { describe, expect, it } from 'vitest';
import { celebrationText, dedupeKeyFor, momentumSince, momentumText } from './rewards';
import type { ProgressEvent } from './types';

const ev = (type: ProgressEvent['type'], entityId: string, createdAt: number): ProgressEvent => ({
  id: `${type}-${entityId}-${createdAt}`,
  type,
  entityId,
  createdAt,
  dedupeKey: dedupeKeyFor(type, entityId),
});

describe('rewards', () => {
  const now = 10 * 24 * 3600_000;
  it('counts recent events once each (idempotent)', () => {
    const m = momentumSince(
      [
        ev('step-done', 'a', now - 1000),
        ev('step-done', 'a', now - 500),
        ev('session-started', 's', now - 10),
      ],
      now,
    );
    expect(m).toEqual({ stepsDone: 1, sessionsStarted: 1, tasksDone: 0 });
  });

  it('ignores events older than the window', () => {
    expect(momentumSince([ev('task-done', 't', 0)], now).tasksDone).toBe(0);
  });

  it('says nothing when there is nothing to celebrate (no guilt)', () => {
    expect(momentumText({ stepsDone: 0, sessionsStarted: 0, tasksDone: 0 })).toBeUndefined();
    expect(momentumText({ stepsDone: 2, sessionsStarted: 1, tasksDone: 0 })).toBe(
      'This week: 1 start, 2 steps done.',
    );
  });

  it('picks a stable celebration message', () => {
    expect(celebrationText('abc')).toBe(celebrationText('abc'));
  });
});
