// Offline / no-AI fallbacks. Deterministic, so the core loop works without a network.
import type { Barrier } from './types';
import type { NewStepInput } from './plan';

export function clampTitle(title: string, max = 60): string {
  const t = title.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Generic quick steps for any task, tuned slightly by barrier. */
export function templateSteps(title: string, barrier?: Barrier): NewStepInput[] {
  const t = clampTitle(title);
  const first: NewStepInput =
    barrier === 'low-energy'
      ? { text: `Just look at "${t}" for one minute`, tier: 'required', estimateMin: 1 }
      : { text: `Gather or open what you need for "${t}"`, tier: 'required', estimateMin: 2 };
  const steps: NewStepInput[] = [
    first,
    { text: 'Do the smallest part you can see, for two minutes', tier: 'required', estimateMin: 2 },
    { text: 'Pick the next small piece and do it', tier: 'required', estimateMin: 5 },
    { text: 'Write a quick note about where you stopped', tier: 'optional', estimateMin: 1 },
  ];
  if (barrier === 'perfect') {
    steps.splice(2, 0, {
      text: 'Make a rough version on purpose. Polish comes later.',
      tier: 'required',
      estimateMin: 5,
    });
  }
  if (barrier === 'almost-done') {
    steps.splice(2, 0, {
      text: 'List what is truly left to call it done',
      tier: 'required',
      estimateMin: 2,
    });
  }
  return steps;
}

const EASIER_PREFIXES = [
  'Spend one minute on: ',
  'Just get set up for: ',
  'Only look at what this needs: ',
];

/**
 * A deterministic "make it easier" ladder. Each call wraps the original wording in a
 * smaller commitment; after the last rung it stays there.
 */
export function easierStep(text: string): string {
  let core = text;
  let level = -1;
  for (let i = 0; i < EASIER_PREFIXES.length; i++) {
    const p = EASIER_PREFIXES[i]!;
    if (core.startsWith(p)) {
      core = core.slice(p.length);
      level = i;
      break;
    }
  }
  const next = Math.min(level + 1, EASIER_PREFIXES.length - 1);
  return `${EASIER_PREFIXES[next]}${core}`;
}
