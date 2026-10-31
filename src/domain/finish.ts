// Finish-Line Finder: what's truly left, what "done" means, and what's optional polish.
import { sortSteps } from './plan';
import type { TaskStep } from './types';

export interface FinishLine {
  mustDo: TaskStep[];
  polish: TaskStep[];
  doneCount: number;
  definition: string;
  /** True when every required step is checked off. */
  atFinish: boolean;
}

export function defaultDefinition(steps: TaskStep[]): string {
  const required = sortSteps(steps).filter((s) => s.tier === 'required' && s.status !== 'skipped');
  const last = required[required.length - 1];
  return last ? `Done when: ${last.text}` : 'Done when the required steps are checked off.';
}

export function finishLine(steps: TaskStep[], doneDefinition?: string): FinishLine {
  const sorted = sortSteps(steps);
  const mustDo = sorted.filter((s) => s.tier === 'required' && s.status === 'todo');
  const polish = sorted.filter((s) => s.tier === 'optional' && s.status === 'todo');
  return {
    mustDo,
    polish,
    doneCount: sorted.filter((s) => s.status === 'done').length,
    definition: doneDefinition?.trim() || defaultDefinition(sorted),
    atFinish: mustDo.length === 0,
  };
}
