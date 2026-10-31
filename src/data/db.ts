// IndexedDB schema (via Dexie). Each schema change gets a new version number and, if data
// needs reshaping, an upgrade function plus a test that upgrades an older database.
import Dexie, { type EntityTable } from 'dexie';
import type {
  AppSettings,
  FocusSession,
  ParkedThought,
  PlanRevision,
  ProgressEvent,
  Task,
  TaskStep,
} from '../domain/types';

export const DB_NAME = 'task-unstucker';
export const SCHEMA_VERSION = 1;

export class UnstuckerDB extends Dexie {
  tasks!: EntityTable<Task, 'id'>;
  steps!: EntityTable<TaskStep, 'id'>;
  revisions!: EntityTable<PlanRevision, 'id'>;
  sessions!: EntityTable<FocusSession, 'id'>;
  thoughts!: EntityTable<ParkedThought, 'id'>;
  events!: EntityTable<ProgressEvent, 'id'>;
  settings!: EntityTable<AppSettings, 'id'>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      tasks: 'id, status, updatedAt, deletedAt',
      steps: 'id, taskId',
      revisions: 'id, taskId, createdAt',
      sessions: 'id, taskId, startedAt, endedAt',
      thoughts: 'id, createdAt',
      events: 'id, &dedupeKey, createdAt, type',
      settings: 'id',
    });
  }
}

export let db = new UnstuckerDB();

/** Tests use a fresh database per test. */
export function setDatabase(next: UnstuckerDB): void {
  db = next;
}

export const TABLES = [
  'tasks',
  'steps',
  'revisions',
  'sessions',
  'thoughts',
  'events',
  'settings',
] as const;
export type TableName = (typeof TABLES)[number];
