import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router';
import { db } from '../../data/db';
import {
  completeTask,
  convertThoughtToTask,
  deleteTask,
  dismissThought,
  estimateRatios,
  listOpenThoughts,
  listVisibleTasks,
  reopenTask,
  restoreTask,
  restoreThought,
  saveTaskForLater,
  updateTask,
} from '../../data/repo';
import { pickCurrentStep, progressOf } from '../../domain/plan';
import { estimatePattern } from '../../domain/estimates';
import { momentumSince, momentumText } from '../../domain/rewards';
import type { Task, TaskStep } from '../../domain/types';
import { Dialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { useSettings } from '../hooks';
import { dueText } from './TaskTools';

interface Row {
  task: Task;
  steps: TaskStep[];
}

function subtitle({ task, steps }: Row): string {
  if (task.status === 'done') return task.goodEnough ? 'Done (good enough)' : 'Done';
  const flags = [task.pinned ? 'Pinned' : '', task.dueDate ? dueText(task.dueDate) : '']
    .filter(Boolean)
    .join(' · ');
  const rest = baseSubtitle(steps, task);
  return flags ? `${flags} · ${rest}` : rest;
}

function baseSubtitle(steps: TaskStep[], task: Task): string {
  if (steps.length === 0) return 'No steps yet';
  const { done, total } = progressOf(steps);
  const next = pickCurrentStep(steps, task.currentStepId);
  return next ? `${done} of ${total} done · Next: ${next.text}` : `${done} of ${total} done`;
}

export function TasksScreen() {
  const settings = useSettings();
  const toast = useToast();
  const [menuFor, setMenuFor] = useState<Task | null>(null);

  const rows = useLiveQuery(async () => {
    const tasks = await listVisibleTasks();
    const all = await db.steps.toArray();
    return tasks.map((task) => ({ task, steps: all.filter((s) => s.taskId === task.id) }));
  }, []);
  const thoughts = useLiveQuery(() => listOpenThoughts(), []);
  const pattern = useLiveQuery(async () => estimatePattern(await estimateRatios()), []);
  const momentum = useLiveQuery(
    async () => momentumText(momentumSince(await db.events.toArray(), Date.now())),
    [],
  );

  if (!rows) return <p aria-busy="true">Loading…</p>;

  const inProgress = rows.filter((r) => r.task.status === 'active');
  const saved = rows.filter((r) => r.task.status === 'saved');
  const done = rows.filter((r) => r.task.status === 'done');

  const list = (items: Row[]) => (
    <ul className="step-list">
      {items.map((r) => (
        <li key={r.task.id} className="task-row">
          <Link to={`/task/${r.task.id}`}>
            {r.task.title}
            <span className="sub">{subtitle(r)}</span>
          </Link>
          <button
            type="button"
            className="btn ghost icon"
            aria-label={`Options for ${r.task.title}`}
            onClick={() => setMenuFor(r.task)}
          >
            ⋯
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="stack">
      <h1>Tasks</h1>
      {settings.rewardsLevel !== 'off' && momentum && <p className="card lilac">{momentum}</p>}

      {pattern && <p className="muted small">{pattern}</p>}
      {rows.filter((r) => r.task.status !== 'done').length >= 2 && (
        <Link to="/pick" className="btn block">
          Can't choose? Pick for me
        </Link>
      )}

      {rows.length === 0 && (
        <div className="card soft stack">
          <p>Nothing saved yet. That's fine — you don't need a list to use this.</p>
          <Link to="/" className="btn primary">
            Get unstuck on something
          </Link>
        </div>
      )}

      {inProgress.length > 0 && (
        <section aria-labelledby="h-progress">
          <h2 id="h-progress">In progress</h2>
          {list(inProgress)}
        </section>
      )}
      {saved.length > 0 && (
        <section aria-labelledby="h-saved">
          <h2 id="h-saved">Saved for later</h2>
          {list(saved)}
        </section>
      )}

      {thoughts && thoughts.length > 0 && (
        <section aria-labelledby="h-parked">
          <h2 id="h-parked">Parked thoughts</h2>
          <ul className="step-list">
            {thoughts.map((t) => (
              <li key={t.id} className="task-row">
                <span className="spacer step-text">{t.text}</span>
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    await convertThoughtToTask(t.id);
                    toast.show('Saved as a task.');
                  }}
                >
                  Save as task
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={async () => {
                    await dismissThought(t.id);
                    toast.show('Cleared.', {
                      actionLabel: 'Undo',
                      onAction: () => void restoreThought(t.id),
                    });
                  }}
                >
                  Clear
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {done.length > 0 && (
        <details>
          <summary>Done ({done.length})</summary>
          {list(done)}
        </details>
      )}

      <Dialog open={menuFor !== null} onClose={() => setMenuFor(null)} title="Task options">
        {menuFor && (
          <div className="stack">
            <p className="step-text">{menuFor.title}</p>
            {menuFor.status === 'done' ? (
              <button
                type="button"
                className="btn block"
                onClick={async () => {
                  await reopenTask(menuFor.id);
                  setMenuFor(null);
                }}
              >
                Reopen
              </button>
            ) : (
              <button
                type="button"
                className="btn block"
                onClick={async () => {
                  await completeTask(menuFor.id);
                  setMenuFor(null);
                  toast.show('Task done. Nice work.', {
                    actionLabel: 'Undo',
                    onAction: () => void reopenTask(menuFor.id),
                  });
                }}
              >
                Mark done
              </button>
            )}
            <button
              type="button"
              className="btn block"
              onClick={async () => {
                await updateTask(menuFor.id, { pinned: !menuFor.pinned });
                setMenuFor(null);
              }}
            >
              {menuFor.pinned ? 'Unpin' : 'Pin'}
            </button>
            {menuFor.status === 'active' && (
              <button
                type="button"
                className="btn block"
                onClick={async () => {
                  await saveTaskForLater(menuFor.id);
                  setMenuFor(null);
                }}
              >
                Save for later
              </button>
            )}
            {menuFor.status === 'saved' && (
              <button
                type="button"
                className="btn block"
                onClick={async () => {
                  await updateTask(menuFor.id, { status: 'active' });
                  setMenuFor(null);
                }}
              >
                Move to in progress
              </button>
            )}
            <button
              type="button"
              className="btn block danger"
              onClick={async () => {
                const id = menuFor.id;
                await deleteTask(id);
                setMenuFor(null);
                toast.show('Task deleted.', {
                  actionLabel: 'Undo',
                  onAction: () => void restoreTask(id),
                });
              }}
            >
              Delete
            </button>
          </div>
        )}
      </Dialog>
    </div>
  );
}
