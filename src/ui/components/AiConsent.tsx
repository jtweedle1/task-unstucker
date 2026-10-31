import { useCallback, useRef, useState } from 'react';
import { updateSettings } from '../../data/repo';
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
