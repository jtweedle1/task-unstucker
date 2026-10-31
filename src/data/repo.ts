// Application use cases over IndexedDB. Every meaningful action is written immediately,
// inside a transaction, so closing or killing the app never loses progress.
import Dexie from 'dexie';
import { uuidv7 } from '../domain/ids';
import {
  buildSteps,
  moveStep as moveStepPure,
  needsNormalize,
  normalizeRanks,
  pickCurrentStep,
  rankBetween,
  sortSteps,
  type NewStepInput,
} from '../domain/plan';
import { dedupeKeyFor } from '../domain/rewards';
import { elapsedMs, extendTimer, pauseTimer, resumeTimer, startTimer } from '../domain/timer';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type Barrier,
  type FocusSession,
  type Id,
  type PlanQuestion,
  type ProgressEventType,
  type RevisionCause,
  type SessionKind,
  type SessionOutcome,
  type StepOrigin,
  type Task,
  type TaskStep,
} from '../domain/types';
import { db } from './db';

export const clock = { now: () => Date.now() };

const MAX_REVISIONS = 20;
const PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSettings(): Promise<AppSettings> {
  return (await db.settings.get('app')) ?? DEFAULT_SETTINGS;
}

export async function updateSettings(patch: Partial<Omit<AppSettings, 'id'>>): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const current = await getSettings();
    await db.settings.put({ ...current, ...patch, id: 'app' });
  });
}

// ---------------------------------------------------------------------------
// Events (idempotent)
// ---------------------------------------------------------------------------

