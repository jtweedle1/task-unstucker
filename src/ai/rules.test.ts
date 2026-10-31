import { describe, expect, it } from 'vitest';
import { buildSteps } from '../domain/plan';
import { ruleBasedRefine } from './rules';

let i = 0;
const steps = buildSteps(
  't',
  [
    { text: 'Put dishes in sink', tier: 'required' },
    { text: 'Wipe counter', tier: 'required' },
    { text: 'Sweep the floor', tier: 'optional' },
  ],
  'demo',
  () => `s${++i}`,
  0,
);

describe('ruleBasedRefine', () => {
  it('bare minimum removes optional steps', () => {
    expect(ruleBasedRefine(steps, 'Give me the bare-minimum version.').ops).toEqual([
      { op: 'remove', stepId: 's3' },
    ]);
  });
  it('skip removes matching steps', () => {
    expect(ruleBasedRefine(steps, 'Skip anything involving the floor.').ops).toEqual([
      { op: 'remove', stepId: 's3' },
    ]);
  });
  it('already finished marks steps for confirmation', () => {
    const r = ruleBasedRefine(steps, 'I already finished the first two steps');
    expect(r.ops).toEqual([
      { op: 'markDone', stepId: 's1' },
      { op: 'markDone', stepId: 's2' },
    ]);
  });
  it('smaller rewrites remaining steps', () => {
    const r = ruleBasedRefine(steps, 'I only have five minutes.');
    expect(r.ops).toHaveLength(3);
    expect(r.understood).toBe(true);
  });
  it('says when it does not understand', () => {
    expect(ruleBasedRefine(steps, 'I have no cleaning supplies').understood).toBe(false);
  });
});
