import { describe, expect, it } from 'vitest';
import {
  describeDuration,
  elapsedMs,
  extendTimer,
  formatClock,
  isPaused,
  pauseTimer,
  remainingMs,
  resumeTimer,
  startTimer,
  timeUpAt,
} from './timer';

const MIN = 60_000;

describe('timer math (controlled clock)', () => {
  it('counts down from timestamps', () => {
    const t = startTimer(2 * MIN, 1_000);
    expect(remainingMs(t, 1_000)).toBe(2 * MIN);
    expect(remainingMs(t, 1_000 + 30_000)).toBe(90_000);
    expect(remainingMs(t, 1_000 + 5 * MIN)).toBe(0);
  });

  it('is correct after a long gap with no ticks (backgrounded app)', () => {
    const t = startTimer(10 * MIN, 0);
    // No intermediate updates at all: only the wall clock matters.
    expect(remainingMs(t, 7 * MIN + 500)).toBe(3 * MIN - 500);
  });

  it('pause freezes time and resume subtracts the paused span', () => {
    let t = startTimer(5 * MIN, 0);
    t = pauseTimer(t, 1 * MIN);
    expect(isPaused(t)).toBe(true);
    expect(remainingMs(t, 3 * MIN)).toBe(4 * MIN);
    t = resumeTimer(t, 3 * MIN);
    expect(isPaused(t)).toBe(false);
    expect(t.pausedTotalMs).toBe(2 * MIN);
    expect(remainingMs(t, 4 * MIN)).toBe(3 * MIN);
  });

  it('ignores double pause and resume-without-pause', () => {
    const t = pauseTimer(startTimer(MIN, 0), 10_000);
    expect(pauseTimer(t, 20_000)).toBe(t);
    const r = resumeTimer(t, 30_000);
    expect(resumeTimer(r, 40_000)).toBe(r);
  });

  it('reports when time ran out', () => {
    let t = startTimer(MIN, 0);
    t = resumeTimer(pauseTimer(t, 10_000), 40_000); // 30s pause
    expect(timeUpAt(t, 50_000)).toBeUndefined();
    expect(timeUpAt(t, 200_000)).toBe(90_000);
  });

  it('extends a finished timer', () => {
    const t = extendTimer(startTimer(MIN, 0), 5 * MIN);
    expect(remainingMs(t, 2 * MIN)).toBe(4 * MIN);
  });

  it('never goes negative and rejects bad durations', () => {
    expect(elapsedMs(startTimer(MIN, 100), 0)).toBe(0);
    expect(() => startTimer(0, 0)).toThrow();
    expect(() => startTimer(Number.NaN, 0)).toThrow();
  });

  it('formats clock and spoken durations', () => {
    expect(formatClock(120_000)).toBe('2:00');
    expect(formatClock(59_001)).toBe('1:00');
    expect(formatClock(0)).toBe('0:00');
    expect(describeDuration(65_000)).toBe('1 minute 5 seconds');
    expect(describeDuration(0)).toBe('0 seconds');
  });
});

describe('timer state objects', () => {
  it('resume removes pausedAt from richer objects (regression)', () => {
    const session = { id: 'x', goal: 'g', ...startTimer(MIN, 0) };
    const resumed = resumeTimer(pauseTimer(session, 10_000), 20_000);
    expect('pausedAt' in resumed).toBe(false);
    expect(resumed.id).toBe('x');
    expect(remainingMs(resumed, 30_000)).toBe(MIN - 20_000);
  });
});
