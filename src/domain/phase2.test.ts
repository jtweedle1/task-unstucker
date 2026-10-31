import { describe, expect, it } from 'vitest';
import { splitBrainDump } from './braindump';
import { compareEstimate, estimatePattern } from './estimates';
import { finishLine } from './finish';
import {
  daysUntil,
  eligibleCandidates,
  fitsEnergy,
  pickRoulette,
  weightOf,
  type RouletteCandidate,
} from './roulette';
import { looksSafetyCritical } from './safety';
import { challengeFor, shouldOfferSetup } from './setup';
import { startTimer } from './timer';
import type { Energy, Task, TaskStatus, TaskStep } from './types';

const NOW = new Date(2026, 9, 31, 12, 0).getTime();

function task(id: string, extra: Partial<Task> = {}): Task {
  return { id, title: id, status: 'active', constraints: {}, createdAt: 0, updatedAt: 0, ...extra };
}
function step(id: string, extra: Partial<TaskStep> = {}): TaskStep {
  return {
    id,
    taskId: 't',
    text: id,
    tier: 'required',
    status: 'todo',
    rank: 1,
    origin: 'user',
    userEdited: false,
    createdAt: 0,
    ...extra,
  };
}

// Small seeded PRNG so the property tests are reproducible.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Task Roulette', () => {
  it('never picks done, deleted, excluded or filtered-out tasks (property test)', () => {
    const rng = mulberry32(42);
    const statuses: TaskStatus[] = ['active', 'saved', 'done'];
    const energies: (Energy | undefined)[] = [undefined, 'low', 'medium', 'high'];
    for (let round = 0; round < 500; round++) {
      const n = 1 + Math.floor(rng() * 12);
      const cands: RouletteCandidate[] = Array.from({ length: n }, (_, i) => ({
        task: task(`t${i}`, {
          status: statuses[Math.floor(rng() * 3)]!,
          ...(rng() < 0.2 ? { deletedAt: 1 } : {}),
          ...(rng() < 0.3 ? { pinned: true } : {}),
          energy: energies[Math.floor(rng() * 4)],
        }),
        ...(rng() < 0.7
          ? { nextStep: step(`s${i}`, { estimateMin: 1 + Math.floor(rng() * 30) }) }
          : {}),
      }));
      const exclude = new Set(cands.filter(() => rng() < 0.2).map((c) => c.task.id));
      const energy = energies[Math.floor(rng() * 4)];
      const maxMinutes = rng() < 0.5 ? 10 : undefined;
      const opts = {
        now: NOW,
        excludeIds: exclude,
        ...(energy ? { energy } : {}),
        ...(maxMinutes ? { maxMinutes } : {}),
      };
      const pick = pickRoulette(cands, opts, rng);
      const pool = eligibleCandidates(cands, opts);
      if (pool.length === 0) {
        expect(pick).toBeUndefined();
        continue;
      }
      expect(pick).toBeDefined();
      const t = pick!.task;
      expect(t.status).not.toBe('done');
      expect(t.deletedAt).toBeUndefined();
      expect(exclude.has(t.id)).toBe(false);
      expect(fitsEnergy(t.energy, energy)).toBe(true);
      if (maxMinutes && pick!.nextStep?.estimateMin) {
        expect(pick!.nextStep.estimateMin).toBeLessThanOrEqual(maxMinutes);
      }
    }
  });

  it('favours pinned and due-soon tasks but keeps every task possible', () => {
    const plain = { task: task('plain', { status: 'saved' }) };
    const pinned = { task: task('pinned', { status: 'saved', pinned: true }) };
    const due = { task: task('due', { status: 'saved', dueDate: '2026-11-01' }) };
    expect(weightOf(pinned, NOW)).toBeGreaterThan(weightOf(plain, NOW));
    expect(weightOf(due, NOW)).toBeGreaterThan(weightOf(pinned, NOW));
    const rng = mulberry32(7);
    const counts: Record<string, number> = { plain: 0, pinned: 0, due: 0 };
    for (let i = 0; i < 3000; i++)
      counts[pickRoulette([plain, pinned, due], { now: NOW }, rng)!.task.id]!++;
    expect(counts.plain).toBeGreaterThan(0);
    expect(counts.due!).toBeGreaterThan(counts.pinned!);
    expect(counts.pinned!).toBeGreaterThan(counts.plain!);
  });

  it('computes days until a local due date', () => {
    expect(daysUntil('2026-10-31', NOW)).toBe(0);
    expect(daysUntil('2026-11-01', NOW)).toBe(1);
    expect(daysUntil('2026-10-29', NOW)).toBe(-2);
    expect(daysUntil('not a date', NOW)).toBeUndefined();
  });

  it('matches energy: low energy only gets low or untagged tasks', () => {
    expect(fitsEnergy('low', 'low')).toBe(true);
    expect(fitsEnergy('high', 'low')).toBe(false);
    expect(fitsEnergy(undefined, 'low')).toBe(true);
    expect(fitsEnergy('high', 'high')).toBe(true);
    expect(fitsEnergy('medium', undefined)).toBe(true);
  });
});

