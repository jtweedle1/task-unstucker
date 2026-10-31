// Environment setup prompts and micro-challenges for timers. Deterministic, no AI.
import type { Barrier, SessionKind, SetupPromptPref } from './types';

export interface SetupPrompt {
  id: string;
  label: string;
}

export const SETUP_PROMPTS: SetupPrompt[] = [
  { id: 'phone', label: 'Phone face down or in another room' },
  { id: 'water', label: 'Get some water' },
  { id: 'spot', label: 'Clear one small spot to work' },
  { id: 'open', label: 'Open just the thing you need' },
  { id: 'tabs', label: "Close tabs you don't need" },
  { id: 'sound', label: 'Headphones or quiet, if that helps' },
];

/** Whether to show the setup card before a timer starts. */
export function shouldOfferSetup(
  pref: SetupPromptPref | undefined,
  barrier: Barrier | undefined,
  kind: SessionKind,
): boolean {
  const p = pref ?? 'auto';
  if (p === 'off') return false;
  if (p === 'always') return true;
  return barrier === 'distracted' || (kind === 'sprint' && barrier === 'boring');
}

const GENERAL = [
  'See how far you can get before the timer rings.',
  'Race the clock: how much of this can you do in two minutes?',
  "Touch the task for 60 seconds. That's the whole challenge.",
  "Pretend you're showing someone else how it's done.",
];

function hash(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

/** A light challenge framing for a two-minute start. Stable for the same seed. */
export function challengeFor(barrier: Barrier | undefined, seed: string): string {
  if (barrier === 'perfect') return 'Make the worst possible version for two minutes. On purpose.';
  if (barrier === 'low-energy') return "Touch the task for 60 seconds. That's the whole challenge.";
  return GENERAL[hash(seed) % GENERAL.length]!;
}
