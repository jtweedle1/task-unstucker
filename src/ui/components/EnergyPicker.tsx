import type { Energy } from '../../domain/types';

export const ENERGY_LABELS: Record<Energy, string> = {
  low: 'Low',
  medium: 'Some',
  high: 'Plenty',
};

/** Three toggle chips. Tapping the selected one clears it. */
export function EnergyPicker({
  legend,
  value,
  onChange,
}: {
  legend: string;
  value: Energy | undefined;
  onChange: (v: Energy | undefined) => void;
}) {
  return (
    <fieldset className="plain-fieldset">
      <legend className="eyebrow">{legend}</legend>
      <div className="chip-grid three">
        {(Object.keys(ENERGY_LABELS) as Energy[]).map((e) => (
          <button
            key={e}
            type="button"
            className="chip"
            aria-pressed={value === e}
            onClick={() => onChange(value === e ? undefined : e)}
          >
            {ENERGY_LABELS[e]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
