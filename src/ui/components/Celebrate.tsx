import type { AppSettings } from '../../domain/types';
import { IconCheck } from './Icons';

/** Small completion feedback. Quiet = text only; Off = nothing but the plain confirmation. */
export function Celebrate({ message, settings }: { message: string; settings: AppSettings }) {
  if (settings.rewardsLevel === 'off') return <p className="muted">Saved.</p>;
  return (
    <div className="celebrate" role="status">
      {settings.rewardsLevel === 'full' && (
        <span className="burst" aria-hidden="true">
          <IconCheck />
        </span>
      )}
      <span>{message}</span>
    </div>
  );
}
