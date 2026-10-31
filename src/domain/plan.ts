// Plan logic: ordering, picking the next step, and merging AI refinements safely.
// All pure functions so they can be tested without a browser or database.
import type { Id, StepOrigin, StepTier, TaskStep } from './types';

export const RANK_GAP = 1024;

export function sortSteps(steps: TaskStep[]): TaskStep[] {
  return [...steps].sort((a, b) => a.rank - b.rank || a.createdAt - b.createdAt);
}

/** Rank that places an item between two neighbours (either may be missing). */
export function rankBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return RANK_GAP;
  if (before === undefined) return after! - RANK_GAP;
  if (after === undefined) return before + RANK_GAP;
  return (before + after) / 2;
}

/** Re-spaces ranks evenly. Used when repeated midpoints get too close together. */
export function normalizeRanks(steps: TaskStep[]): TaskStep[] {
  return sortSteps(steps).map((s, i) => ({ ...s, rank: (i + 1) * RANK_GAP }));
}

export function needsNormalize(steps: TaskStep[]): boolean {
  const sorted = sortSteps(steps);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.rank - sorted[i - 1]!.rank < 1e-6) return true;
  }
  return false;
}

/** Moves a step up (-1) or down (+1) by swapping ranks with its neighbour. */
export function moveStep(steps: TaskStep[], stepId: Id, direction: -1 | 1): TaskStep[] {
  const sorted = sortSteps(steps);
  const i = sorted.findIndex((s) => s.id === stepId);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= sorted.length) return sorted;
  const a = sorted[i]!;
  const b = sorted[j]!;
  sorted[i] = { ...b, rank: a.rank };
  sorted[j] = { ...a, rank: b.rank };
  return sortSteps(sorted);
}

export function todoSteps(steps: TaskStep[]): TaskStep[] {
  return sortSteps(steps).filter((s) => s.status === 'todo');
}

/**
 * The step to show in First Domino view: the current one if still to do, otherwise the
 * first required to-do step, otherwise the first optional one.
 */
export function pickCurrentStep(steps: TaskStep[], currentStepId?: Id): TaskStep | undefined {
  const todo = todoSteps(steps);
  const current = todo.find((s) => s.id === currentStepId);
  if (current) return current;
  return todo.find((s) => s.tier === 'required') ?? todo[0];
}

/** "Try another": the next to-do step after the current one, wrapping around. */
export function pickAnotherStep(steps: TaskStep[], currentStepId?: Id): TaskStep | undefined {
  const todo = todoSteps(steps);
  if (todo.length === 0) return undefined;
  const i = todo.findIndex((s) => s.id === currentStepId);
  return todo[(i + 1) % todo.length];
}

export function progressOf(steps: TaskStep[]): { done: number; total: number } {
  const counted = steps.filter((s) => s.status !== 'skipped');
  return { done: counted.filter((s) => s.status === 'done').length, total: counted.length };
}

/** A step the AI must not change without the user's say-so. */
export function isProtected(step: TaskStep): boolean {
  return step.status === 'done' || step.userEdited;
}

export interface NewStepInput {
  text: string;
  tier: StepTier;
  estimateMin?: number;
}

export function buildSteps(
  taskId: Id,
  inputs: NewStepInput[],
  origin: StepOrigin,
  newId: () => Id,
  now: number,
): TaskStep[] {
  return inputs.map((input, i) => ({
    id: newId(),
    taskId,
    text: input.text,
    tier: input.tier,
    status: 'todo',
    rank: (i + 1) * RANK_GAP,
    ...(input.estimateMin !== undefined ? { estimateMin: input.estimateMin } : {}),
    origin,
    userEdited: false,
    createdAt: now,
  }));
}

// ---------------------------------------------------------------------------
// Refinement merge
// ---------------------------------------------------------------------------

export type RefineOp =
  | { op: 'keep'; stepId: Id }
  | { op: 'update'; stepId: Id; text?: string; tier?: StepTier; estimateMin?: number }
  | {
      op: 'add';
      afterStepId: Id | null;
      text: string;
      tier: StepTier;
      estimateMin?: number;
    }
  | { op: 'remove'; stepId: Id }
  | { op: 'markDone'; stepId: Id };

export type Change =
  | { kind: 'added'; step: TaskStep }
  | { kind: 'changed'; before: TaskStep; after: TaskStep }
  | { kind: 'removed'; step: TaskStep };

/** A change that touches protected work, applied only if the user ticks it. */
export interface Suggestion {
  key: string;
  kind: 'change-protected' | 'remove-protected' | 'mark-done';
  stepId: Id;
  before: TaskStep;
  after?: TaskStep;
}

