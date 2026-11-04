// Turning engine numbers into human numbers.
import type { EngineLine } from './types';

/** Win chance (0..100) for the side to move, the same curve lichess uses. */
export function winPercent(line: Pick<EngineLine, 'cp' | 'mate'>): number {
  if (line.mate !== null && line.mate !== undefined) return line.mate > 0 ? 100 : 0;
  const cp = Math.max(-1000, Math.min(1000, line.cp ?? 0));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/** Accuracy for one move given the win% drop, again the lichess formula. */
export function moveAccuracy(winLoss: number): number {
  const a = 103.1668 * Math.exp(-0.04354 * Math.max(0, winLoss)) - 3.1669;
  return Math.max(0, Math.min(100, a));
}

export function severityOf(winLoss: number): 'blunder' | 'mistake' | 'inaccuracy' | null {
  if (winLoss >= 20) return 'blunder';
  if (winLoss >= 10) return 'mistake';
  if (winLoss >= 5) return 'inaccuracy';
  return null;
}

/** "+1.4", "-0.3", "M3", "-M2" from the point of view of `pov`. */
export function formatEval(line: Pick<EngineLine, 'cp' | 'mate'>, sign = 1): string {
  if (line.mate !== null && line.mate !== undefined) {
    const m = line.mate * sign;
    return m > 0 ? `M${m}` : `-M${-m}`;
  }
  const v = ((line.cp ?? 0) * sign) / 100;
  return (v > 0 ? '+' : '') + v.toFixed(1);
}

/** Flip a line's score to the other side's point of view. */
export function flip(line: EngineLine): EngineLine {
  return { ...line, cp: line.cp === null ? null : -line.cp, mate: line.mate === null ? null : -line.mate };
}

/** Fits the narrow eval bar: "+3.2", "-10", "M3". */
export function shortEval(line: Pick<EngineLine, 'cp' | 'mate'>): string {
  const t = formatEval(line);
  return t.length > 4 ? t.replace(/\.\d$/, '') : t;
}
