import { useId, useState } from 'react';
import { Dialog } from './Dialog';

export const SPRINT_PRESETS = [3, 5, 10, 25];

export function SprintPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (minutes: number) => void;
}) {
  const [custom, setCustom] = useState('');
  const id = useId();
  const minutes = Number(custom);
  const valid = Number.isFinite(minutes) && minutes >= 1 && minutes <= 180;
  return (
    <Dialog open={open} onClose={onClose} title="How long?">
      <div className="chip-grid">
        {SPRINT_PRESETS.map((m) => (
          <button key={m} type="button" className="chip" onClick={() => onPick(m)}>
            {m} minutes
          </button>
        ))}
      </div>
      <form
        className="row"
        style={{ marginTop: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onPick(Math.round(minutes));
        }}
      >
        <label htmlFor={id} className="visually-hidden">
          Custom minutes
        </label>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={1}
          max={180}
          placeholder="Custom minutes"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          style={{ flex: 1, width: 'auto' }}
        />
        <button type="submit" className="btn" disabled={!valid}>
          Start
        </button>
      </form>
    </Dialog>
  );
}
