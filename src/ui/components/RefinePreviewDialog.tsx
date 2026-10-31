import { useState } from 'react';
import type { RefinePreview, Suggestion } from '../../domain/plan';
import { Dialog } from './Dialog';

function suggestionLabel(s: Suggestion): string {
  if (s.kind === 'mark-done') return `Mark "${s.before.text}" as done`;
  if (s.kind === 'remove-protected')
    return `Remove "${s.before.text}" (you finished or edited this)`;
  return `Change "${s.before.text}" to "${s.after?.text ?? ''}" (you finished or edited this)`;
}

/** Shows exactly what a refinement would change before anything is saved. */
export function RefinePreviewDialog({
  preview,
  summary,
  sourceLabel,
  onApply,
  onCancel,
}: {
  preview: RefinePreview | null;
  summary: string;
  sourceLabel: string;
  onApply: (accepted: Set<string>) => void;
  onCancel: () => void;
}) {
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const open = preview !== null;
  const nothing = preview && preview.changes.length === 0 && preview.suggestions.length === 0;

  return (
    <Dialog open={open} onClose={onCancel} title="Proposed changes">
      {preview && (
        <div className="stack">
          <p>
            {summary}{' '}
            <span className={sourceLabel === 'Demo' ? 'tag demo' : 'tag'}>{sourceLabel}</span>
          </p>
          {nothing && <p className="muted">No changes were needed.</p>}
          {preview.changes.length > 0 && (
            <ul className="step-list">
              {preview.changes.map((c, i) => (
                <li key={i} className="step-item">
                  <div className="step-body" style={{ paddingTop: 0 }}>
                    {c.kind === 'added' && (
                      <>
                        <strong>Added:</strong> {c.step.text}
                      </>
                    )}
                    {c.kind === 'removed' && (
                      <>
                        <strong>Removed:</strong> <s>{c.step.text}</s>
                      </>
                    )}
                    {c.kind === 'changed' && (
                      <>
                        <strong>Changed:</strong> {c.after.text}
                        <span className="step-meta"> (was: {c.before.text})</span>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {preview.suggestions.length > 0 && (
            <fieldset>
              <legend>Also change your finished or edited steps?</legend>
              {preview.suggestions.map((s) => (
                <label key={s.key} className="radio-row">
                  <input
                    type="checkbox"
                    checked={accepted.has(s.key)}
                    onChange={(e) => {
                      const next = new Set(accepted);
                      if (e.target.checked) next.add(s.key);
                      else next.delete(s.key);
                      setAccepted(next);
                    }}
                  />
                  <span>{suggestionLabel(s)}</span>
                </label>
              ))}
            </fieldset>
          )}
          <div className="row">
            <button
              type="button"
              className="btn primary"
              disabled={!!nothing && accepted.size === 0}
              onClick={() => {
                onApply(accepted);
                setAccepted(new Set());
              }}
            >
              Apply
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setAccepted(new Set());
                onCancel();
              }}
            >
              Keep my plan
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
