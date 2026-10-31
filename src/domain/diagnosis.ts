// Stuck Diagnosis: a plain rules table mapping a barrier to interventions.
// Deterministic, explainable, and tested row by row.
import type { Barrier } from './types';

export type Method = 'breakdown' | 'launch' | 'focus' | 'saved-tasks';

export interface MethodInfo {
  id: Method;
  label: string;
  blurb: string;
}

export const METHODS: Record<Method, MethodInfo> = {
  breakdown: {
    id: 'breakdown',
    label: 'Find the first step',
    blurb: 'Break it into small steps and start with the easiest one.',
  },
  launch: {
    id: 'launch',
    label: 'Two-minute start',
    blurb: 'Work on it for just two minutes. Stopping after is fine.',
  },
  focus: {
    id: 'focus',
    label: 'Focus sprint',
    blurb: 'A short timer with a place to park stray thoughts.',
  },
  'saved-tasks': {
    id: 'saved-tasks',
    label: 'Look at saved tasks',
    blurb: 'Pick from what you already have.',
  },
};

export interface BarrierInfo {
  id: Barrier;
  label: string;
}

export const BARRIERS: BarrierInfo[] = [
  { id: 'no-start', label: "I don't know where to start" },
  { id: 'too-much', label: "It's too much" },
  { id: 'boring', label: "It's boring" },
  { id: 'distracted', label: 'I keep getting distracted' },
  { id: 'perfect', label: 'I want it to be perfect' },
  { id: 'low-energy', label: "I don't have much energy" },
  { id: 'cant-decide', label: "I can't decide what to do" },
  { id: 'almost-done', label: "I'm almost done but can't finish" },
];

export interface Recommendation {
  recommended: Method;
  alternatives: Method[];
  /** Short framing shown with the recommendation, e.g. why it fits. */
  reason: string;
  /** Default timer length when the method is a timer. */
  minutes?: number;
}

const RULES: Record<Barrier, Recommendation> = {
  'no-start': {
    recommended: 'breakdown',
    alternatives: ['launch'],
    reason: "When it's unclear where to begin, one concrete first step helps.",
  },
  'too-much': {
    recommended: 'breakdown',
    alternatives: ['launch'],
    reason: 'Smaller pieces make big tasks easier to begin.',
  },
  boring: {
    recommended: 'launch',
    alternatives: ['focus', 'breakdown'],
    reason: 'Make it a quick challenge: how far can you get in two minutes?',
    minutes: 2,
  },
  distracted: {
    recommended: 'focus',
    alternatives: ['launch', 'breakdown'],
    reason: 'A short sprint with a parking spot for stray thoughts.',
    minutes: 10,
  },
  perfect: {
    recommended: 'breakdown',
    alternatives: ['launch'],
    reason: 'Aim for a rough first pass. You can improve it later.',
  },
  'low-energy': {
    recommended: 'breakdown',
    alternatives: ['launch'],
    reason: "Let's find something small enough for right now.",
  },
  'cant-decide': {
    recommended: 'launch',
    alternatives: ['saved-tasks', 'breakdown'],
    reason: "Try this one for two minutes. If it doesn't fit, switch.",
    minutes: 2,
  },
  'almost-done': {
    recommended: 'breakdown',
    alternatives: ['focus'],
    reason: "Let's find the next small piece toward the finish.",
  },
};

/** Recommendation with no barrier chosen: the most broadly useful path. */
export const DEFAULT_RECOMMENDATION: Recommendation = {
  recommended: 'breakdown',
  alternatives: ['launch', 'focus'],
  reason: 'Start with one small, concrete step.',
};

export function recommend(barrier: Barrier | undefined): Recommendation {
  return barrier ? RULES[barrier] : DEFAULT_RECOMMENDATION;
}

export function barrierLabel(barrier: Barrier): string {
  return BARRIERS.find((b) => b.id === barrier)?.label ?? barrier;
}
