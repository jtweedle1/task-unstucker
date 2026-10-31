import { useId, useState } from 'react';
import { Link } from 'react-router';
import { sortBrainDump, type DumpOutcome } from '../../ai/client';
import { createTasks } from '../../data/repo';
import { BRAIN_DUMP_MAX_CHARS } from '../../domain/braindump';
import { sourceLabel, useWithConsent } from '../components/AiConsent';
import { useToast } from '../components/Toast';

interface Item {
  key: number;
  title: string;
  keep: boolean;
}

export function DumpScreen() {
  const toast = useToast();
  const consent = useWithConsent();
  const inputId = useId();
  const [text, setText] = useState('');
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<(Omit<DumpOutcome, 'items'> & { items: Item[] }) | null>(
    null,
  );
  const [saved, setSaved] = useState(0);

  const sort = async () => {
    if (!text.trim() || working) return;
    setWorking(true);
    try {
      const out = await consent.run((s) => sortBrainDump(text, s));
      setResult({ ...out, items: out.items.map((title, key) => ({ key, title, keep: true })) });
    } finally {
      setWorking(false);
    }
  };

  const keep = result?.items.filter((i) => i.keep && i.title.trim()) ?? [];

  if (saved > 0) {
    return (
      <div className="stack">
        <h1>
          Saved {saved} task{saved === 1 ? '' : 's'}
        </h1>
        <p>It's all out of your head and on the list. Now pick just one.</p>
        <Link to="/pick" className="btn primary big">
          Pick one for me
        </Link>
        <Link to="/tasks" className="btn block">
          See my tasks
        </Link>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            setSaved(0);
            setText('');
            setResult(null);
          }}
        >
          Dump some more
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      <h1>
        <label htmlFor={inputId}>Brain dump</label>
      </h1>
      <p className="muted">
        Type everything on your mind, any order, any mess. You'll get a list to keep or trim.
      </p>
      <textarea
        id={inputId}
        className="big-input"
        rows={6}
        maxLength={BRAIN_DUMP_MAX_CHARS}
        value={text}
        placeholder={'e.g. call the dentist, email Sam about Friday\nbuy milk; pay rent'}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        type="button"
        className="btn primary big"
        disabled={!text.trim() || working}
        onClick={() => void sort()}
      >
        {working ? 'Sorting…' : 'Sort it into tasks'}
      </button>

      {result && (
        <section className="stack" aria-labelledby="dump-h">
          <h2 id="dump-h">
            Found {result.items.length} {result.items.length === 1 ? 'thing' : 'things'}{' '}
            <span className={result.origin === 'demo' ? 'tag demo' : 'tag'}>
              {result.origin === 'template' ? 'Quick split' : sourceLabel(result.origin)}
            </span>
          </h2>
          {result.fallbackReason && (
            <p className="notice warn" role="status">
              {result.fallbackReason} Split it up without AI instead.
            </p>
          )}
          {result.items.length === 0 && (
            <p className="muted">Nothing to save yet. Try putting each thing on its own line.</p>
          )}
          <ul className="step-list">
            {result.items.map((item, i) => (
              <li key={item.key} className="dump-row">
                <input
                  type="checkbox"
                  checked={item.keep}
                  aria-label={`Keep: ${item.title}`}
                  onChange={(e) => {
                    const items = [...result.items];
                    items[i] = { ...item, keep: e.target.checked };
                    setResult({ ...result, items });
                  }}
                />
                <label className="visually-hidden" htmlFor={`dump-${item.key}`}>
                  Task {i + 1}
                </label>
                <input
                  id={`dump-${item.key}`}
                  type="text"
                  maxLength={300}
                  value={item.title}
                  onChange={(e) => {
                    const items = [...result.items];
                    items[i] = { ...item, title: e.target.value };
                    setResult({ ...result, items });
                  }}
                />
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn primary block"
            disabled={keep.length === 0}
            onClick={async () => {
              const created = await createTasks(keep.map((k) => k.title));
              setSaved(created.length);
              toast.show(`Saved ${created.length} task${created.length === 1 ? '' : 's'}.`);
            }}
          >
            Save {keep.length} task{keep.length === 1 ? '' : 's'}
          </button>
        </section>
      )}
      {consent.dialog}
    </div>
  );
}
