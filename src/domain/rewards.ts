// Gentle progress feedback. Everything is derived from the append-only event log, and the
// unique dedupeKey makes each reward idempotent.
import type { Id, ProgressEvent, ProgressEventType } from './types';

export function dedupeKeyFor(type: ProgressEventType, entityId: Id): string {
  return `${type}:${entityId}`;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface Momentum {
  stepsDone: number;
  sessionsStarted: number;
  tasksDone: number;
}

export function momentumSince(events: ProgressEvent[], now: number, windowMs = WEEK_MS): Momentum {
  const since = now - windowMs;
  const seen = new Set<string>();
  const m: Momentum = { stepsDone: 0, sessionsStarted: 0, tasksDone: 0 };
  for (const e of events) {
    if (e.createdAt < since || seen.has(e.dedupeKey)) continue;
    seen.add(e.dedupeKey);
    if (e.type === 'step-done') m.stepsDone++;
    else if (e.type === 'session-started') m.sessionsStarted++;
    else if (e.type === 'task-done') m.tasksDone++;
  }
  return m;
}

/** A short, non-judgmental summary. Never mentions gaps or missed days. */
export function momentumText(m: Momentum): string | undefined {
  const parts: string[] = [];
  if (m.sessionsStarted)
    parts.push(`${m.sessionsStarted} start${m.sessionsStarted === 1 ? '' : 's'}`);
  if (m.stepsDone) parts.push(`${m.stepsDone} step${m.stepsDone === 1 ? '' : 's'} done`);
  if (m.tasksDone) parts.push(`${m.tasksDone} task${m.tasksDone === 1 ? '' : 's'} finished`);
  if (parts.length === 0) return undefined;
  return `This week: ${parts.join(', ')}.`;
}

const STEP_DONE_MESSAGES = ["That's progress.", 'Nice. One less thing.', 'Done. Good move.'];

/** Picks a message deterministically so tests are stable and copy doesn't flicker. */
export function celebrationText(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return STEP_DONE_MESSAGES[h % STEP_DONE_MESSAGES.length]!;
}
