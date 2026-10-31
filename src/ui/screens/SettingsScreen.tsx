import { useState, type ReactNode } from 'react';
import {
  BackupError,
  exportToFile,
  importBackup,
  parseBackup,
  type Backup,
} from '../../data/backup';
import { isStandalone, requestPersistentStorage } from '../../data/persist';
import { deleteAllData, updateSettings } from '../../data/repo';
import { clearAiCache } from '../../ai/client';
import type {
  AiMode,
  AppSettings,
  MotionPref,
  RewardsLevel,
  SetupPromptPref,
} from '../../domain/types';
import { Dialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { useSettings } from '../hooks';

function RadioGroup<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: { value: T; label: string; hint?: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="card">
      <legend>{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className="radio-row">
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          <span>
            {o.label}
            {o.hint && (
              <span className="step-meta" style={{ display: 'block' }}>
                {o.hint}
              </span>
            )}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function daysAgo(ts: number | undefined): string {
  if (!ts) return 'never';
  const d = Math.floor((Date.now() - ts) / 86_400_000);
  return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}

function AccessCodeForm({ initial }: { initial: string }) {
  const toast = useToast();
  const [code, setCode] = useState(initial);
  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        void updateSettings({ aiAccessCode: code.trim() || undefined });
        toast.show('Saved.');
      }}
    >
      <label htmlFor="access-code">Access code (only if your server asks for one)</label>
      <input
        id="access-code"
        type="password"
        autoComplete="off"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <button type="submit" className="btn">
        Save code
      </button>
    </form>
  );
}

