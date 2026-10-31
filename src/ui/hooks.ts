import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../data/db';
import { DEFAULT_SETTINGS, type AppSettings } from '../domain/types';

/** Live settings from IndexedDB, with defaults while loading. */
export function useSettings(): AppSettings {
  const s = useLiveQuery(() => db.settings.get('app'), []);
  return s ?? DEFAULT_SETTINGS;
}

export function prefersReducedMotion(settings: AppSettings): boolean {
  if (settings.motion === 'reduced') return true;
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Current time, refreshed on an interval while active and immediately whenever the page
 * becomes visible again. Only drives repainting: timer values come from timestamps.
 */
export function useNow(active: boolean, intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', tick);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', tick);
      window.removeEventListener('focus', tick);
    };
  }, [active, intervalMs]);
  return now;
}

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

/** Keeps the screen on while a timer runs, where supported (iOS 18.4+ Home Screen apps). */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    const wl = (
      navigator as Navigator & {
        wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> };
      }
    ).wakeLock;
    if (!active || !wl) return;
    let sentinel: WakeLockSentinelLike | undefined;
    let cancelled = false;
    const acquire = async () => {
      try {
        const s = await wl.request('screen');
        if (cancelled) await s.release();
        else sentinel = s;
      } catch {
        // Not allowed right now (e.g. low battery). Silently fall back.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}
