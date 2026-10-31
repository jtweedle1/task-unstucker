import { useLiveQuery } from 'dexie-react-hooks';
import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { db } from '../../data/db';
import { requestPersistentStorage } from '../../data/persist';
import { createTask, updateSettings } from '../../data/repo';
import { pickCurrentStep, progressOf } from '../../domain/plan';
import { isTimeUp } from '../../domain/timer';
import type { FocusSession, Task, TaskStep } from '../../domain/types';
import { useNow, useSettings } from '../hooks';

const RESUME_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const EXAMPLES = ['Reply to the landlord', 'Clean my kitchen', 'Start my essay', 'Do the laundry'];

interface ResumeInfo {
  session?: FocusSession;
  task?: Task;
  step?: TaskStep;
  position?: { index: number; total: number };
}

async function loadResume(dismissedId: string | undefined): Promise<ResumeInfo> {
  const open = (await db.sessions.filter((s) => s.endedAt === undefined).toArray()).sort(
    (a, b) => b.startedAt - a.startedAt,
  )[0];
  if (open) {
    const task = open.taskId ? await db.tasks.get(open.taskId) : undefined;
    return { session: open, ...(task && !task.deletedAt ? { task } : {}) };
  }
  const cutoff = Date.now() - RESUME_WINDOW_MS;
  const candidates = (await db.tasks.orderBy('updatedAt').reverse().limit(20).toArray()).filter(
    (t) => !t.deletedAt && t.status === 'active' && t.updatedAt > cutoff && t.id !== dismissedId,
  );
  for (const task of candidates) {
    const steps = await db.steps.where('taskId').equals(task.id).toArray();
    const step = pickCurrentStep(steps, task.currentStepId);
    if (!step) continue;
    const { done, total } = progressOf(steps);
    return { task, step, position: { index: done + 1, total } };
  }
  return {};
}

export function HomeScreen() {
  const navigate = useNavigate();
  const settings = useSettings();
  const inputId = useId();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [placeholder] = useState(() => EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)]);

  const resume = useLiveQuery(
    () => loadResume(settings.dismissedResumeTaskId),
    [settings.dismissedResumeTaskId],
  );
  const recent = useLiveQuery(
    async () =>
      (await db.tasks.orderBy('updatedAt').reverse().limit(10).toArray())
        .filter((t) => !t.deletedAt && t.status !== 'done' && t.id !== resume?.task?.id)
        .slice(0, 3),
    [resume?.task?.id],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = title.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      const task = await createTask(clean);
      void requestPersistentStorage();
      navigate(`/task/${task.id}`);
    } finally {
      setBusy(false);
    }
  };

  const now = useNow(!!resume?.session, 5000);
  const sessionTimeUp = resume?.session ? isTimeUp(resume.session, now) : false;

  return (
    <div className="stack">
      {resume?.session && (
        <section className="card peach" aria-labelledby="resume-h">
          <p className="eyebrow" id="resume-h">
            {sessionTimeUp
              ? 'Your timer finished while you were away'
              : 'Your timer is still going'}
          </p>
          <p className="step-text">
            <strong>{resume.session.goal}</strong>
          </p>
          <Link
            className="btn primary block"
            to={resume.session.taskId && resume.task ? `/task/${resume.session.taskId}/do` : '/do'}
          >
            {sessionTimeUp ? 'See how it went' : 'Back to the timer'}
          </Link>
        </section>
      )}

      {!resume?.session && resume?.task && resume.step && (
        <section className="card peach" aria-labelledby="resume-h">
          <p className="eyebrow" id="resume-h">
            Pick up where you left off
          </p>
          <p className="step-text">
            <strong>{resume.task.title}</strong>
          </p>
          <p className="muted small">
            Step {resume.position?.index} of {resume.position?.total}: {resume.step.text}
          </p>
          <div className="row">
            <Link className="btn primary" to={`/task/${resume.task.id}`}>
              Resume
            </Link>
            <button
              type="button"
              className="btn ghost"
              onClick={() => void updateSettings({ dismissedResumeTaskId: resume.task!.id })}
            >
              Not now
            </button>
          </div>
        </section>
      )}

      <form onSubmit={submit} className="stack">
        <h1>
          <label htmlFor={inputId}>What are you stuck on?</label>
        </h1>
        <textarea
          id={inputId}
          className="big-input"
          rows={2}
          maxLength={300}
          value={title}
          placeholder={`e.g. ${placeholder}`}
          autoComplete="off"
          enterKeyHint="go"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        {title.length > 240 && <p className="field-hint">{300 - title.length} characters left</p>}
        <button type="submit" className="btn primary big" disabled={!title.trim() || busy}>
          Help me start
        </button>
      </form>

      {recent && recent.length > 0 && (
        <section aria-labelledby="recent-h">
          <h2 className="eyebrow" id="recent-h">
            Recent
          </h2>
          <ul className="step-list">
            {recent.map((t) => (
              <li key={t.id} className="task-row">
                <Link to={`/task/${t.id}`}>{t.title}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p>
        <Link to="/do" className="btn ghost">
          Just give me a timer
        </Link>
      </p>
    </div>
  );
}
