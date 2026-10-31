// Asks the browser to keep our data (best effort). WebKit decides using heuristics, such as
// whether the app was added to the Home Screen, so this is never guaranteed.
import { updateSettings } from './repo';

export async function requestPersistentStorage(): Promise<boolean | undefined> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!storage?.persist || !storage.persisted) return undefined;
  try {
    const already = await storage.persisted();
    const granted = already || (await storage.persist());
    await updateSettings({ persistGranted: granted });
    return granted;
  } catch {
    return undefined;
  }
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true;
}
