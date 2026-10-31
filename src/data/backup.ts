// Export and import. The only real backup while data lives in browser storage.
import { z } from 'zod';
import { db, SCHEMA_VERSION, TABLES, type TableName } from './db';
import { clock, updateSettings } from './repo';

export const BACKUP_APP_ID = 'task-unstucker';

const record = z.looseObject({ id: z.string().min(1) });

const BackupSchema = z.object({
  app: z.literal(BACKUP_APP_ID),
  schemaVersion: z.number().int().min(1),
  exportedAt: z.number(),
  data: z.object(
    Object.fromEntries(TABLES.map((t) => [t, z.array(record).default([])])) as Record<
      TableName,
      z.ZodDefault<z.ZodArray<typeof record>>
    >,
  ),
});

export type Backup = z.infer<typeof BackupSchema>;

export async function createBackup(): Promise<Backup> {
  const data = {} as Backup['data'];
  await db.transaction(
    'r',
    TABLES.map((t) => db.table(t)),
    async () => {
      for (const t of TABLES) data[t] = await db.table(t).toArray();
    },
  );
  return { app: BACKUP_APP_ID, schemaVersion: SCHEMA_VERSION, exportedAt: clock.now(), data };
}

export function backupFileName(now: number): string {
  return `task-unstucker-backup-${new Date(now).toISOString().slice(0, 10)}.json`;
}

export async function exportToFile(): Promise<void> {
  const backup = await createBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFileName(backup.exportedAt);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  await updateSettings({ lastExportAt: backup.exportedAt });
}

export class BackupError extends Error {}

export function parseBackup(text: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError("That file isn't a Task Unstucker backup.");
  }
  const parsed = BackupSchema.safeParse(raw);
  if (!parsed.success) throw new BackupError("That file isn't a Task Unstucker backup.");
  if (parsed.data.schemaVersion > SCHEMA_VERSION) {
    throw new BackupError('This backup is from a newer version of the app. Update the app first.');
  }
  return migrateBackup(parsed.data);
}

/** Upgrades older backups to the current schema. Version 1 is current, so nothing to do yet. */
export function migrateBackup(backup: Backup): Backup {
  return { ...backup, schemaVersion: SCHEMA_VERSION };
}

function updatedAtOf(r: Record<string, unknown>): number {
  const v = r.updatedAt ?? r.createdAt;
  return typeof v === 'number' ? v : 0;
}

/**
 * Replace wipes current data first. Merge keeps current data and adds backup records,
 * letting the newer copy win when both have the same id.
 */
export async function importBackup(backup: Backup, mode: 'replace' | 'merge'): Promise<void> {
  await db.transaction(
    'rw',
    TABLES.map((t) => db.table(t)),
    async () => {
      for (const t of TABLES) {
        const table = db.table(t);
        const incoming = backup.data[t] as Record<string, unknown>[];
        if (mode === 'replace') {
          await table.clear();
          await table.bulkPut(incoming);
          continue;
        }
        for (const rec of incoming) {
          const existing = (await table.get(rec.id as string)) as
            Record<string, unknown> | undefined;
          if (t === 'events' && !existing) {
            const dupe = await db.events.where('dedupeKey').equals(String(rec.dedupeKey)).count();
            if (dupe) continue;
          }
          if (!existing || updatedAtOf(rec) > updatedAtOf(existing)) await table.put(rec);
        }
      }
    },
  );
}
