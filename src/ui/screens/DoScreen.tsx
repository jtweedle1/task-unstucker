import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { db } from '../../data/db';
import {
  completeStep,
  convertThoughtToTask,
  dismissThought,
  extendSession,
  finishSession,
  getSteps,
  parkThought,
  pauseSession,
  resumeSession,
  startSession,
} from '../../data/repo';
import { pickCurrentStep } from '../../domain/plan';
import { celebrationText } from '../../domain/rewards';
import { describeDuration, formatClock, isPaused, remainingMs, timeUpAt } from '../../domain/timer';
import type { FocusSession, SessionOutcome } from '../../domain/types';
import { Celebrate } from '../components/Celebrate';
import { Dialog } from '../components/Dialog';
import { SPRINT_PRESETS } from '../components/SprintPicker';
import { useToast } from '../components/Toast';
import { useNow, useSettings, useWakeLock } from '../hooks';

const OUTCOMES: { id: SessionOutcome; label: string }[] = [
  { id: 'done', label: 'Got it done' },
  { id: 'progress', label: 'Made progress' },
  { id: 'pulled-away', label: 'Got pulled away' },
];

export function DoScreen() {
  const { id: taskId } = useParams();

  const session = useLiveQuery(async () => {
    const open = await db.sessions.filter((s) => s.endedAt === undefined).toArray();
    const mine = open.filter((s) => (taskId ? s.taskId === taskId : true));
    return mine.sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
  }, [taskId]);

  // The session we just finished, so the wrap-up screen survives the live query changing.
  const [finished, setFinished] = useState<{
    session: FocusSession;
    outcome: SessionOutcome;
  } | null>(null);

  if (session === undefined) return <p aria-busy="true">Loading…</p>;
  if (finished) return <WrapUp finished={finished} onAgain={() => setFinished(null)} />;
  if (!session) return <TimerPicker taskId={taskId} />;
  return (
    <ActiveTimer session={session} onFinished={(outcome) => setFinished({ session, outcome })} />
  );
}

function TimerPicker({ taskId }: { taskId: string | undefined }) {
  const [goal, setGoal] = useState('');
  const goalId = useId();
  const task = useLiveQuery(
    async () => (taskId ? ((await db.tasks.get(taskId)) ?? null) : null),
    [taskId],
  );
  const start = async (minutes: number) => {
    let text = goal.trim();
    let stepId: string | undefined;
    if (task) {
      const step = pickCurrentStep(await getSteps(task.id), task.currentStepId);
      text = text || step?.text || task.title;
      stepId = step?.id;
    }
    await startSession({
      kind: minutes <= 2 ? 'launch' : 'sprint',
      minutes,
      goal: text || 'Focus time',
      ...(task ? { taskId: task.id } : {}),
      ...(stepId ? { stepId } : {}),
    });
  };
  return (
    <div className="stack">
      <h1>Start a timer</h1>
      {!task && (
        <div>
          <label htmlFor={goalId}>What will you work on? (optional)</label>
          <input
            id={goalId}
            type="text"
            maxLength={300}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
        </div>
      )}
      {task && <p className="step-text">For: {task.title}</p>}
      <button type="button" className="btn primary big" onClick={() => void start(2)}>
        Just 2 minutes
      </button>
      <div className="chip-grid">
        {SPRINT_PRESETS.map((m) => (
          <button key={m} type="button" className="chip" onClick={() => void start(m)}>
            {m} minutes
          </button>
        ))}
      </div>
    </div>
  );
}

function Ring({ fraction }: { fraction: number }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="8" />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, Math.max(0, fraction)))}
      />
    </svg>
  );
}

