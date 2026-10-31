import { beforeEach, describe, expect, it } from 'vitest';
import { previewRefinement, acceptSuggestions } from '../domain/plan';
import { remainingMs } from '../domain/timer';
import { freshDb } from '../test/db';
import type { UnstuckerDB } from './db';
import * as repo from './repo';

let d: UnstuckerDB;
let now = 1_000_000;
beforeEach(async () => {
  d = await freshDb();
  now = 1_000_000;
  repo.clock.now = () => now;
});

async function taskWithPlan() {
  const task = await repo.createTask('Clean my kitchen');
  await repo.savePlan(
    task.id,
    [
      { text: 'Put three dishes in the sink', tier: 'required' },
      { text: 'Wipe the counter', tier: 'required' },
      { text: 'Sweep the floor', tier: 'optional' },
    ],
    'demo',
    { firstStepIndex: 0 },
  );
  return task;
}

describe('tasks and plans', () => {
  it('creates a task without any account and records one event', async () => {
    const t = await repo.createTask('  Reply to landlord  ');
    expect(t.title).toBe('Reply to landlord');
    expect(await d.events.count()).toBe(1);
  });

  it('saves a plan and sets the first step as current', async () => {
    const t = await taskWithPlan();
    const steps = await repo.getSteps(t.id);
    expect(steps).toHaveLength(3);
    expect((await repo.getTask(t.id))?.currentStepId).toBe(steps[0]!.id);
  });

  it('completing a step advances to the next and is idempotent for rewards', async () => {
    const t = await taskWithPlan();
    const [s1, s2] = await repo.getSteps(t.id);
    expect((await repo.completeStep(s1!.id)).newlyRecorded).toBe(true);
    expect((await repo.getTask(t.id))?.currentStepId).toBe(s2!.id);
    await repo.uncompleteStep(s1!.id);
    expect((await repo.completeStep(s1!.id)).newlyRecorded).toBe(false);
    expect(await d.events.where('type').equals('step-done').count()).toBe(1);
  });

  it('refining after completing a step preserves completed progress, with undo', async () => {
    const t = await taskWithPlan();
    const [s1, s2, s3] = await repo.getSteps(t.id);
    await repo.completeStep(s1!.id);
    const before = await repo.getSteps(t.id);
    const preview = previewRefinement(
      before,
      [
        { op: 'remove', stepId: s1!.id }, // AI tries to drop finished work
        { op: 'update', stepId: s2!.id, text: 'Wipe one corner' },
        { op: 'remove', stepId: s3!.id },
      ],
      { taskId: t.id, origin: 'ai', newId: () => 'n1', now },
    );
    await repo.replaceSteps(t.id, acceptSuggestions(preview, new Set()), 'refine', {
      instruction: 'smaller',
    });
    const after = await repo.getSteps(t.id);
    expect(after.map((s) => [s.id, s.text, s.status])).toEqual([
      [s1!.id, 'Put three dishes in the sink', 'done'],
      [s2!.id, 'Wipe one corner', 'todo'],
    ]);
    expect((await repo.getTask(t.id))?.currentStepId).toBe(s2!.id);

    expect(await repo.undoLastChange(t.id)).toBe(true);
    expect((await repo.getSteps(t.id)).map((s) => s.text)).toEqual(before.map((s) => s.text));
  });

  it('manual edits mark steps as user-edited and can be undone', async () => {
    const t = await taskWithPlan();
    const [s1] = await repo.getSteps(t.id);
    await repo.editStepText(s1!.id, 'My own words');
    const edited = await d.steps.get(s1!.id);
    expect(edited?.userEdited).toBe(true);
    await repo.undoLastChange(t.id);
    expect((await d.steps.get(s1!.id))?.text).toBe('Put three dishes in the sink');
  });

  it('adds, moves, and deletes steps', async () => {
    const t = await taskWithPlan();
    const added = await repo.addStep(t.id, 'Open a window');
    expect((await repo.getSteps(t.id)).at(-1)?.id).toBe(added!.id);
    await repo.moveStep(added!.id, -1);
    expect((await repo.getSteps(t.id)).at(-2)?.id).toBe(added!.id);
    await repo.deleteStep(added!.id);
    expect(await repo.getSteps(t.id)).toHaveLength(3);
  });

  it('restoring an earlier revision is itself undoable', async () => {
    const t = await taskWithPlan();
    const [s1] = await repo.getSteps(t.id);
    await repo.deleteStep(s1!.id);
    const [rev] = await repo.listRevisions(t.id);
    await repo.restoreRevision(rev!.id);
    expect(await repo.getSteps(t.id)).toHaveLength(3);
    await repo.undoLastChange(t.id);
    expect(await repo.getSteps(t.id)).toHaveLength(2);
  });

  it('deleting a task is soft, restorable, and does not touch other tasks', async () => {
    const a = await taskWithPlan();
    const b = await repo.createTask('Other task');
    await repo.deleteTask(a.id);
    expect(await repo.getTask(a.id)).toBeUndefined();
    expect((await repo.listVisibleTasks()).map((t) => t.id)).toEqual([b.id]);
    await repo.restoreTask(a.id);
    expect(await repo.getTask(a.id)).toBeDefined();
    expect(await repo.getSteps(a.id)).toHaveLength(3);
  });

  it('purges tasks deleted more than 30 days ago with their steps', async () => {
    const a = await taskWithPlan();
    await repo.deleteTask(a.id);
    now += 31 * 24 * 3600_000;
    expect(await repo.purgeDeleted()).toBe(1);
    expect(await d.steps.where('taskId').equals(a.id).count()).toBe(0);
  });

  it('keeps at most 20 revisions per task', async () => {
    const t = await taskWithPlan();
    const [s1] = await repo.getSteps(t.id);
    for (let i = 0; i < 25; i++) {
      now += 1;
      await repo.editStepText(s1!.id, `Edit ${i}`);
    }
    expect(await d.revisions.where('taskId').equals(t.id).count()).toBe(20);
  });
});

