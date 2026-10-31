// Deterministic refinement rules. Power "Demo" mode and the offline quick chips, so common
// refinements still work without AI. Clearly limited: anything else needs live AI.
import { easierStep } from '../domain/templates';
import { isProtected, sortSteps, type RefineOp } from '../domain/plan';
import type { TaskStep } from '../domain/types';

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

export interface RuleResult {
  ops: RefineOp[];
  summary: string;
  understood: boolean;
}

export function ruleBasedRefine(steps: TaskStep[], instruction: string): RuleResult {
  const text = instruction.toLowerCase();
  const sorted = sortSteps(steps);
  const editable = sorted.filter((s) => s.status === 'todo' && !isProtected(s));

  const finished = text.match(
    /(?:finished|did|done with|completed)\s+(?:the\s+)?first\s+(\d+|one|two|three|four|five|six)/,
  );
  if (finished) {
    const n = Number(finished[1]) || NUMBER_WORDS[finished[1]!] || 0;
    const todo = sorted.filter((s) => s.status === 'todo').slice(0, n);
    return {
      ops: todo.map((s) => ({ op: 'markDone', stepId: s.id })),
      summary: `Marked the first ${todo.length} step${todo.length === 1 ? '' : 's'} as done, once you confirm.`,
      understood: true,
    };
  }

  if (/bare|minimum|minimal|good enough/.test(text)) {
    const optional = editable.filter((s) => s.tier === 'optional');
    return {
      ops: optional.map((s) => ({ op: 'remove', stepId: s.id })),
      summary: optional.length
        ? 'Dropped the optional steps.'
        : 'There were no optional steps to drop.',
      understood: true,
    };
  }

  const skip = text.match(
    /skip (?:anything |everything )?(?:involving |with |about )?(?:the )?([a-z]{3,})/,
  );
  if (skip) {
    const word = skip[1]!;
    const matches = editable.filter((s) => s.text.toLowerCase().includes(word));
    return {
      ops: matches.map((s) => ({ op: 'remove', stepId: s.id })),
      summary: matches.length ? `Removed steps about "${word}".` : `No steps mention "${word}".`,
      understood: true,
    };
  }

  if (/smaller|overwhelm|too much|easier|(\b|^)(2|5|two|five) ?min/.test(text)) {
    return {
      ops: editable.map((s) => ({ op: 'update', stepId: s.id, text: easierStep(s.text) })),
      summary: 'Made each remaining step smaller.',
      understood: true,
    };
  }

  if (/detail|more steps|thorough/.test(text)) {
    const last = sorted[sorted.length - 1];
    return {
      ops: [
        {
          op: 'add',
          afterStepId: last?.id ?? null,
          text: 'Check over what you did and fix one small thing',
          tier: 'optional',
          estimateMin: 3,
        },
      ],
      summary: 'Added a final check step.',
      understood: true,
    };
  }

  return { ops: [], summary: '', understood: false };
}

export const QUICK_REFINES = [
  { label: 'Smaller steps', instruction: 'Make the steps smaller.' },
  { label: 'Only 5 minutes', instruction: 'I only have five minutes.' },
  { label: 'Bare minimum', instruction: 'Give me the bare-minimum version.' },
  { label: 'More detail', instruction: 'Make this more detailed.' },
] as const;