describe('Finish-Line Finder', () => {
  it('separates must-dos from polish and uses a sensible default definition', () => {
    const steps = [
      step('a', { status: 'done', rank: 1 }),
      step('b', { rank: 2, text: 'Send the report' }),
      step('c', { rank: 3, tier: 'optional', text: 'Fix the fonts' }),
    ];
    const f = finishLine(steps);
    expect(f.mustDo.map((s) => s.id)).toEqual(['b']);
    expect(f.polish.map((s) => s.id)).toEqual(['c']);
    expect(f.definition).toBe('Done when: Send the report');
    expect(f.atFinish).toBe(false);
    expect(finishLine(steps, '  Sent to Sam  ').definition).toBe('Sent to Sam');
    expect(finishLine([steps[0]!, steps[2]!]).atFinish).toBe(true);
  });
});

describe('brain dump splitting', () => {
  it('splits lines, bullets, semicolons and sentences, and drops lead-ins', () => {
    const items = splitBrainDump(
      '- I need to call the dentist\n* email Sam about Friday; buy milk\n1. Pay rent. Remember to water plants\n\n[ ] book flights',
    );
    expect(items).toEqual([
      'Call the dentist',
      'Email Sam about Friday',
      'Buy milk',
      'Pay rent',
      'Water plants',
      'Book flights',
    ]);
  });

  it('splits run-on lists on "and" before an action', () => {
    expect(splitBrainDump('call mum, and email the landlord, pay the gas bill')).toEqual([
      'Call mum',
      'Email the landlord',
      'Pay the gas bill',
    ]);
  });

  it('dedupes, caps length and count, and ignores empty input', () => {
    expect(splitBrainDump('buy milk\nBuy milk.\n')).toEqual(['Buy milk']);
    expect(splitBrainDump('   \n\n')).toEqual([]);
    expect(splitBrainDump('x'.repeat(500))[0]!.length).toBeLessThanOrEqual(120);
    expect(
      splitBrainDump(Array.from({ length: 50 }, (_, i) => `task ${i}`).join('\n')),
    ).toHaveLength(30);
  });
});

describe('safety check', () => {
  it('flags health, safety, money and legal tasks', () => {
    expect(looksSafetyCritical('Refill my prescription')).toBe(true);
    expect(looksSafetyCritical('Fix the electrical outlet')).toBe(true);
    expect(looksSafetyCritical('Check for a gas leak')).toBe(true);
    expect(looksSafetyCritical('File taxes')).toBe(true);
    expect(looksSafetyCritical('Clean the kitchen')).toBe(false);
    expect(looksSafetyCritical('Wipe the counter next to the stove')).toBe(false);
    expect(looksSafetyCritical(undefined, 'Pay rent')).toBe(true);
  });
});

describe('setup prompts and challenges', () => {
  it('offers setup by preference and barrier', () => {
    expect(shouldOfferSetup(undefined, 'distracted', 'sprint')).toBe(true);
    expect(shouldOfferSetup(undefined, undefined, 'launch')).toBe(false);
    expect(shouldOfferSetup('always', undefined, 'launch')).toBe(true);
    expect(shouldOfferSetup('off', 'distracted', 'sprint')).toBe(false);
  });

  it('frames challenges by barrier and stays stable for a seed', () => {
    expect(challengeFor('perfect', 'x')).toMatch(/worst possible version/);
    expect(challengeFor('low-energy', 'x')).toMatch(/60 seconds/);
    expect(challengeFor(undefined, 'abc')).toBe(challengeFor(undefined, 'abc'));
  });
});

describe('time-estimate check', () => {
  it('compares guess and actual without judgement', () => {
    const t = { ...startTimer(10 * 60_000, 0), endedAt: 15 * 60_000 };
    const r = compareEstimate(10, t, 0)!;
    expect(r.actualMin).toBe(15);
    expect(r.text).toMatch(/Handy to know/);
    expect(
      compareEstimate(10, { ...startTimer(60_000, 0), endedAt: 10 * 60_000 }, 0)!.text,
    ).toMatch(/Right around/);
    expect(compareEstimate(10, { ...startTimer(60_000, 0), endedAt: 2 * 60_000 }, 0)!.text).toMatch(
      /Quicker/,
    );
    expect(compareEstimate(10, { ...startTimer(60_000, 0), endedAt: 10_000 }, 0)).toBeUndefined();
    expect(r.text).not.toMatch(/wrong|bad|fail|late/i);
  });

  it('summarises a pattern only after a few data points', () => {
    expect(estimatePattern([1.5, 2])).toBeUndefined();
    expect(estimatePattern([1, 0.9, 1.1])).toMatch(/usually close/);
    expect(estimatePattern([1.5, 2, 1.4, 1.6])).toMatch(/about 1.6×/);
    expect(estimatePattern([0.5, 0.4, 0.6])).toMatch(/less time/);
  });
});