describe('focus sessions', () => {
  it('start, pause, resume, and finish use timestamps', async () => {
    const s = await repo.startSession({ kind: 'launch', minutes: 2, goal: 'Dishes' });
    now += 30_000;
    await repo.pauseSession(s.id);
    now += 60_000; // paused for a minute
    await repo.resumeSession(s.id);
    now += 30_000;
    const live = (await repo.getActiveSession())!;
    expect(remainingMs(live, now)).toBe(60_000);
    await repo.finishSession(live.id, 'progress');
    expect(await repo.getActiveSession()).toBeUndefined();
  });

  it('survives a "reload" because state lives in IndexedDB', async () => {
    await repo.startSession({ kind: 'sprint', minutes: 10, goal: 'Essay' });
    now += 4 * 60_000;
    const reloaded = await repo.getActiveSession();
    expect(remainingMs(reloaded!, now)).toBe(6 * 60_000);
  });

  it('allows only one active timer', async () => {
    await repo.startSession({ kind: 'launch', minutes: 2, goal: 'A' });
    now += 1000;
    const b = await repo.startSession({ kind: 'launch', minutes: 2, goal: 'B' });
    expect((await repo.getActiveSession())?.id).toBe(b.id);
    expect(await d.sessions.filter((s) => s.endedAt === undefined).count()).toBe(1);
  });

  it('parks thoughts and converts them to tasks', async () => {
    const s = await repo.startSession({ kind: 'sprint', minutes: 5, goal: 'A' });
    await repo.parkThought('email Sam', s.id);
    const [t] = await repo.listOpenThoughts();
    const task = await repo.convertThoughtToTask(t!.id);
    expect(task?.status).toBe('saved');
    expect(await repo.listOpenThoughts()).toHaveLength(0);
  });
});

describe('settings', () => {
  it('returns defaults then persists changes', async () => {
    expect((await repo.getSettings()).aiMode).toBe('live');
    await repo.updateSettings({ rewardsLevel: 'off' });
    expect((await repo.getSettings()).rewardsLevel).toBe('off');
  });
});
