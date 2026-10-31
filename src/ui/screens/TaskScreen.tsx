import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  AiError,
  generatePlan,
  makeStepEasier,
  refinePlan,
  type RefineOutcome,
} from '../../ai/client';
import { QUICK_REFINES } from '../../ai/rules';
import { db } from '../../data/db';
import {
  addStep,
  completeStep,
  completeTask,
  deleteStep,
  deleteTask,
  editStepText,
  getSettings,
  getSteps,
  listRevisions,
  moveStep,
  reopenTask,
  replaceSteps,
  restoreRevision,
  restoreTask,
  saveTaskForLater,
  savePlan,
  setBarrier,
  setCurrentStep,
  setStepTier,
  simplifyStep,
  startSession,
  uncompleteStep,
  undoLastChange,
  updateTask,
} from '../../data/repo';
import { BARRIERS, METHODS, recommend, type Method } from '../../domain/diagnosis';
import {
  acceptSuggestions,
  pickAnotherStep,
  pickCurrentStep,
  progressOf,
  sortSteps,
} from '../../domain/plan';
import { celebrationText } from '../../domain/rewards';
import type { AppSettings, StepOrigin, Task, TaskStep } from '../../domain/types';
import { useAiConsent } from '../components/AiConsent';
import { Celebrate } from '../components/Celebrate';
import { Dialog } from '../components/Dialog';
import { IconCheck, IconDown, IconUp } from '../components/Icons';
import { RefinePreviewDialog } from '../components/RefinePreviewDialog';
import { SprintPicker } from '../components/SprintPicker';
import { useToast } from '../components/Toast';
import { useSettings } from '../hooks';

export function sourceLabel(origin: StepOrigin | undefined): string {
  switch (origin) {
    case 'ai':
      return 'AI';
    case 'demo':
      return 'Demo';
    case 'template':
      return 'Quick steps';
    case 'user':
      return 'Your steps';
    default:
      return '';
  }
}

/** Runs an AI action; if it needs consent, asks once, then runs again with fresh settings. */
function useWithConsent() {
  const consent = useAiConsent();
  const run = async <T,>(fn: (s: AppSettings) => Promise<T>): Promise<T> => {
    try {
      return await fn(await getSettings());
    } catch (err) {
      if (err instanceof AiError && err.code === 'consent') {
        await consent.ensure();
        return fn(await getSettings());
      }
      throw err;
    }
  };
  return { run, dialog: consent.dialog };
}