function ActiveTimer({
  session,
  onFinished,
}: {
  session: FocusSession;
  onFinished: (o: SessionOutcome) => void;
}) {
  const paused = isPaused(session);
  const now = useNow(!paused);
  const remaining = remainingMs(session, now);
  const ended = remaining === 0;
  const endedAt = timeUpAt(session, now);
  const [asking, setAsking] = useState(false);
  const [parkOpen, setParkOpen] = useState(false);
  const [thought, setThought] = useState('');
  const toast = useToast();
  const thoughtId = useId();
  const announced = useRef(false);

  useWakeLock(!paused && !ended);

  // Screen-reader announcements: at the end, and once a minute while running.
  const minuteMark = Math.ceil(remaining / 60_000);
  useEffect(() => {
    if (ended && !announced.current) {
      announced.current = true;
      navigator.vibrate?.(200);
    } else if (!ended) {
      announced.current = false;
    }
  }, [ended]);
  const announcement = ended
    ? "Time's up."
    : paused
      ? 'Paused'
      : `${minuteMark} minute${minuteMark === 1 ? '' : 's'} left`;

  const finish = async (outcome: SessionOutcome) => {
    await finishSession(session.id, outcome);
    if (outcome === 'done' && session.stepId) await completeStep(session.stepId);
    onFinished(outcome);
  };

  const showAsk = ended || asking;
  const endedAgo = endedAt ? Math.floor((now - endedAt) / 60_000) : 0;

  return (
    <div className="do-screen">
      <div className="row">
        <Link to={session.taskId ? `/task/${session.taskId}` : '/'} className="btn ghost">
          ← Back
        </Link>
      </div>
      <h1 className="visually-hidden">Focus</h1>
      <p className="eyebrow">{session.kind === 'launch' ? 'Two-minute start' : 'Focus sprint'}</p>
      <p className="do-goal">{session.goal}</p>

      <div
        className="timer-wrap"
        role="timer"
        aria-label={`${describeDuration(remaining)} left${paused ? ', paused' : ''}`}
      >
        <Ring fraction={remaining / session.plannedMs} />
        <div className="timer-text" aria-hidden="true">
          {formatClock(remaining)}
        </div>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>

      {paused && !ended && <p className="muted">Paused</p>}
      {ended && (
        <p>
          <strong>Time's up.</strong>
          {endedAgo >= 1 && <span className="muted"> (ended {endedAgo} min ago)</span>}
        </p>
      )}

      <div className="do-controls">
        {showAsk ? (
          <section aria-labelledby="how-h" className="stack">
            <h2 id="how-h">How did it go?</h2>
            {OUTCOMES.map((o) => (
              <button
                key={o.id}
                type="button"
                className="btn block"
                onClick={() => void finish(o.id)}
              >
                {o.label}
              </button>
            ))}
            {ended ? (
              <button
                type="button"
                className="btn ghost"
                onClick={() => void extendSession(session.id, 5)}
              >
                Keep going (+5 min)
              </button>
            ) : (
              <button type="button" className="btn ghost" onClick={() => setAsking(false)}>
                Back to the timer
              </button>
            )}
          </section>
        ) : (
          <>
            <button type="button" className="btn block" onClick={() => setParkOpen(true)}>
              Park a thought
            </button>
            <div className="two">
              {paused ? (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void resumeSession(session.id)}
                >
                  Resume
                </button>
              ) : (
                <button type="button" className="btn" onClick={() => void pauseSession(session.id)}>
                  Pause
                </button>
              )}
              <button type="button" className="btn" onClick={() => setAsking(true)}>
                Finish
              </button>
            </div>
          </>
        )}
      </div>

      <Dialog open={parkOpen} onClose={() => setParkOpen(false)} title="Park a thought">
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (thought.trim()) {
              await parkThought(thought, session.id);
              toast.show('Parked. Back to it.');
            }
            setThought('');
            setParkOpen(false);
          }}
        >
          <label htmlFor={thoughtId} className="visually-hidden">
            Thought to park
          </label>
          <input
            id={thoughtId}
            type="text"
            autoFocus
            maxLength={500}
            enterKeyHint="done"
            placeholder="e.g. email Sam"
            value={thought}
            onChange={(e) => setThought(e.target.value)}
          />
          <p className="muted small">The timer keeps going. You can look at this later.</p>
          <button type="submit" className="btn primary block">
            Park it
          </button>
        </form>
      </Dialog>
    </div>
  );
}

function WrapUp({
  finished,
  onAgain,
}: {
  finished: { session: FocusSession; outcome: SessionOutcome };
  onAgain: () => void;
}) {
  const settings = useSettings();
  const navigate = useNavigate();
  const { session, outcome } = finished;
  const thoughts = useLiveQuery(
    async () =>
      (await db.thoughts.toArray()).filter(
        (t) => t.sessionId === session.id && !t.dismissedAt && !t.convertedTaskId,
      ),
    [session.id],
  );
  const nextStep = useLiveQuery(async () => {
    if (!session.taskId) return null;
    const task = await db.tasks.get(session.taskId);
    if (!task || task.deletedAt) return null;
    return pickCurrentStep(await getSteps(task.id), task.currentStepId) ?? null;
  }, [session.taskId]);

  const message =
    outcome === 'done'
      ? celebrationText(session.id)
      : outcome === 'progress'
        ? "That's progress."
        : 'You can come back to this.';

  const again = async () => {
    await startSession({
      kind: 'launch',
      minutes: 2,
      goal: nextStep?.text ?? session.goal,
      ...(session.taskId ? { taskId: session.taskId } : {}),
      ...(nextStep ? { stepId: nextStep.id } : session.stepId ? { stepId: session.stepId } : {}),
    });
    onAgain();
  };

  return (
    <div className="stack">
      <h1>{outcome === 'pulled-away' ? 'No problem' : 'Nice'}</h1>
      <Celebrate message={message} settings={settings} />
      {nextStep && (
        <p>
          Next up: <strong>{nextStep.text}</strong>
        </p>
      )}
      <button type="button" className="btn primary big" onClick={() => void again()}>
        {nextStep ? 'Start the next step (2 min)' : 'Another 2 minutes'}
      </button>
      {session.taskId && (
        <Link to={`/task/${session.taskId}`} className="btn block">
          Back to the plan
        </Link>
      )}
      <button type="button" className="btn ghost block" onClick={() => navigate('/')}>
        Done for now
      </button>

      {thoughts && thoughts.length > 0 && (
        <section className="card soft" aria-labelledby="parked-h">
          <h2 id="parked-h">
            You parked {thoughts.length} thought{thoughts.length === 1 ? '' : 's'}
          </h2>
          <ul className="step-list">
            {thoughts.map((t) => (
              <li key={t.id} className="task-row">
                <span className="spacer step-text">{t.text}</span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void convertThoughtToTask(t.id)}
                >
                  Save as task
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => void dismissThought(t.id)}
                >
                  Clear
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
