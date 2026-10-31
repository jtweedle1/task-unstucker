// Timer math. Remaining time is always derived from timestamps, never from counting
// interval ticks, so it stays correct after backgrounding, throttling, or a reload.

export interface TimerState {
  plannedMs: number;
  startedAt: number;
  pausedAt?: number;
  pausedTotalMs: number;
  endedAt?: number;
}

export function startTimer(plannedMs: number, now: number): TimerState {
  if (!Number.isFinite(plannedMs) || plannedMs <= 0) throw new Error('Duration must be positive');
  return { plannedMs, startedAt: now, pausedTotalMs: 0 };
}

export function elapsedMs(t: TimerState, now: number): number {
  const end = t.endedAt ?? t.pausedAt ?? now;
  return Math.max(0, end - t.startedAt - t.pausedTotalMs);
}

export function remainingMs(t: TimerState, now: number): number {
  return Math.max(0, t.plannedMs - elapsedMs(t, now));
}

export function isPaused(t: TimerState): boolean {
  return t.pausedAt !== undefined && t.endedAt === undefined;
}

export function isTimeUp(t: TimerState, now: number): boolean {
  return remainingMs(t, now) === 0;
}

/** When the countdown reached zero, or undefined if it hasn't. */
export function timeUpAt(t: TimerState, now: number): number | undefined {
  if (!isTimeUp(t, now)) return undefined;
  return t.startedAt + t.pausedTotalMs + t.plannedMs;
}

export function pauseTimer<T extends TimerState>(t: T, now: number): T {
  if (t.pausedAt !== undefined || t.endedAt !== undefined) return t;
  return { ...t, pausedAt: now };
}

export function resumeTimer<T extends TimerState>(t: T, now: number): T {
  if (t.pausedAt === undefined || t.endedAt !== undefined) return t;
  const { pausedAt, ...rest } = t;
  // Remove pausedAt entirely (not just set undefined) so spreading never resurrects it.
  return { ...rest, pausedTotalMs: t.pausedTotalMs + Math.max(0, now - pausedAt) } as T;
}

export function extendTimer<T extends TimerState>(t: T, extraMs: number): T {
  return { ...t, plannedMs: t.plannedMs + extraMs };
}

/** Formats milliseconds as m:ss, rounding up so "0:00" only shows when time is really up. */
export function formatClock(ms: number): string {
  const totalSec = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Screen-reader friendly duration, e.g. "1 minute 5 seconds". */
export function describeDuration(ms: number): string {
  const totalSec = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const parts: string[] = [];
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (s || !m) parts.push(`${s} second${s === 1 ? '' : 's'}`);
  return parts.join(' ');
}
