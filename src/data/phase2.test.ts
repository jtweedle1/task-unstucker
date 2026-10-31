import { beforeEach, describe, expect, it } from 'vitest';
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

describe('Phase 2 data', () => {
  it('saves a brain dump as separate saved tasks', async () => {
    const tasks = await repo.createTasks(['Call the dentist', '  ', 'Buy milk']);
    expect(tasks.map((t) => t.title)).toEqual(['Call the dentist', 'Buy milk']);
    expect(tasks.every((t) => t.status === 'saved')).toBe(true);
    expect(await d.events.count()).toBe(2);
  });

  it('closes a task as good enough and reopening clears the flag', async () => {
    const t = await repo.createTask('Write report');
    await repo.completeTask(t.id, { goodEnough: true });
    expect((await repo.getTask(t.id))?.goodEnough).toBe(true);
    await repo.reopenTask(t.id);
    const back = await repo.getTask(t.id);
    expect(back?.status).toBe('active');
    expect(back?.goodEnough).toBeUndefined();
  });

  it('lists roulette candidates with their next step, without deleted tasks', async () => {
    const a = await repo.createTask('A');
    await repo.savePlan(a.id, [{ text: 'First', tier: 'required' }], 'user', { firstStepIndex: 0 });
    const b = await repo.createTask('B');
    await repo.deleteTask(b.id);
    const c = await repo.listRouletteCandidates();
    expect(c).toHaveLength(1);
    expect(c[0]!.nextStep?.text).toBe('First');
  });

  it('records time-estimate ratios only for finished sessions with a guess', async () => {
    const s1 = await repo.startSession({ kind: 'sprint', minutes: 10, goal: 'x', guessMin: 10 });
    now += 15 * 60_000;
    await repo.finishSession(s1.id, 'done');
    const s2 = await repo.startSession({ kind: 'sprint', minutes: 10, goal: 'y' });
    now += 5 * 60_000;
    await repo.finishSession(s2.id, 'done');
    const s3 = await repo.startSession({ kind: 'sprint', minutes: 10, goal: 'z', guessMin: 5 });
    now += 60_000;
    await repo.finishSession(s3.id, 'pulled-away');
    expect(await repo.estimateRatios()).toEqual([1.5]);
  });

  it('stores pin, due date and energy on a task', async () => {
    const t = await repo.createTask('Taxes');
    await repo.updateTask(t.id, { pinned: true, dueDate: '2026-11-05', energy: 'high' });
    expect(await repo.getTask(t.id)).toMatchObject({
      pinned: true,
      dueDate: '2026-11-05',
      energy: 'high',
    });
  });
});
