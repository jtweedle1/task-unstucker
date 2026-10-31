// Phase 2 task views: Good Enough Mode, Finish-Line Finder, task details, and timer setup.
import { useId, useState } from 'react';
import { suggestFinishLine } from '../../ai/client';
import {
  completeStep,
  completeTask,
  reopenTask,
  setStepTier,
  uncompleteStep,
  updateTask,
} from '../../data/repo';
import { finishLine } from '../../domain/finish';
import { sortSteps } from '../../domain/plan';
import { daysUntil } from '../../domain/roulette';
import { looksSafetyCritical, SAFETY_GOOD_ENOUGH_NOTE } from '../../domain/safety';
import { SETUP_PROMPTS } from '../../domain/setup';
import type { Task, TaskStep } from '../../domain/types';
import { sourceLabel, type ConsentRun } from '../components/AiConsent';
import { Dialog } from '../components/Dialog';
import { EnergyPicker } from '../components/EnergyPicker';
import { IconCheck } from '../components/Icons';
import { useToast } from '../components/Toast';

function StepCheckList({ steps, label }: { steps: TaskStep[]; label: string }) {
  return (
    <ul className="step-list" aria-label={label}>
      {steps.map((s) => (
        <li key={s.id} className={`step-item${s.status === 'done' ? ' done' : ''}`}>
          <button
            type="button"
            className="step-check"
            aria-pressed={s.status === 'done'}
            aria-label={`${s.status === 'done' ? 'Done' : 'Not done'}: ${s.text}`}
            onClick={() => void (s.status === 'done' ? uncompleteStep(s.id) : completeStep(s.id))}
          >
            <span className="box">{s.status === 'done' && <IconCheck />}</span>
          </button>
          <div className="step-body">
            <span className="step-text">{s.text}</span>
            {s.estimateMin && <div className="step-meta">about {s.estimateMin} min</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function useFinishTask(task: Task) {
  const toast = useToast();
  return async (goodEnough: boolean) => {
    await completeTask(task.id, { goodEnough });
    toast.show(goodEnough ? 'Done. Good enough is done.' : 'Task done. Nice work.', {
      actionLabel: 'Undo',
      onAction: () => void reopenTask(task.id),
    });
  };
}

/** Only the steps that matter. Optional steps are hidden, not deleted. */
export function GoodEnoughView({ task, steps }: { task: Task; steps: TaskStep[] }) {
  const finish = useFinishTask(task);
  const sorted = sortSteps(steps);
  const required = sorted.filter((s) => s.tier === 'required' && s.status !== 'skipped');
  const hidden = sorted.filter((s) => s.tier === 'optional' && s.status === 'todo').length;
  const left = required.filter((s) => s.status === 'todo').length;
  const risky = looksSafetyCritical(task.title, ...steps.map((s) => s.text));

  return (
    <section className="stack" aria-labelledby="ge-h">
      <h2 id="ge-h">Good-enough version</h2>
      <p className="muted">
        Just the steps that get it done. A rough, finished thing beats a perfect, unfinished one.
      </p>
      {risky && (
        <p className="notice" role="note">
          {SAFETY_GOOD_ENOUGH_NOTE}
        </p>
      )}
      {required.length === 0 ? (
        <p className="muted">No required steps. Mark some steps as required in the full plan.</p>
      ) : (
        <StepCheckList steps={required} label="Required steps" />
      )}
      {hidden > 0 && (
        <p className="muted small">
          {hidden} optional step{hidden === 1 ? '' : 's'} hidden. They're still in the full plan.
        </p>
      )}
      {task.status === 'done' ? (
        <p className="muted">This task is done.</p>
      ) : left === 0 ? (
        <button type="button" className="btn primary block" onClick={() => void finish(hidden > 0)}>
          {hidden > 0 ? 'Call it done (good enough)' : 'Mark task done'}
        </button>
      ) : (
        <p className="small">
          {left} required step{left === 1 ? '' : 's'} left.
        </p>
      )}
    </section>
  );
}

/** What's truly left, what "done" means, and what can wait. */
export function FinishView({
  task,
  steps,
  consentRun,
}: {
  task: Task;
  steps: TaskStep[];
  consentRun: ConsentRun;
}) {
  const toast = useToast();
  const finish = useFinishTask(task);
  const defId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [suggestion, setSuggestion] = useState<{
    ids: string[];
    origin: string;
    note?: string;
  } | null>(null);
  const f = finishLine(steps, task.doneDefinition);
  const definition = draft ?? task.doneDefinition ?? '';

  const suggest = async () => {
    setWorking(true);
    try {
      const out = await consentRun((s) => suggestFinishLine(task, steps, s));
      if (!definition.trim()) setDraft(out.doneDefinition);
      setSuggestion({
        ids: out.polishStepIds,
        origin: sourceLabel(out.origin),
        ...(out.fallbackReason ? { note: out.fallbackReason } : {}),
      });
      if (definition.trim() && out.doneDefinition !== definition) {
        toast.show(`Suggested: ${out.doneDefinition}`, {
          actionLabel: 'Use it',
          onAction: () => setDraft(out.doneDefinition),
        });
      }
    } finally {
      setWorking(false);
    }
  };

  const polishSuggested = steps.filter(
    (s) => suggestion?.ids.includes(s.id) && s.tier === 'required',
  );

  return (
    <section className="stack" aria-labelledby="fl-h">
      <h2 id="fl-h">Finish line</h2>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          // Confirm only once the write has landed, so "Saved." is true.
          void updateTask(task.id, {
            doneDefinition: definition.trim().slice(0, 200) || undefined,
          }).then(
            () => {
              setDraft(null);
              toast.show('Saved.');
            },
            () => toast.show("Couldn't save that. Try again."),
          );
        }}
      >
        <label htmlFor={defId}>What does "done" mean here?</label>
        <input
          id={defId}
          type="text"
          maxLength={200}
          value={definition}
          placeholder={f.definition}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="row">
          <button type="submit" className="btn" disabled={draft === null}>
            Save
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={working}
            onClick={() => void suggest()}
          >
            {working ? 'Thinking…' : 'Suggest one'}
          </button>
        </div>
      </form>

      {suggestion?.note && (
        <p className="notice warn" role="status">
          {suggestion.note} Used the steps you have instead.
        </p>
      )}
      {polishSuggested.length > 0 && (
        <div className="card soft stack">
          <p>
            These look like polish, not must-dos{' '}
            <span className={suggestion?.origin === 'Demo' ? 'tag demo' : 'tag'}>
              {suggestion?.origin}
            </span>
          </p>
          <ul>
            {polishSuggested.map((s) => (
              <li key={s.id}>{s.text}</li>
            ))}
          </ul>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              for (const s of polishSuggested) await setStepTier(s.id, 'optional');
              setSuggestion(null);
              toast.show('Marked as optional. Undo it from the full plan if needed.');
            }}
          >
            Mark them optional
          </button>
        </div>
      )}

      <h3 className="eyebrow">Must do ({f.mustDo.length})</h3>
      {f.mustDo.length === 0 ? (
        <p>Nothing required is left.</p>
      ) : (
        <StepCheckList steps={f.mustDo} label="Must do" />
      )}

      {f.polish.length > 0 && (
        <details>
          <summary>Optional polish ({f.polish.length})</summary>
          <StepCheckList steps={f.polish} label="Optional polish" />
        </details>
      )}

      {task.status === 'done' ? (
        <p className="muted">This task is done.</p>
      ) : (
        f.atFinish && (
          <button
            type="button"
            className="btn primary block"
            onClick={() => void finish(f.polish.length > 0)}
          >
            {f.polish.length > 0 ? 'Call it done, skip the polish' : 'Mark task done'}
          </button>
        )
      )}
    </section>
  );
}

function dueText(dueDate: string): string {
  const d = daysUntil(dueDate, Date.now());
  if (d === undefined) return '';
  if (d < 0) return 'was due earlier';
  if (d === 0) return 'due today';
  if (d === 1) return 'due tomorrow';
  return `due in ${d} days`;
}

/** Pin, due date and energy: inputs for Task Roulette and Energy Matching. */
export function TaskDetails({ task }: { task: Task }) {
  const dueId = useId();
  return (
    <details className="card soft">
      <summary>Details: pin, due date, energy</summary>
      <div className="stack" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="chip"
          aria-pressed={!!task.pinned}
          onClick={() => void updateTask(task.id, { pinned: !task.pinned })}
        >
          {task.pinned ? 'Pinned' : 'Pin this task'}
        </button>
        <div className="stack">
          <label htmlFor={dueId}>Due date (optional)</label>
          <div className="row">
            <input
              id={dueId}
              type="date"
              value={task.dueDate ?? ''}
              onChange={(e) => void updateTask(task.id, { dueDate: e.target.value || undefined })}
            />
            {task.dueDate && <span className="muted small">{dueText(task.dueDate)}</span>}
          </div>
        </div>
        <EnergyPicker
          legend="Energy it takes (optional)"
          value={task.energy}
          onChange={(energy) => void updateTask(task.id, { energy })}
        />
      </div>
    </details>
  );
}

export { dueText };

/** Optional quick setup before a timer. Never blocks starting. */
export function SetupDialog({
  open,
  onStart,
  onClose,
}: {
  open: boolean;
  onStart: () => void;
  onClose: () => void;
}) {
  const [done, setDone] = useState<Set<string>>(new Set());
  return (
    <Dialog open={open} onClose={onClose} title="Quick setup (optional)">
      <p className="muted small">Tick what helps. Skip the rest.</p>
      <div className="stack">
        {SETUP_PROMPTS.map((p) => (
          <label key={p.id} className="radio-row">
            <input
              type="checkbox"
              checked={done.has(p.id)}
              onChange={(e) => {
                const next = new Set(done);
                if (e.target.checked) next.add(p.id);
                else next.delete(p.id);
                setDone(next);
              }}
            />
            <span>{p.label}</span>
          </label>
        ))}
        <button
          type="button"
          className="btn primary block"
          onClick={() => {
            setDone(new Set());
            onStart();
          }}
        >
          Start the timer
        </button>
      </div>
    </Dialog>
  );
}
