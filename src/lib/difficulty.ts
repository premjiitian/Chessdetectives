// How hard is a puzzle? A simple, explainable score from the position itself:
// quiet moves, long lines and defensive ideas are harder to see than a free capture.

import { Chess } from 'chess.js';
import { VALUE, materialSwing, play, type Side } from './tactics';
import type { MistakeRecord } from './types';

export const LEVELS = [
  { level: 1, label: 'Beginner', rating: 800 },
  { level: 2, label: 'Easy', rating: 1100 },
  { level: 3, label: 'Medium', rating: 1400 },
  { level: 4, label: 'Hard', rating: 1700 },
  { level: 5, label: 'Expert', rating: 2000 },
] as const;

export interface Difficulty {
  level: 1 | 2 | 3 | 4 | 5;
  label: string;
  rating: number; // rough puzzle rating
  reasons: string[]; // why it's this hard, shown after reveal
}

type Input = Pick<MistakeRecord, 'fenBefore' | 'pv' | 'theme'>;

export function difficultyOf(m: Input): Difficulty {
  const reasons: string[] = [];
  let score = 1.5;
  const c = new Chess(m.fenBefore);
  const me = c.turn() as Side;
  const legal = c.moves().length;
  const best = m.pv[0];
  const mv = best ? play(c, best) : null;

  if (mv) {
    const forcing = !!(mv.captured || c.inCheck() || mv.promotion);
    if (!forcing) {
      score += 1.5;
      reasons.push('the best move is quiet (no check or capture)');
    } else if (mv.captured && !new Chess(m.fenBefore).attackers(mv.to, me === 'w' ? 'b' : 'w').length) {
      score -= 1;
      reasons.push('it starts by grabbing an unprotected piece');
    } else if (c.inCheck()) {
      score -= 0.3;
      reasons.push('it starts with a check');
    }
    if (mv.captured && VALUE[mv.captured] < VALUE[mv.piece] && new Chess(m.fenBefore).attackers(mv.to, me === 'w' ? 'b' : 'w').length) {
      score += 1;
      reasons.push('it involves a sacrifice');
    }
    const backward = me === 'w' ? +mv.to[1] < +mv.from[1] : +mv.to[1] > +mv.from[1];
    if (backward && mv.piece !== 'p') {
      score += 0.5;
      reasons.push('the key move goes backwards — easy to overlook');
    }
  }

  // The payoff only comes several moves later?
  const gainNow = materialSwing(m.fenBefore, m.pv, me, 2);
  const gainLater = materialSwing(m.fenBefore, m.pv, me, 8);
  if (gainLater >= 2 && gainNow < 2) {
    score += 1;
    reasons.push('you have to see a few moves ahead to find the gain');
  }
  if (m.theme === 'ignored-threat' || m.theme === 'allowed-mate' || m.theme === 'allowed-fork') {
    score += 0.5;
    reasons.push("it's about defending — the opponent's idea must be spotted first");
  }
  if (legal > 38) {
    score += 0.5;
    reasons.push('there are many possible moves to choose from');
  }
  if (m.theme === 'missed-mate' && m.pv.length >= 5) {
    score += 1;
    reasons.push('the checkmate takes several moves');
  }

  const level = Math.max(1, Math.min(5, Math.round(score))) as Difficulty['level'];
  const info = LEVELS[level - 1];
  return { level, label: info.label, rating: info.rating, reasons: reasons.length ? reasons : ['a direct, forcing idea'] };
}