export function TaskScreen() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'all' ? 'all' : 'domino';
  const settings = useSettings();
  const toast = useToast();
  const consent = useWithConsent();

  const task = useLiveQuery(async () => (await db.tasks.get(id)) ?? null, [id]);
  const steps = useLiveQuery(() => getSteps(id), [id]);

  const [generating, setGenerating] = useState(false);
  const [fallbackReason, setFallbackReason] = useState<string | undefined>();
  const [celebration, setCelebration] = useState<string | undefined>();
  const [sprintOpen, setSprintOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (task === undefined || steps === undefined) return <p aria-busy="true">Loading…</p>;
  if (task === null || task.deletedAt) {
    return (
      <div className="stack">
        <h1>This task isn't here</h1>
        <p className="muted">It may have been deleted.</p>
        <Link to="/" className="btn primary">
          Go to start
        </Link>
      </div>
    );
  }

  const current = pickCurrentStep(steps, task.currentStepId);

  const startTimer = async (kind: 'launch' | 'sprint', minutes: number) => {
    await startSession({
      kind,
      minutes,
      goal: current?.text ?? task.title,
      taskId: task.id,
      ...(current ? { stepId: current.id } : {}),
    });
    navigate(`/task/${task.id}/do`);
  };

  const generate = async () => {
    setGenerating(true);
    setFallbackReason(undefined);
    try {
      const outcome = await consent.run((s) => generatePlan(task, s));
      await savePlan(task.id, outcome.result.steps, outcome.origin, {
        firstStepIndex: outcome.result.firstStepIndex,
        ...(outcome.result.question ? { question: outcome.result.question } : {}),
        ...(outcome.result.safetyNote ? { safetyNote: outcome.result.safetyNote } : {}),
      });
      setFallbackReason(outcome.fallbackReason);
      setParams({}, { replace: true });
    } finally {
      setGenerating(false);
    }
  };

  const chooseMethod = (m: Method) => {
    if (m === 'breakdown') void generate();
    else if (m === 'launch') void startTimer('launch', 2);
    else if (m === 'focus') setSprintOpen(true);
    else navigate('/tasks');
  };

  const sprintPicker = (
    <SprintPicker
      open={sprintOpen}
      onClose={() => setSprintOpen(false)}
      onPick={(m) => {
        setSprintOpen(false);
        void startTimer('sprint', m);
      }}
    />
  );

  // ---------------- No plan yet: diagnosis + method choice ----------------
  if (steps.length === 0) {
    const rec = recommend(task.barrier);
    return (
      <div className="stack">
        <h1 className="step-text">{task.title}</h1>
        <section aria-labelledby="why-h">
          <h2 id="why-h" className="eyebrow">
            Why is it hard? (optional)
          </h2>
          <div className="chip-grid">
            {BARRIERS.map((b) => (
              <button
                key={b.id}
                type="button"
                className="chip"
                aria-pressed={task.barrier === b.id}
                onClick={() => void setBarrier(task.id, task.barrier === b.id ? undefined : b.id)}
              >
                {b.label}
              </button>
            ))}
          </div>
        </section>
        <section className="card blue" aria-labelledby="rec-h" aria-busy={generating}>
          <p className="eyebrow" id="rec-h">
            Suggested
          </p>
          <p>{rec.reason}</p>
          <button
            type="button"
            className="btn primary big"
            disabled={generating}
            onClick={() => chooseMethod(rec.recommended)}
          >
            {generating && rec.recommended === 'breakdown'
              ? 'Finding a first step…'
              : METHODS[rec.recommended].label}
          </button>
          <div className="row" style={{ marginTop: 12 }}>
            <span className="muted small">Or:</span>
            {rec.alternatives.map((m) => (
              <button
                key={m}
                type="button"
                className="btn"
                disabled={generating}
                onClick={() => chooseMethod(m)}
              >
                {generating && m === 'breakdown' ? 'Finding a first step…' : METHODS[m].label}
              </button>
            ))}
          </div>
        </section>
        <p>
          <button type="button" className="btn ghost" onClick={() => setParams({ view: 'all' })}>
            Write my own steps
          </button>
        </p>
        {view === 'all' && (
          <AllSteps task={task} steps={steps} settings={settings} consentRun={consent.run} />
        )}
        {sprintPicker}
        {consent.dialog}
      </div>
    );
  }

  const { done, total } = progressOf(steps);
  const label = sourceLabel(task.planSource);

  // ---------------- Full plan view ----------------
  if (view === 'all') {
    return (
      <div className="stack">
        <div className="row">
          <button type="button" className="btn ghost" onClick={() => setParams({})}>
            ← One step at a time
          </button>
        </div>
        <h1 className="step-text">{task.title}</h1>
        <p className="muted small">
          {done} of {total} done{' '}
          {label && <span className={label === 'Demo' ? 'tag demo' : 'tag'}>{label}</span>}
        </p>
        <AllSteps task={task} steps={steps} settings={settings} consentRun={consent.run} />
        <TaskFooter task={task} />
        {consent.dialog}
      </div>
    );
  }

  // ---------------- First Domino view (default) ----------------
  const onDone = async () => {
    if (!current || busy) return;
    setBusy(true);
    try {
      await completeStep(current.id);
      setCelebration(celebrationText(current.id));
    } finally {
      setBusy(false);
    }
  };

  const onEasier = async () => {
    if (!current || busy) return;
    setBusy(true);
    try {
      const r = await makeStepEasier(task, current, await getSettings());
      await simplifyStep(current.id, r.text, r.origin, r.estimateMin);
      toast.show('Made it smaller.', {
        actionLabel: 'Undo',
        onAction: () => void undoLastChange(task.id),
      });
    } finally {
      setBusy(false);
    }
  };

  const onAnother = async () => {
    const next = pickAnotherStep(steps, current?.id);
    setCelebration(undefined);
    if (next && next.id !== current?.id) await setCurrentStep(task.id, next.id);
    else toast.show('This is the only step left.');
  };

  return (
    <div className="stack">
      <h1 className="step-text" style={{ fontSize: '1.25rem' }}>
        {task.title}
      </h1>
      <p className="muted small">
        {current ? `Step ${done + 1} of ${total}` : `All ${total} steps done`}{' '}
        {label && <span className={label === 'Demo' ? 'tag demo' : 'tag'}>{label}</span>}
      </p>

      {fallbackReason && (
        <div className="notice warn" role="status">
          <p>{fallbackReason} Here are quick steps instead.</p>
          <button
            type="button"
            className="btn"
            onClick={() => void generate()}
            disabled={generating}
          >
            {generating ? 'Trying…' : 'Try AI again'}
          </button>
        </div>
      )}
      {task.safetyNote && <p className="notice">{task.safetyNote}</p>}
      {celebration && <Celebrate message={celebration} settings={settings} />}

      {current ? (
        <section className="domino" aria-labelledby="domino-h">
          <p className="eyebrow" id="domino-h">
            Start with this
          </p>
          <p className="domino-step">{current.text}</p>
          <button
            type="button"
            className="btn primary big"
            onClick={() => void startTimer('launch', 2)}
          >
            Start (2 min)
          </button>
          <div className="domino-actions">
            <button type="button" className="btn" onClick={() => void onEasier()} disabled={busy}>
              Make it easier
            </button>
            <button type="button" className="btn" onClick={() => void onAnother()}>
              Try another
            </button>
            <button type="button" className="btn" onClick={() => void onDone()} disabled={busy}>
              I've done it
            </button>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                await saveTaskForLater(task.id);
                toast.show('Saved. You can come back to this.');
                navigate('/');
              }}
            >
              Save for later
            </button>
          </div>
        </section>
      ) : (
        <section className="card lilac stack">
          <p>
            <strong>Every step is checked off.</strong> Is the task done, or is there something
            left?
          </p>
          {task.status !== 'done' ? (
            <button
              type="button"
              className="btn primary block"
              onClick={async () => {
                await completeTask(task.id);
                toast.show('Task done. Nice work.', {
                  actionLabel: 'Undo',
                  onAction: () => void reopenTask(task.id),
                });
              }}
            >
              Mark task done
            </button>
          ) : (
            <p className="muted">This task is done.</p>
          )}
          <button type="button" className="btn block" onClick={() => setParams({ view: 'all' })}>
            Add a step
          </button>
        </section>
      )}

      {task.planQuestion && current && (
        <QuestionCard task={task} steps={steps} consentRun={consent.run} />
      )}

      <div className="row">
        <button type="button" className="btn ghost" onClick={() => setParams({ view: 'all' })}>
          See all steps ({total})
        </button>
        <button type="button" className="btn ghost" onClick={() => setSprintOpen(true)}>
          Focus sprint…
        </button>
      </div>
      {sprintPicker}
      {consent.dialog}
    </div>
  );
}

