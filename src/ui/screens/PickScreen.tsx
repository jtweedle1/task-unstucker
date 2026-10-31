import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { listRouletteCandidates, startSession, updateSettings } from '../../data/repo';
import {
  eligibleCandidates,
  pickRoulette,
  type RouletteCandidate,
  type RouletteOptions,
} from '../../domain/roulette';
import { challengeFor } from '../../domain/setup';
import type { Energy } from '../../domain/types';
import { EnergyPicker } from '../components/EnergyPicker';
import { useNow, useSettings } from '../hooks';

/** Self-reported energy counts for a few hours, then we ask again. */
const ENERGY_FRESH_MS = 6 * 60 * 60 * 1000;

export function currentEnergy(
  energyNow: { level: Energy; at: number } | undefined,
  now: number,
): Energy | undefined {
  return energyNow && now - energyNow.at < ENERGY_FRESH_MS ? energyNow.level : undefined;
}

export function PickScreen() {
  const navigate = useNavigate();
  const settings = useSettings();
  const [params] = useSearchParams();
  const paramEnergy = params.get('energy');
  const [energy, setEnergy] = useState<Energy | undefined>(() =>
    paramEnergy === 'low' || paramEnergy === 'medium' || paramEnergy === 'high'
      ? paramEnergy
      : currentEnergy(settings.energyNow, Date.now()),
  );
  const [quickOnly, setQuickOnly] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [pick, setPick] = useState<RouletteCandidate | null>(null);
  const [nothingLeft, setNothingLeft] = useState(false);

  const candidates = useLiveQuery(() => listRouletteCandidates(), []);
  const now = useNow(true, 60_000);
  if (!candidates) return <p aria-busy="true">Loading…</p>;

  const opts = (exclude: Set<string>): RouletteOptions => ({
    now,
    excludeIds: exclude,
    ...(energy ? { energy } : {}),
    ...(quickOnly ? { maxMinutes: 10 } : {}),
  });
  const available = eligibleCandidates(candidates, opts(new Set())).length;

  const spin = (exclude: Set<string>) => {
    const next = pickRoulette(candidates, opts(exclude));
    setPick(next ?? null);
    setNothingLeft(!next);
  };

  const skip = () => {
    if (!pick) return;
    const next = new Set(excluded).add(pick.task.id);
    setExcluded(next);
    spin(next);
  };

  const start = async () => {
    if (!pick) return;
    const { task, nextStep } = pick;
    await startSession({
      kind: 'launch',
      minutes: 2,
      goal: nextStep?.text ?? task.title,
      taskId: task.id,
      ...(nextStep ? { stepId: nextStep.id } : {}),
      ...(nextStep?.estimateMin ? { guessMin: nextStep.estimateMin } : {}),
      ...(settings.challenges !== false
        ? { challenge: challengeFor(task.barrier, nextStep?.id ?? task.id) }
        : {}),
    });
    navigate(`/task/${task.id}/do`);
  };

  if (candidates.filter((c) => c.task.status !== 'done').length === 0) {
    return (
      <div className="stack">
        <h1>Pick for me</h1>
        <div className="card soft stack">
          <p>There's nothing to pick from yet. Add a few things first.</p>
          <Link to="/dump" className="btn primary">
            Brain dump
          </Link>
          <Link to="/" className="btn">
            Add one task
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <h1>Pick for me</h1>
      <p className="muted">Skip the deciding. Pinned and due-soon tasks come up more often.</p>

      <EnergyPicker
        legend="How's your energy? (optional)"
        value={energy}
        onChange={(e) => {
          setEnergy(e);
          setPick(null);
          void updateSettings(
            e ? { energyNow: { level: e, at: Date.now() } } : { energyNow: undefined },
          );
        }}
      />
      <label className="radio-row">
        <input
          type="checkbox"
          checked={quickOnly}
          onChange={(e) => {
            setQuickOnly(e.target.checked);
            setPick(null);
          }}
        />
        <span>Only things with a next step of 10 minutes or less</span>
      </label>

      {!pick && (
        <button
          type="button"
          className="btn primary big"
          disabled={available === 0}
          onClick={() => spin(excluded)}
        >
          Pick for me
        </button>
      )}
      <p className="muted small" aria-live="polite">
        {available === 0
          ? 'Nothing matches these filters. Try changing them.'
          : `Choosing from ${available} task${available === 1 ? '' : 's'}.`}
      </p>

      {pick && (
        <section className="domino" aria-labelledby="pick-h" aria-live="polite">
          <p className="eyebrow" id="pick-h">
            How about this one?
          </p>
          <p className="domino-step">{pick.task.title}</p>
          {pick.nextStep && (
            <p>
              Next step: <strong>{pick.nextStep.text}</strong>
            </p>
          )}
          <button type="button" className="btn primary big" onClick={() => void start()}>
            Start (2 min)
          </button>
          <div className="domino-actions">
            <button type="button" className="btn" onClick={skip}>
              Not this one
            </button>
            <Link to={`/task/${pick.task.id}`} className="btn">
              Open task
            </Link>
          </div>
        </section>
      )}
      {nothingLeft && excluded.size > 0 && (
        <div className="notice" role="status">
          <p>That's everything that fits right now.</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setExcluded(new Set());
              spin(new Set());
            }}
          >
            Start over
          </button>
        </div>
      )}
    </div>
  );
}
