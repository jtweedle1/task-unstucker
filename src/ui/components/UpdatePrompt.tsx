import { useRegisterSW } from 'virtual:pwa-register/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../data/db';

/** Offers to reload when a new version is ready. Never reloads during a focus session. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000);
    },
  });
  const inSession = useLiveQuery(
    async () => (await db.sessions.filter((s) => s.endedAt === undefined).count()) > 0,
    [],
    false,
  );

  if (!needRefresh || inSession) return null;
  return (
    <div
      className="toast-region"
      style={{ bottom: 'calc(var(--nav-h) + var(--safe-bottom) + 72px)' }}
    >
      <div className="toast" role="status">
        <span className="spacer">Update ready.</span>
        <button type="button" className="btn" onClick={() => void updateServiceWorker(true)}>
          Reload
        </button>
        <button type="button" className="btn" onClick={() => setNeedRefresh(false)}>
          Later
        </button>
      </div>
    </div>
  );
}
