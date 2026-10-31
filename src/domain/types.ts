// Core domain types. Pure data: no browser APIs, no persistence details.

export type Id = string;

export type TaskStatus = 'active' | 'saved' | 'done';
export type StepTier = 'required' | 'optional';
export type StepStatus = 'todo' | 'done' | 'skipped';
export type StepOrigin = 'ai' | 'demo' | 'template' | 'user';
export type Energy = 'low' | 'medium' | 'high';

export type Barrier =
  | 'no-start'
  | 'too-much'
  | 'boring'
  | 'distracted'
  | 'perfect'
  | 'low-energy'
  | 'cant-decide'
  | 'almost-done';

export interface TaskConstraints {
  minutesAvailable?: number;
  energy?: Energy;
  notes?: string;
}

/** A follow-up question offered by the breakdown to tailor the plan. Answering triggers a refine. */
export interface PlanQuestion {
  text: string;
  options: string[];
}

export interface Task {
  id: Id;
  title: string;
  status: TaskStatus;
  barrier?: Barrier;
  constraints: TaskConstraints;
  /** The step the user is currently looking at in First Domino view. */
  currentStepId?: Id;
  /** Where the plan came from, shown as a label so demo output is never mistaken for live AI. */
  planSource?: StepOrigin;
  planQuestion?: PlanQuestion;
  safetyNote?: string;
  /** Pinned tasks get extra weight in Task Roulette. */
  pinned?: boolean;
  /** Optional due date as a local calendar day, YYYY-MM-DD. */
  dueDate?: string;
  /** How much energy the task takes, set by the user. Used by Energy Matching. */
  energy?: Energy;
  /** Finish-Line Finder: what "done" means for this task, in the user's words. */
  doneDefinition?: string;
  /** Set when the task was closed with "good enough for now" (optional steps left open). */
  goodEnough?: boolean;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  /** Soft delete: set when deleted, purged later. Enables undo. */
  deletedAt?: number;
}

export interface TaskStep {
  id: Id;
  taskId: Id;
  text: string;
  tier: StepTier;
  status: StepStatus;
  /** Sort key. Fractional so reordering never renumbers siblings. */
  rank: number;
  estimateMin?: number;
  origin: StepOrigin;
  /** True once the user edits the text by hand. Protected from silent AI changes. */
  userEdited: boolean;
  createdAt: number;
  completedAt?: number;
}

export type RevisionCause =
  'generate' | 'refine' | 'edit' | 'reorder' | 'delete' | 'add' | 'restore';

export interface PlanRevision {
  id: Id;
  taskId: Id;
  createdAt: number;
  cause: RevisionCause;
  instruction?: string;
  /** Snapshot of the steps BEFORE the change, so restoring it undoes the change. */
  steps: TaskStep[];
}

export type SessionKind = 'launch' | 'sprint';
export type SessionOutcome = 'done' | 'progress' | 'pulled-away' | 'stopped';

export interface FocusSession {
  id: Id;
  taskId?: Id;
  stepId?: Id;
  /** Snapshot of what the user was focusing on, so the timer screen survives task deletion. */
  goal: string;
  kind: SessionKind;
  plannedMs: number;
  startedAt: number;
  pausedAt?: number;
  pausedTotalMs: number;
  endedAt?: number;
  outcome?: SessionOutcome;
  /** Time-estimate check: the user's (or the step's) guess in minutes, for comparison. */
  guessMin?: number;
  /** Micro-challenge framing shown during this session, if any. */
  challenge?: string;
}

export interface ParkedThought {
  id: Id;
  text: string;
  createdAt: number;
  sessionId?: Id;
  convertedTaskId?: Id;
  dismissedAt?: number;
}

export type ProgressEventType =
  'task-created' | 'step-done' | 'session-started' | 'session-finished' | 'task-done';

export interface ProgressEvent {
  id: Id;
  type: ProgressEventType;
  entityId: Id;
  createdAt: number;
  /** Unique. Makes rewards idempotent: the same achievement can't be recorded twice. */
  dedupeKey: string;
}

export type RewardsLevel = 'full' | 'quiet' | 'off';
/** When to offer setup prompts before a timer: always, only when distraction is the barrier, or never. */
export type SetupPromptPref = 'auto' | 'always' | 'off';
export type MotionPref = 'system' | 'reduced';
export type AiMode = 'live' | 'demo' | 'off';

export interface AppSettings {
  id: 'app';
  schemaVersion: number;
  rewardsLevel: RewardsLevel;
  motion: MotionPref;
  aiMode: AiMode;
  /** Set when the user accepts the one-time notice that task text is sent to the AI provider. */
  aiConsentAt?: number;
  /** Optional code required by the AI proxy when the deployer sets one. */
  aiAccessCode?: string;
  persistGranted?: boolean;
  lastExportAt?: number;
  dismissedResumeTaskId?: Id;
  setupPrompts?: SetupPromptPref;
  /** Offer playful micro-challenge framing on two-minute starts. */
  challenges?: boolean;
  /** Energy Matching: the user's self-reported energy and when they said it (it goes stale). */
  energyNow?: { level: Energy; at: number };
}

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'app',
  schemaVersion: 1,
  rewardsLevel: 'full',
  motion: 'system',
  aiMode: import.meta.env.VITE_PREVIEW ? 'demo' : 'live',
};