export async function recordEvent(type: ProgressEventType, entityId: Id): Promise<boolean> {
  const dedupeKey = dedupeKeyFor(type, entityId);
  const exists = await db.events.where('dedupeKey').equals(dedupeKey).count();
  if (exists) return false;
  try {
    await db.events.add({ id: uuidv7(), type, entityId, createdAt: clock.now(), dedupeKey });
    return true;
  } catch (err) {
    if (err instanceof Dexie.ConstraintError) return false;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export async function createTask(title: string, extra: Partial<Task> = {}): Promise<Task> {
  const now = clock.now();
  const task: Task = {
    id: uuidv7(now),
    title: title.trim().slice(0, 300),
    status: 'active',
    constraints: {},
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
  await db.transaction('rw', db.tasks, db.events, async () => {
    await db.tasks.add(task);
    await recordEvent('task-created', task.id);
  });
  return task;
}

export async function getTask(id: Id): Promise<Task | undefined> {
  const t = await db.tasks.get(id);
  return t && !t.deletedAt ? t : undefined;
}

export async function updateTask(
  id: Id,
  patch: Partial<Omit<Task, 'id' | 'createdAt'>>,
): Promise<void> {
  await db.tasks.update(id, { ...patch, updatedAt: clock.now() });
}

export async function setBarrier(id: Id, barrier: Barrier | undefined): Promise<void> {
  const task = await db.tasks.get(id);
  if (!task) return;
  const { barrier: _old, ...rest } = task;
  await db.tasks.put({ ...rest, ...(barrier ? { barrier } : {}), updatedAt: clock.now() });
}

export async function completeTask(id: Id, opts: { goodEnough?: boolean } = {}): Promise<void> {
  await db.transaction('rw', db.tasks, db.events, async () => {
    const now = clock.now();
    await db.tasks.update(id, {
      status: 'done',
      completedAt: now,
      updatedAt: now,
      ...(opts.goodEnough ? { goodEnough: true } : {}),
    });
    await recordEvent('task-done', id);
  });
}

/** Brain dump: saves several tasks at once, as "saved for later". Returns them in order. */
export async function createTasks(titles: string[]): Promise<Task[]> {
  const clean = titles.map((t) => t.trim().slice(0, 300)).filter(Boolean);
  const out: Task[] = [];
  await db.transaction('rw', db.tasks, db.events, async () => {
    for (const title of clean) {
      const now = clock.now();
      const task: Task = {
        id: uuidv7(now),
        title,
        status: 'saved',
        constraints: {},
        createdAt: now,
        updatedAt: now,
      };
      await db.tasks.add(task);
      await recordEvent('task-created', task.id);
      out.push(task);
    }
  });
  return out;
}

export async function reopenTask(id: Id): Promise<void> {
  const task = await db.tasks.get(id);
  if (!task) return;
  const { completedAt: _c, goodEnough: _g, ...rest } = task;
  await db.tasks.put({ ...rest, status: 'active', updatedAt: clock.now() });
}

export async function saveTaskForLater(id: Id): Promise<void> {
  await updateTask(id, { status: 'saved' });
}

/** Soft delete so the action can be undone. */
export async function deleteTask(id: Id): Promise<void> {
  await db.tasks.update(id, { deletedAt: clock.now() });
}

export async function restoreTask(id: Id): Promise<void> {
  const task = await db.tasks.get(id);
  if (!task) return;
  const { deletedAt: _d, ...rest } = task;
  await db.tasks.put(rest);
}

/** Permanently removes tasks deleted more than 30 days ago, with their steps and history. */
export async function purgeDeleted(): Promise<number> {
  const cutoff = clock.now() - PURGE_AFTER_MS;
  return db.transaction('rw', db.tasks, db.steps, db.revisions, async () => {
    const old = await db.tasks
      .filter((t) => t.deletedAt !== undefined && t.deletedAt < cutoff)
      .toArray();
    for (const t of old) {
      await db.steps.where('taskId').equals(t.id).delete();
      await db.revisions.where('taskId').equals(t.id).delete();
      await db.tasks.delete(t.id);
    }
    return old.length;
  });
}

export async function listVisibleTasks(): Promise<Task[]> {
  const all = await db.tasks.orderBy('updatedAt').reverse().toArray();
  return all.filter((t) => !t.deletedAt);
}

// ---------------------------------------------------------------------------
// Steps and revisions
// ---------------------------------------------------------------------------

export async function getSteps(taskId: Id): Promise<TaskStep[]> {
  return sortSteps(await db.steps.where('taskId').equals(taskId).toArray());
}

async function snapshot(taskId: Id, cause: RevisionCause, instruction?: string): Promise<void> {
  const steps = await getSteps(taskId);
  await db.revisions.add({
    id: uuidv7(),
    taskId,
    createdAt: clock.now(),
    cause,
    ...(instruction ? { instruction } : {}),
    steps,
  });
  const all = await db.revisions.where('taskId').equals(taskId).sortBy('createdAt');
  const excess = all.length - MAX_REVISIONS;
  if (excess > 0) await db.revisions.bulkDelete(all.slice(0, excess).map((r) => r.id));
}

async function writeSteps(taskId: Id, steps: TaskStep[]): Promise<void> {
  const normalized = needsNormalize(steps) ? normalizeRanks(steps) : steps;
  await db.steps.where('taskId').equals(taskId).delete();
  await db.steps.bulkPut(normalized);
}

const STEP_TABLES = () => [db.tasks, db.steps, db.revisions, db.events] as const;

/** Replaces a task's whole plan, keeping a snapshot of the previous one for undo. */
export async function replaceSteps(
  taskId: Id,
  steps: TaskStep[],
  cause: RevisionCause,
  opts: { instruction?: string; currentStepId?: Id; taskPatch?: Partial<Task> } = {},
): Promise<void> {
  await db.transaction('rw', STEP_TABLES(), async () => {
    await snapshot(taskId, cause, opts.instruction);
    await writeSteps(taskId, steps);
    const current = pickCurrentStep(steps, opts.currentStepId);
    await db.tasks.update(taskId, {
      ...opts.taskPatch,
      currentStepId: current?.id,
      updatedAt: clock.now(),
    });
    for (const s of steps) if (s.status === 'done') await recordEvent('step-done', s.id);
  });
}

export async function savePlan(
  taskId: Id,
  inputs: NewStepInput[],
  origin: StepOrigin,
  extra: { firstStepIndex?: number; question?: PlanQuestion; safetyNote?: string } = {},
): Promise<TaskStep[]> {
  const steps = buildSteps(taskId, inputs, origin, () => uuidv7(), clock.now());
  const first = steps[extra.firstStepIndex ?? 0] ?? steps[0];
  const task = await db.tasks.get(taskId);
  if (!task) throw new Error('Task not found');
  const { planQuestion: _q, safetyNote: _s, ...rest } = task;
  await db.transaction('rw', STEP_TABLES(), async () => {
    await db.tasks.put({
      ...rest,
      planSource: origin,
      ...(extra.question ? { planQuestion: extra.question } : {}),
      ...(extra.safetyNote ? { safetyNote: extra.safetyNote } : {}),
    });
    await replaceSteps(taskId, steps, 'generate', {
      ...(first ? { currentStepId: first.id } : {}),
    });
  });
  return steps;
}

export async function setCurrentStep(taskId: Id, stepId: Id): Promise<void> {
  await updateTask(taskId, { currentStepId: stepId });
}

export async function completeStep(stepId: Id): Promise<{ newlyRecorded: boolean }> {
  return db.transaction('rw', STEP_TABLES(), async () => {
    const step = await db.steps.get(stepId);
    if (!step) return { newlyRecorded: false };
    await db.steps.update(stepId, { status: 'done', completedAt: clock.now() });
    const steps = await getSteps(step.taskId);
    const next = pickCurrentStep(steps);
    await db.tasks.update(step.taskId, { currentStepId: next?.id, updatedAt: clock.now() });
    const newlyRecorded = await recordEvent('step-done', stepId);
    return { newlyRecorded };
  });
}

export async function uncompleteStep(stepId: Id): Promise<void> {
  const step = await db.steps.get(stepId);
  if (!step) return;
  const { completedAt: _c, ...rest } = step;
  await db.steps.put({ ...rest, status: 'todo' });
  await updateTask(step.taskId, {});
}

export async function editStepText(stepId: Id, text: string): Promise<void> {
  const clean = text.trim().slice(0, 300);
  if (!clean) return;
  await db.transaction('rw', STEP_TABLES(), async () => {
    const step = await db.steps.get(stepId);
    if (!step || step.text === clean) return;
    await snapshot(step.taskId, 'edit');
    await db.steps.update(stepId, { text: clean, userEdited: true, origin: 'user' });
    await db.tasks.update(step.taskId, { updatedAt: clock.now() });
  });
}

/** Replaces a step's wording with an easier version. Not a manual edit, so not protected. */
export async function simplifyStep(
  stepId: Id,
  text: string,
  origin: StepOrigin,
  estimateMin?: number,
): Promise<void> {
  await db.transaction('rw', STEP_TABLES(), async () => {
    const step = await db.steps.get(stepId);
    if (!step) return;
    await snapshot(step.taskId, 'edit', 'Make it easier');
    await db.steps.update(stepId, {
      text: text.slice(0, 300),
      origin,
      ...(estimateMin !== undefined ? { estimateMin } : {}),
    });
    await db.tasks.update(step.taskId, { updatedAt: clock.now() });
  });
}

export async function addStep(
  taskId: Id,
  text: string,
  afterStepId?: Id,
): Promise<TaskStep | undefined> {
  const clean = text.trim().slice(0, 300);
  if (!clean) return undefined;
  return db.transaction('rw', STEP_TABLES(), async () => {
    const steps = await getSteps(taskId);
    const i = afterStepId ? steps.findIndex((s) => s.id === afterStepId) : steps.length - 1;
    const rank = rankBetween(steps[i]?.rank, steps[i + 1]?.rank);
    const step: TaskStep = {
      id: uuidv7(),
      taskId,
      text: clean,
      tier: 'required',
      status: 'todo',
      rank,
      origin: 'user',
      userEdited: true,
      createdAt: clock.now(),
    };
    await snapshot(taskId, 'add');
    await db.steps.add(step);
    const task = await db.tasks.get(taskId);
    await db.tasks.update(taskId, {
      updatedAt: clock.now(),
      ...(task?.currentStepId ? {} : { currentStepId: step.id }),
    });
    return step;
  });
}

export async function deleteStep(stepId: Id): Promise<void> {
  await db.transaction('rw', STEP_TABLES(), async () => {
    const step = await db.steps.get(stepId);
    if (!step) return;
    await snapshot(step.taskId, 'delete');
    await db.steps.delete(stepId);
    const task = await db.tasks.get(step.taskId);
    const steps = await getSteps(step.taskId);
    const current = pickCurrentStep(
      steps,
      task?.currentStepId === stepId ? undefined : task?.currentStepId,
    );
    await db.tasks.update(step.taskId, { currentStepId: current?.id, updatedAt: clock.now() });
  });
}

export async function moveStep(stepId: Id, direction: -1 | 1): Promise<void> {
  await db.transaction('rw', STEP_TABLES(), async () => {
    const step = await db.steps.get(stepId);
    if (!step) return;
    const steps = await getSteps(step.taskId);
    const moved = moveStepPure(steps, stepId, direction);
    if (moved.every((s, i) => s.id === steps[i]?.id)) return;
    await snapshot(step.taskId, 'reorder');
    await db.steps.bulkPut(moved);
    await db.tasks.update(step.taskId, { updatedAt: clock.now() });
  });
}

export async function setStepTier(stepId: Id, tier: TaskStep['tier']): Promise<void> {
  await db.transaction('rw', STEP_TABLES(), async () => {
    const step = await db.steps.get(stepId);
    if (!step || step.tier === tier) return;
    await snapshot(step.taskId, 'edit');
    await db.steps.update(stepId, { tier, userEdited: true });
  });
}

export async function listRevisions(taskId: Id) {
  return (await db.revisions.where('taskId').equals(taskId).sortBy('createdAt')).reverse();
}

/** Undo: restores the most recent snapshot and drops it. */
export async function undoLastChange(taskId: Id): Promise<boolean> {
  return db.transaction('rw', STEP_TABLES(), async () => {
    const [latest] = await listRevisions(taskId);
    if (!latest) return false;
    const task = await db.tasks.get(taskId);
    await writeSteps(taskId, latest.steps);
    await db.revisions.delete(latest.id);
    const current = pickCurrentStep(latest.steps, task?.currentStepId);
    await db.tasks.update(taskId, { currentStepId: current?.id, updatedAt: clock.now() });
    return true;
  });
}

/** Restores an earlier version. The current plan is snapshotted first, so this is undoable too. */
export async function restoreRevision(revisionId: Id): Promise<void> {
  const rev = await db.revisions.get(revisionId);
  if (!rev) return;
  await replaceSteps(rev.taskId, rev.steps, 'restore');
}

// ---------------------------------------------------------------------------
// Focus sessions
// ---------------------------------------------------------------------------

export async function getActiveSession(): Promise<FocusSession | undefined> {
  const open = await db.sessions.filter((s) => s.endedAt === undefined).toArray();
  return open.sort((a, b) => b.startedAt - a.startedAt)[0];
}

export async function startSession(input: {
  kind: SessionKind;
  minutes: number;
  goal: string;
  taskId?: Id;
  stepId?: Id;
  guessMin?: number;
  challenge?: string;
}): Promise<FocusSession> {
  const now = clock.now();
  const timer = startTimer(Math.round(input.minutes * 60_000), now);
  const session: FocusSession = {
    id: uuidv7(now),
    kind: input.kind,
    goal: input.goal.slice(0, 300),
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.stepId ? { stepId: input.stepId } : {}),
    ...(input.guessMin && input.guessMin > 0 ? { guessMin: Math.round(input.guessMin) } : {}),
    ...(input.challenge ? { challenge: input.challenge } : {}),
    plannedMs: timer.plannedMs,
    startedAt: timer.startedAt,
    pausedTotalMs: 0,
  };
  await db.transaction('rw', db.sessions, db.events, db.tasks, async () => {
    // Only one timer at a time: close any forgotten one without judging it.
    const open = await db.sessions.filter((s) => s.endedAt === undefined).toArray();
    for (const s of open) await db.sessions.update(s.id, { endedAt: now, outcome: 'stopped' });
    await db.sessions.add(session);
    await recordEvent('session-started', session.id);
    if (input.taskId) {
      const task = await db.tasks.get(input.taskId);
      if (task && task.status !== 'done') {
        await db.tasks.update(input.taskId, { status: 'active', updatedAt: now });
      }
    }
  });
  return session;
}

async function mutateSession(id: Id, fn: (s: FocusSession) => FocusSession): Promise<void> {
  await db.transaction('rw', db.sessions, async () => {
    const s = await db.sessions.get(id);
    if (!s) return;
    await db.sessions.put(fn(s));
  });
}

export const pauseSession = (id: Id) => mutateSession(id, (s) => pauseTimer(s, clock.now()));

export const resumeSession = (id: Id) => mutateSession(id, (s) => resumeTimer(s, clock.now()));

export const extendSession = (id: Id, minutes: number) =>
  mutateSession(id, (s) => extendTimer(s, minutes * 60_000));

export async function finishSession(id: Id, outcome: SessionOutcome): Promise<void> {
  await db.transaction('rw', db.sessions, db.events, async () => {
    const s = await db.sessions.get(id);
    if (!s || s.endedAt !== undefined) return;
    const now = clock.now();
    // Close an open pause so the recorded elapsed time is right.
    await db.sessions.put({ ...resumeTimer(s, now), endedAt: now, outcome });
    await recordEvent('session-finished', id);
  });
}

/** Task Roulette input: every visible task with its next step. */
export async function listRouletteCandidates(): Promise<{ task: Task; nextStep?: TaskStep }[]> {
  const tasks = await listVisibleTasks();
  const steps = await db.steps.toArray();
  return tasks.map((task) => {
    const next = pickCurrentStep(
      steps.filter((s) => s.taskId === task.id),
      task.currentStepId,
    );
    return next ? { task, nextStep: next } : { task };
  });
}

/** actual/guess ratios from finished sessions that had a guess, for the estimate pattern. */
export async function estimateRatios(limit = 30): Promise<number[]> {
  const ended = await db.sessions
    .filter(
      (s) =>
        s.endedAt !== undefined &&
        !!s.guessMin &&
        (s.outcome === 'done' || s.outcome === 'progress'),
    )
    .toArray();
  return ended
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit)
    .map((s) => elapsedMs(s, s.endedAt!) / 60_000 / s.guessMin!)
    .filter((r) => Number.isFinite(r) && r > 0);
}

// ---------------------------------------------------------------------------
// Parking lot
// ---------------------------------------------------------------------------

export async function parkThought(text: string, sessionId?: Id): Promise<void> {
  const clean = text.trim().slice(0, 500);
  if (!clean) return;
  await db.thoughts.add({
    id: uuidv7(),
    text: clean,
    createdAt: clock.now(),
    ...(sessionId ? { sessionId } : {}),
  });
}

export async function listOpenThoughts() {
  const all = await db.thoughts.orderBy('createdAt').reverse().toArray();
  return all.filter((t) => !t.dismissedAt && !t.convertedTaskId);
}

export async function dismissThought(id: Id): Promise<void> {
  await db.thoughts.update(id, { dismissedAt: clock.now() });
}

export async function restoreThought(id: Id): Promise<void> {
  const t = await db.thoughts.get(id);
  if (!t) return;
  const { dismissedAt: _d, ...rest } = t;
  await db.thoughts.put(rest);
}

export async function convertThoughtToTask(id: Id): Promise<Task | undefined> {
  const thought = await db.thoughts.get(id);
  if (!thought) return undefined;
  const task = await createTask(thought.text, { status: 'saved' });
  await db.thoughts.update(id, { convertedTaskId: task.id });
  return task;
}

// ---------------------------------------------------------------------------
// Danger zone
// ---------------------------------------------------------------------------

export async function deleteAllData(): Promise<void> {
  await db.transaction(
    'rw',
    [db.tasks, db.steps, db.revisions, db.sessions, db.thoughts, db.events, db.settings],
    async () => {
      await Promise.all([
        db.tasks.clear(),
        db.steps.clear(),
        db.revisions.clear(),
        db.sessions.clear(),
        db.thoughts.clear(),
        db.events.clear(),
        db.settings.clear(),
      ]);
    },
  );
}