type ConsentRun = ReturnType<typeof useWithConsent>['run'];

/** Shared refine flow: request a proposal, preview it, apply with undo. */
function useRefine(task: Task, steps: TaskStep[], consentRun: ConsentRun) {
  const toast = useToast();
  const [pending, setPending] = useState<(RefineOutcome & { instruction: string }) | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const request = async (instruction: string) => {
    setWorking(true);
    setError(undefined);
    try {
      const outcome = await consentRun((s) => refinePlan(task, steps, instruction, s));
      setPending({ ...outcome, instruction });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Try a chip instead.");
      return false;
    } finally {
      setWorking(false);
    }
  };

  const apply = async (accepted: Set<string>) => {
    if (!pending) return;
    const next = acceptSuggestions(pending.preview, accepted);
    await replaceSteps(task.id, next, 'refine', {
      instruction: pending.instruction,
      ...(task.currentStepId ? { currentStepId: task.currentStepId } : {}),
    });
    if (task.planQuestion) await updateTask(task.id, { planQuestion: undefined });
    setPending(null);
    toast.show('Plan updated.', {
      actionLabel: 'Undo',
      onAction: () => void undoLastChange(task.id),
    });
  };

  const dialog = (
    <RefinePreviewDialog
      preview={pending?.preview ?? null}
      summary={pending?.summary ?? ''}
      sourceLabel={sourceLabel(pending?.origin)}
      onApply={(a) => void apply(a)}
      onCancel={() => setPending(null)}
    />
  );
  return { request, working, error, dialog };
}

function QuestionCard({
  task,
  steps,
  consentRun,
}: {
  task: Task;
  steps: TaskStep[];
  consentRun: ConsentRun;
}) {
  const refine = useRefine(task, steps, consentRun);
  const q = task.planQuestion!;
  return (
    <section className="card soft" aria-labelledby="q-h" aria-busy={refine.working}>
      <p className="eyebrow" id="q-h">
        Want a better fit?
      </p>
      <p>{q.text}</p>
      <div className="row">
        {q.options.map((o) => (
          <button
            key={o}
            type="button"
            className="chip"
            disabled={refine.working}
            onClick={() => void refine.request(`${q.text} ${o}`)}
          >
            {o}
          </button>
        ))}
        <button
          type="button"
          className="btn ghost"
          onClick={() => void updateTask(task.id, { planQuestion: undefined })}
        >
          Skip
        </button>
      </div>
      {refine.working && <p className="muted small">Adjusting…</p>}
      {refine.error && <p className="notice warn">{refine.error}</p>}
      {refine.dialog}
    </section>
  );
}

