// Task Roulette: picks a task for you when deciding is the hard part.
// Pure and deterministic given an rng, so eligibility and weighting are tested directly.
import type { Energy, Id, Task, TaskStep } from './types';

export interface RouletteCandidate {
  task: Task;
  /** The task's next step, if it has a plan. */
  nextStep?: TaskStep;
}

export interface RouletteOptions {
  now: number;
  /** Tasks skipped with "not this one" or already shown this round. */
  excludeIds?: ReadonlySet<Id>;
  /** Energy Matching: only tasks that fit this much energy (untagged tasks always fit). */
  energy?: Energy;
  /** Only tasks whose next step fits in this many minutes (unknown estimates fit). */
  maxMinutes?: number;
}

const ENERGY_RANK: Record<Energy, number> = { low: 0, medium: 1, high: 2 };

/** True when a task needing `needed` energy is reasonable at energy level `have`. */
export function fitsEnergy(needed: Energy | undefined, have: Energy | undefined): boolean {
  if (!needed || !have) return true;
  return ENERGY_RANK[needed] <= ENERGY_RANK[have];
}

/** Whole days from today to a YYYY-MM-DD date in local time. Negative means overdue. */
export function daysUntil(dueDate: string, now: number): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate);
  if (!m) return undefined;
  const due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const today = new Date(now);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((due - start) / 86_400_000);
}

export function isEligible(c: RouletteCandidate, opts: RouletteOptions): boolean {
  const { task } = c;
  if (task.deletedAt !== undefined) return false;
  if (task.status === 'done') return false;
  if (opts.excludeIds?.has(task.id)) return false;
  if (!fitsEnergy(task.energy, opts.energy)) return false;
  const est = c.nextStep?.estimateMin;
  if (opts.maxMinutes !== undefined && est !== undefined && est > opts.maxMinutes) return false;
  return true;
}

/**
 * Relative chance of being picked. Pinned and due-soon tasks are favoured so roulette
 * doesn't bury something urgent, but every eligible task keeps a chance.
 */
export function weightOf(c: RouletteCandidate, now: number): number {
  let w = 1;
  if (c.task.pinned) w += 2;
  const days = c.task.dueDate ? daysUntil(c.task.dueDate, now) : undefined;
  if (days !== undefined) {
    if (days <= 1) w += 3;
    else if (days <= 7) w += 1;
  }
  if (c.task.status === 'active') w += 0.5;
  return w;
}

export function eligibleCandidates(
  candidates: RouletteCandidate[],
  opts: RouletteOptions,
): RouletteCandidate[] {
  return candidates.filter((c) => isEligible(c, opts));
}

export function pickRoulette(
  candidates: RouletteCandidate[],
  opts: RouletteOptions,
  rng: () => number = Math.random,
): RouletteCandidate | undefined {
  const pool = eligibleCandidates(candidates, opts);
  if (pool.length === 0) return undefined;
  const weights = pool.map((c) => weightOf(c, opts.now));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.min(Math.max(rng(), 0), 0.999_999_999) * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]!;
    if (r < 0) return pool[i];
  }
  return pool[pool.length - 1];
}