export interface RefinePreview {
  /** Steps after applying all automatic changes (suggestions not yet applied). */
  steps: TaskStep[];
  changes: Change[];
  suggestions: Suggestion[];
  /** Ops that referenced unknown steps or were otherwise unusable. */
  ignored: number;
}

/**
 * Merges refinement operations into the current plan.
 * Rules: completed or user-edited steps are never changed or removed automatically, and
 * nothing is marked done automatically; those become suggestions. Unknown IDs are ignored.
 * Steps not mentioned by any op are kept as they are.
 */
export function previewRefinement(
  current: TaskStep[],
  ops: RefineOp[],
  ctx: { taskId: Id; origin: StepOrigin; newId: () => Id; now: number },
): RefinePreview {
  const byId = new Map(current.map((s) => [s.id, s]));
  let steps = sortSteps(current);
  const changes: Change[] = [];
  const suggestions: Suggestion[] = [];
  let ignored = 0;
  const touched = new Set<Id>();

  const replace = (next: TaskStep) => {
    steps = steps.map((s) => (s.id === next.id ? next : s));
  };

  for (const op of ops) {
    if (op.op === 'add') {
      const text = op.text.trim();
      if (!text) {
        ignored++;
        continue;
      }
      const sorted = sortSteps(steps);
      let index: number;
      if (op.afterStepId === null) index = -1;
      else {
        index = sorted.findIndex((s) => s.id === op.afterStepId);
        if (index < 0) index = sorted.length - 1; // unknown anchor: append
      }
      const before = index >= 0 ? sorted[index]?.rank : undefined;
      const after = sorted[index + 1]?.rank;
      const step: TaskStep = {
        id: ctx.newId(),
        taskId: ctx.taskId,
        text,
        tier: op.tier,
        status: 'todo',
        rank: rankBetween(before, after),
        ...(op.estimateMin !== undefined ? { estimateMin: op.estimateMin } : {}),
        origin: ctx.origin,
        userEdited: false,
        createdAt: ctx.now,
      };
      steps = sortSteps([...steps, step]);
      changes.push({ kind: 'added', step });
      continue;
    }

    const original = byId.get(op.stepId);
    if (!original || touched.has(op.stepId)) {
      ignored++;
      continue;
    }
    if (op.op === 'keep') continue;
    touched.add(op.stepId);

    if (op.op === 'markDone') {
      if (original.status === 'done') continue;
      suggestions.push({
        key: `mark-done:${original.id}`,
        kind: 'mark-done',
        stepId: original.id,
        before: original,
        after: { ...original, status: 'done', completedAt: ctx.now },
      });
      continue;
    }

    if (op.op === 'remove') {
      if (isProtected(original)) {
        suggestions.push({
          key: `remove:${original.id}`,
          kind: 'remove-protected',
          stepId: original.id,
          before: original,
        });
      } else {
        steps = steps.filter((s) => s.id !== original.id);
        changes.push({ kind: 'removed', step: original });
      }
      continue;
    }

    // update
    const text = op.text?.trim();
    const next: TaskStep = {
      ...original,
      ...(text ? { text } : {}),
      ...(op.tier ? { tier: op.tier } : {}),
      ...(op.estimateMin !== undefined ? { estimateMin: op.estimateMin } : {}),
      origin: ctx.origin,
    };
    const differs =
      next.text !== original.text ||
      next.tier !== original.tier ||
      next.estimateMin !== original.estimateMin;
    if (!differs) continue;
    if (isProtected(original)) {
      suggestions.push({
        key: `change:${original.id}`,
        kind: 'change-protected',
        stepId: original.id,
        before: original,
        after: { ...next, userEdited: original.userEdited },
      });
    } else {
      replace(next);
      changes.push({ kind: 'changed', before: original, after: next });
    }
  }

  if (needsNormalize(steps)) steps = normalizeRanks(steps);
  return { steps: sortSteps(steps), changes, suggestions, ignored };
}

/** Applies the suggestions the user accepted on top of a preview's steps. */
export function acceptSuggestions(
  preview: RefinePreview,
  acceptedKeys: ReadonlySet<string>,
): TaskStep[] {
  let steps = preview.steps;
  for (const s of preview.suggestions) {
    if (!acceptedKeys.has(s.key)) continue;
    if (s.kind === 'remove-protected') steps = steps.filter((x) => x.id !== s.stepId);
    else if (s.after) steps = steps.map((x) => (x.id === s.stepId ? s.after! : x));
  }
  return sortSteps(steps);
}

export function hasAnyChange(preview: RefinePreview): boolean {
  return preview.changes.length > 0 || preview.suggestions.length > 0;
}