function AllSteps({
  task,
  steps,
  settings,
  consentRun,
}: {
  task: Task;
  steps: TaskStep[];
  settings: AppSettings;
  consentRun: ConsentRun;
}) {
  const toast = useToast();
  const refine = useRefine(task, steps, consentRun);
  const [instruction, setInstruction] = useState('');
  const [newStep, setNewStep] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [menuFor, setMenuFor] = useState<TaskStep | null>(null);
  const revisions = useLiveQuery(() => listRevisions(task.id), [task.id, steps]);
  const sorted = sortSteps(steps);

  const submitRefine = async (e: FormEvent) => {
    e.preventDefault();
    const text = instruction.trim();
    if (!text) return;
    if (await refine.request(text)) setInstruction('');
  };

  const toggle = async (s: TaskStep) => {
    if (s.status === 'done') await uncompleteStep(s.id);
    else {
      await completeStep(s.id);
      if (settings.rewardsLevel !== 'off') toast.show(celebrationText(s.id));
    }
  };

  return (
    <>
      <ol className="step-list" aria-label="Steps">
        {sorted.map((s, i) => (
          <li key={s.id} className={`step-item${s.status === 'done' ? ' done' : ''}`}>
            <button
              type="button"
              className="step-check"
              aria-pressed={s.status === 'done'}
              aria-label={`${s.status === 'done' ? 'Done' : 'Not done'}: ${s.text}`}
              onClick={() => void toggle(s)}
            >
              <span className="box">{s.status === 'done' && <IconCheck />}</span>
            </button>
            <div className="step-body">
              {editing?.id === s.id ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await editStepText(s.id, editing.text);
                    setEditing(null);
                  }}
                >
                  <label className="visually-hidden" htmlFor={`edit-${s.id}`}>
                    Edit step
                  </label>
                  <input
                    id={`edit-${s.id}`}
                    type="text"
                    value={editing.text}
                    maxLength={300}
                    autoFocus
                    onChange={(e) => setEditing({ id: s.id, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setEditing(null);
                    }}
                  />
                  <div className="row" style={{ marginTop: 8 }}>
                    <button type="submit" className="btn primary">
                      Save
                    </button>
                    <button type="button" className="btn" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <span className="step-text">{s.text}</span>
                  <div className="step-meta">
                    {s.tier === 'optional' ? 'Optional' : 'Required'}
                    {s.estimateMin ? ` · about ${s.estimateMin} min` : ''}
                    {s.userEdited ? ' · edited by you' : ''}
                  </div>
                </>
              )}
            </div>
            <div className="row" style={{ flexWrap: 'nowrap', gap: 0 }}>
              <button
                type="button"
                className="btn ghost icon"
                aria-label={`Move up: ${s.text}`}
                disabled={i === 0}
                onClick={() => void moveStep(s.id, -1)}
              >
                <IconUp />
              </button>
              <button
                type="button"
                className="btn ghost icon"
                aria-label={`Move down: ${s.text}`}
                disabled={i === sorted.length - 1}
                onClick={() => void moveStep(s.id, 1)}
              >
                <IconDown />
              </button>
              <button
                type="button"
                className="btn ghost icon"
                aria-label={`More options: ${s.text}`}
                onClick={() => setMenuFor(s)}
              >
                ⋯
              </button>
            </div>
          </li>
        ))}
      </ol>

      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await addStep(task.id, newStep)) setNewStep('');
        }}
      >
        <label htmlFor="new-step" className="visually-hidden">
          Add a step
        </label>
        <input
          id="new-step"
          type="text"
          placeholder="Add a step"
          maxLength={300}
          value={newStep}
          onChange={(e) => setNewStep(e.target.value)}
          style={{ flex: 1, width: 'auto' }}
        />
        <button type="submit" className="btn" disabled={!newStep.trim()}>
          Add
        </button>
      </form>

      {sorted.length > 0 && (
        <section className="refine-bar" aria-labelledby="refine-h" aria-busy={refine.working}>
          <h2 id="refine-h" className="visually-hidden">
            Change the plan
          </h2>
          <div className="scroll-chips">
            {QUICK_REFINES.map((q) => (
              <button
                key={q.label}
                type="button"
                className="chip"
                disabled={refine.working}
                onClick={() => void refine.request(q.instruction)}
              >
                {q.label}
              </button>
            ))}
          </div>
          <form onSubmit={submitRefine}>
            <label htmlFor="refine-input" className="visually-hidden">
              Tell it what to change
            </label>
            <input
              id="refine-input"
              type="text"
              maxLength={500}
              placeholder='e.g. "I have no cleaning supplies"'
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              type="submit"
              className="btn primary"
              disabled={!instruction.trim() || refine.working}
            >
              {refine.working ? 'Working…' : 'Change'}
            </button>
          </form>
          {refine.error && (
            <p className="notice warn" role="alert">
              {refine.error}
            </p>
          )}
        </section>
      )}

      {revisions && revisions.length > 0 && (
        <details>
          <summary>Earlier versions ({revisions.length})</summary>
          <ul className="step-list">
            {revisions.map((r) => (
              <li key={r.id} className="task-row">
                <span className="spacer small">
                  {new Date(r.createdAt).toLocaleString([], {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}{' '}
                  · before {r.cause === 'generate' ? 'new plan' : r.cause}
                  {r.instruction ? ` ("${r.instruction}")` : ''} · {r.steps.length} steps
                </span>
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    await restoreRevision(r.id);
                    toast.show('Restored.', {
                      actionLabel: 'Undo',
                      onAction: () => void undoLastChange(task.id),
                    });
                  }}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <Dialog open={menuFor !== null} onClose={() => setMenuFor(null)} title="Step options">
        {menuFor && (
          <div className="stack">
            <p className="step-text">{menuFor.text}</p>
            <button
              type="button"
              className="btn block"
              onClick={() => {
                setEditing({ id: menuFor.id, text: menuFor.text });
                setMenuFor(null);
              }}
            >
              Edit wording
            </button>
            <button
              type="button"
              className="btn block"
              onClick={async () => {
                const r = await makeStepEasier(task, menuFor, await getSettings());
                await simplifyStep(menuFor.id, r.text, r.origin, r.estimateMin);
                setMenuFor(null);
                toast.show('Made it smaller.', {
                  actionLabel: 'Undo',
                  onAction: () => void undoLastChange(task.id),
                });
              }}
            >
              Make it easier
            </button>
            <button
              type="button"
              className="btn block"
              onClick={async () => {
                await setStepTier(
                  menuFor.id,
                  menuFor.tier === 'optional' ? 'required' : 'optional',
                );
                setMenuFor(null);
              }}
            >
              {menuFor.tier === 'optional' ? 'Mark as required' : 'Mark as optional'}
            </button>
            <button
              type="button"
              className="btn block"
              onClick={async () => {
                await setCurrentStep(task.id, menuFor.id);
                setMenuFor(null);
                toast.show('That step is up next.');
              }}
              disabled={menuFor.status === 'done'}
            >
              Do this one next
            </button>
            <button
              type="button"
              className="btn block danger"
              onClick={async () => {
                await deleteStep(menuFor.id);
                setMenuFor(null);
                toast.show('Step removed.', {
                  actionLabel: 'Undo',
                  onAction: () => void undoLastChange(task.id),
                });
              }}
            >
              Remove step
            </button>
          </div>
        )}
      </Dialog>
      {refine.dialog}
    </>
  );
}

function TaskFooter({ task }: { task: Task }) {
  const navigate = useNavigate();
  const toast = useToast();
  return (
    <div className="stack" style={{ marginTop: 32 }}>
      {task.status === 'done' ? (
        <button type="button" className="btn block" onClick={() => void reopenTask(task.id)}>
          Reopen task
        </button>
      ) : (
        <button
          type="button"
          className="btn primary block"
          onClick={async () => {
            await completeTask(task.id);
            toast.show('Task done. Nice work.', {
              actionLabel: 'Undo',
              onAction: () => void reopenTask(task.id),
            });
          }}
        >
          Mark task done
        </button>
      )}
      <button
        type="button"
        className="btn block danger"
        onClick={async () => {
          await deleteTask(task.id);
          navigate('/');
          toast.show('Task deleted.', {
            actionLabel: 'Undo',
            onAction: () => void restoreTask(task.id),
          });
        }}
      >
        Delete task
      </button>
    </div>
  );
}
