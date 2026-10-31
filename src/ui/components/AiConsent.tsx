import { useCallback, useRef, useState } from 'react';
import { AiError } from '../../ai/client';
import { getSettings, updateSettings } from '../../data/repo';
import type { AppSettings, StepOrigin } from '../../domain/types';
import { Dialog } from './Dialog';

/**
 * One-time notice before task text is first sent to the AI provider.
 * `ensure()` resolves true if the user agrees, false if they choose quick steps.
 */
export function useAiConsent() {
  const [open, setOpen] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const ensure = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setOpen(true);
      }),
    [],
  );

  const finish = async (ok: boolean) => {
    const resolve = resolver.current;
    if (!resolve) return; // already answered
    resolver.current = null;
    if (ok) await updateSettings({ aiConsentAt: Date.now() });
    else await updateSettings({ aiMode: 'off' });
    setOpen(false);
    resolve(ok);
  };

  const dialog = (
    <Dialog
      open={open}
      onClose={() => void finish(false)}
      title="Use AI for this?"
      variant="center"
    >
      <p>
        To break tasks down, the text of the task you're working on is sent to Anthropic's AI
        through this app's server. Nothing else from your device is sent.
      </p>
      <p className="muted small">You can change this any time in Settings.</p>
      <div className="stack">
        <button type="button" className="btn primary block" onClick={() => void finish(true)}>
          OK, use AI
        </button>
        <button type="button" className="btn block" onClick={() => void finish(false)}>
          Use quick steps instead
        </button>
      </div>
    </Dialog>
  );

  return { ensure, dialog };
}

/** Runs an AI action; if it needs consent, asks once, then runs again with fresh settings. */
export function useWithConsent() {
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

export type ConsentRun = ReturnType<typeof useWithConsent>['run'];

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
