import { beforeEach, describe, expect, it } from 'vitest';
import { freshDb } from '../test/db';
import { BackupError, createBackup, importBackup, parseBackup } from './backup';
import * as repo from './repo';

beforeEach(async () => {
  await freshDb();
});

describe('backup', () => {
  it('round-trips through JSON with replace', async () => {
    const t = await repo.createTask('Taxes');
    await repo.savePlan(t.id, [{ text: 'Find last year', tier: 'required' }], 'template');
    const json = JSON.stringify(await createBackup());
    await repo.deleteAllData();
    expect(await repo.listVisibleTasks()).toHaveLength(0);
    await importBackup(parseBackup(json), 'replace');
    expect((await repo.listVisibleTasks()).map((x) => x.title)).toEqual(['Taxes']);
    expect(await repo.getSteps(t.id)).toHaveLength(1);
  });

  it('merges without duplicating reward events', async () => {
    const t = await repo.createTask('A');
    const backup = await createBackup();
    await repo.createTask('B');
    await importBackup(backup, 'merge');
    const titles = (await repo.listVisibleTasks()).map((x) => x.title).sort();
    expect(titles).toEqual(['A', 'B']);
    expect(await repo.getTask(t.id)).toBeDefined();
  });

  it('rejects files that are not backups', () => {
    expect(() => parseBackup('not json')).toThrow(BackupError);
    expect(() => parseBackup('{"app":"other"}')).toThrow(BackupError);
    expect(() =>
      parseBackup(
        JSON.stringify({ app: 'task-unstucker', schemaVersion: 99, exportedAt: 1, data: {} }),
      ),
    ).toThrow(/newer version/);
  });
});