export function SettingsScreen() {
  const settings: AppSettings = useSettings();
  const toast = useToast();
  const [pendingImport, setPendingImport] = useState<Backup | null>(null);
  const [importError, setImportError] = useState<string | undefined>();
  const [confirmWipe, setConfirmWipe] = useState(false);
  const storageApi = typeof navigator !== 'undefined' && !!navigator.storage?.persist;

  return (
    <div className="stack">
      <h1>Settings</h1>

      <RadioGroup<AiMode>
        legend="AI help"
        name="ai"
        value={settings.aiMode}
        onChange={(v) => {
          clearAiCache();
          void updateSettings({ aiMode: v });
        }}
        options={[
          {
            value: 'live',
            label: 'Use AI',
            hint: "Sends only the task you're working on to Anthropic's AI, through this app's server.",
          },
          {
            value: 'demo',
            label: 'Demo',
            hint: 'Sample answers for trying the app. Not real AI. Nothing is sent.',
          },
          { value: 'off', label: 'Off', hint: 'Quick built-in steps only. Nothing is sent.' },
        ]}
      />
      {settings.aiMode === 'live' && (
        <AccessCodeForm key={settings.aiAccessCode ?? ''} initial={settings.aiAccessCode ?? ''} />
      )}

      <RadioGroup<RewardsLevel>
        legend="Celebrations"
        name="rewards"
        value={settings.rewardsLevel}
        onChange={(v) => void updateSettings({ rewardsLevel: v })}
        options={[
          { value: 'full', label: 'On', hint: 'Small animations and progress notes.' },
          { value: 'quiet', label: 'Quiet', hint: 'Progress notes, no animation.' },
          { value: 'off', label: 'Off', hint: 'Just the plain confirmations.' },
        ]}
      />

      <RadioGroup<MotionPref>
        legend="Motion"
        name="motion"
        value={settings.motion}
        onChange={(v) => void updateSettings({ motion: v })}
        options={[
          { value: 'system', label: 'Follow my device setting' },
          { value: 'reduced', label: 'Reduce motion' },
        ]}
      />

      <RadioGroup<SetupPromptPref>
        legend="Setup before a timer"
        name="setup"
        value={settings.setupPrompts ?? 'auto'}
        onChange={(v) => void updateSettings({ setupPrompts: v })}
        options={[
          { value: 'auto', label: 'When distraction is the problem' },
          { value: 'always', label: 'Always offer it' },
          { value: 'off', label: 'Never' },
        ]}
      />

      <RadioGroup<'on' | 'off'>
        legend="Two-minute challenges"
        name="challenges"
        value={settings.challenges === false ? 'off' : 'on'}
        onChange={(v) => void updateSettings({ challenges: v === 'on' })}
        options={[
          { value: 'on', label: 'On', hint: 'A light challenge line, like "race the clock".' },
          { value: 'off', label: 'Off' },
        ]}
      />

      <section className="card stack" aria-labelledby="backup-h">
        <h2 id="backup-h">Your data</h2>
        <p className="small">
          Everything is saved on this device only. iPhones can clear website data in some
          situations, so download a backup now and then.
        </p>
        <p className="small muted">Last backup: {daysAgo(settings.lastExportAt)}.</p>
        <button
          type="button"
          className="btn primary block"
          onClick={async () => {
            await exportToFile();
            toast.show('Backup downloaded.');
          }}
        >
          Download backup
        </button>
        <label className="btn block" htmlFor="import-file">
          Restore from a backup file
        </label>
        <input
          id="import-file"
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setImportError(undefined);
            try {
              setPendingImport(parseBackup(await file.text()));
            } catch (err) {
              setImportError(
                err instanceof BackupError ? err.message : "That file couldn't be read.",
              );
            }
          }}
        />
        {importError && (
          <p className="notice warn" role="alert">
            {importError}
          </p>
        )}
        <p className="small muted">
          Storage protection:{' '}
          {!storageApi
            ? 'not available in this browser'
            : settings.persistGranted
              ? 'on — the browser agreed to keep your data'
              : 'not granted yet'}
          .
        </p>
        {storageApi && !settings.persistGranted && (
          <button
            type="button"
            className="btn block"
            onClick={async () => {
              const ok = await requestPersistentStorage();
              toast.show(
                ok
                  ? 'Storage protection is on.'
                  : 'The browser declined for now. Adding to Home Screen can help.',
              );
            }}
          >
            Ask the browser to keep my data
          </button>
        )}
      </section>

      {!isStandalone() && (
        <section className="card soft" aria-labelledby="install-h">
          <h2 id="install-h">Add to Home Screen</h2>
          <p className="small">
            On iPhone, tap the Share button in Safari, then "Add to Home Screen". It opens like an
            app, works offline, and makes it more likely your data is kept.
          </p>
        </section>
      )}

      <section className="card" aria-labelledby="about-h">
        <h2 id="about-h">About</h2>
        <p className="small">
          Task Unstucker helps you find a small next step. It's a productivity tool, not medical
          advice, diagnosis, or treatment.
        </p>
        <p className="small muted">Version {__APP_VERSION__}</p>
      </section>

      <button type="button" className="btn block danger" onClick={() => setConfirmWipe(true)}>
        Delete all data on this device
      </button>

      <Dialog
        open={pendingImport !== null}
        onClose={() => setPendingImport(null)}
        title="Restore backup"
        variant="center"
      >
        {pendingImport && (
          <div className="stack">
            <p>
              Backup from {new Date(pendingImport.exportedAt).toLocaleDateString()} with{' '}
              {pendingImport.data.tasks.length} task
              {pendingImport.data.tasks.length === 1 ? '' : 's'}.
            </p>
            <button
              type="button"
              className="btn primary block"
              onClick={async () => {
                await importBackup(pendingImport, 'merge');
                setPendingImport(null);
                toast.show('Backup merged.');
              }}
            >
              Merge with what's here
            </button>
            <button
              type="button"
              className="btn block danger"
              onClick={async () => {
                await importBackup(pendingImport, 'replace');
                setPendingImport(null);
                toast.show('Backup restored.');
              }}
            >
              Replace everything here
            </button>
            <button
              type="button"
              className="btn ghost block"
              onClick={() => setPendingImport(null)}
            >
              Cancel
            </button>
          </div>
        )}
      </Dialog>

      <Dialog
        open={confirmWipe}
        onClose={() => setConfirmWipe(false)}
        title="Delete everything?"
        variant="center"
      >
        <p>
          This removes all tasks, steps, and history from this device. It can't be undone unless you
          have a backup.
        </p>
        <div className="stack">
          <button
            type="button"
            className="btn block danger"
            onClick={async () => {
              await deleteAllData();
              setConfirmWipe(false);
              toast.show('All data deleted.');
            }}
          >
            Delete everything
          </button>
          <button type="button" className="btn primary block" onClick={() => setConfirmWipe(false)}>
            Keep my data
          </button>
        </div>
      </Dialog>
    </div>
  );
}
