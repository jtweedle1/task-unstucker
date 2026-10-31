// Time-estimate check: compares a guess with how long a session actually ran.
// Framed as information for next time, never as a score.
import { elapsedMs, type TimerState } from './timer';

export interface EstimateResult {
  guessMin: number;
  actualMin: number;
  /** actual / guess */
  ratio: number;
  text: string;
}

export function roundMinutes(ms: number): number {
  return Math.max(1, Math.round(ms / 60_000));
}

export function compareEstimate(
  guessMin: number,
  session: TimerState & { endedAt?: number },
  now: number,
): EstimateResult | undefined {
  if (!(guessMin > 0)) return undefined;
  const ms = elapsedMs(session, session.endedAt ?? now);
  if (ms < 30_000) return undefined; // too short to say anything useful
  const actualMin = roundMinutes(ms);
  const ratio = ms / 60_000 / guessMin;
  const g = `${guessMin} min`;
  const a = `about ${actualMin} min`;
  const text =
    ratio < 0.75
      ? `Quicker than you guessed: ${a} (your guess was ${g}).`
      : ratio <= 1.25
        ? `Right around your guess: ${a} (you said ${g}).`
        : `That took ${a}. You guessed ${g}. Handy to know for next time.`;
  return { guessMin, actualMin, ratio, text };
}

/**
 * A gentle pattern note once there are a few comparisons. Uses the median so one long
 * interruption doesn't skew it.
 */
export function estimatePattern(ratios: number[]): string | undefined {
  if (ratios.length < 3) return undefined;
  const sorted = [...ratios].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  if (median >= 0.8 && median <= 1.25) return 'Your time guesses are usually close.';
  const x = Math.round(median * 10) / 10;
  return median > 1.25
    ? `Things usually take about ${x}× your guess. Worth padding plans a little.`
    : `Things usually take less time than you guess (about ${x}×).`;
}
