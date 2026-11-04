// Puts each mistake into a "case file" category, so we can tell you which
// kind of mistake keeps coming back.

import type { Phase, ThemeId } from './types';
import { forkAfter, pinAfter, play, settledSwing, wasThreatBefore, type Side } from './tactics';
import { Chess } from 'chess.js';

export interface ThemeInfo {
  id: ThemeId;
  title: string;
  icon: string;
  short: string;
  lesson: string; // the coaching principle behind it
  hint: string;
}

export const THEMES: Record<ThemeId, ThemeInfo> = {
  'hung-piece': {
    id: 'hung-piece',
    title: 'Left a piece hanging',
    icon: '🫥',
    short: 'A piece was left where it could be taken for free.',
    lesson: 'Before every move, do a “blunder check”: after my move, what can my opponent capture, and is it protected?',
    hint: 'Look at what your opponent could capture next. Is everything protected?',
  },
  'ignored-threat': {
    id: 'ignored-threat',
    title: "Missed the opponent's threat",
    icon: '🚨',
    short: 'Your opponent had a threat and it was not answered.',
    lesson: 'After each opponent move, ask: “What does this move want to do?” Their threat comes before your plan.',
    hint: 'First ask what your opponent is threatening right now.',
  },
  'missed-win': {
    id: 'missed-win',
    title: 'Missed a winning tactic',
    icon: '🎯',
    short: 'A move that wins material was available.',
    lesson: 'Scan for checks, captures and threats — for both sides — every single move. Forcing moves first.',
    hint: 'There is a forcing move that wins material. Check every check and capture.',
  },
  'missed-mate': {
    id: 'missed-mate',
    title: 'Missed a checkmate',
    icon: '👑',
    short: 'You had a forced checkmate.',
    lesson: 'When the enemy king has few escape squares, look for checks first. Count the king’s flight squares.',
    hint: 'The enemy king is in danger. Start with checks.',
  },
  'allowed-mate': {
    id: 'allowed-mate',
    title: 'Walked into checkmate',
    icon: '⚠️',
    short: 'Your move allowed a forced checkmate.',
    lesson: 'Keep your king safe: watch your back rank and the squares around your king, especially when pieces leave.',
    hint: 'Your king is in more danger than it looks. Which move keeps it safe?',
  },
  'missed-fork': {
    id: 'missed-fork',
    title: 'Missed a fork',
    icon: '🍴',
    short: 'One move could attack two things at once.',
    lesson: 'Look for unprotected pieces and the king lined up for a double attack — knights and queens love forks.',
    hint: 'Can one of your pieces attack two targets at the same time?',
  },
  'allowed-fork': {
    id: 'allowed-fork',
    title: 'Allowed a fork',
    icon: '🔱',
    short: 'Your move let your opponent attack two pieces at once.',
    lesson: 'Watch for squares where an enemy knight or queen could hit two of your pieces. Keep pieces protected.',
    hint: 'Look for squares where an enemy piece could attack two of yours at once.',
  },
  'missed-pin': {
    id: 'missed-pin',
    title: 'Missed a pin or skewer',
    icon: '📌',
    short: 'Pieces were lined up for a pin or skewer.',
    lesson: 'When enemy pieces stand on the same line (file, rank, diagonal), a bishop, rook or queen can pin or skewer them.',
    hint: 'Two enemy pieces are standing on the same line. Can you use that?',
  },
  'opening-slip': {
    id: 'opening-slip',
    title: 'Opening slip',
    icon: '📖',
    short: 'An early move broke an opening principle.',
    lesson: 'In the opening: develop knights and bishops, fight for the center, castle early, and don’t move a piece twice without a reason.',
    hint: 'Use the opening rules: bring out a new piece, fight for the center, and keep your king safe.',
  },
  'endgame-technique': {
    id: 'endgame-technique',
    title: 'Endgame technique',
    icon: '🏁',
    short: 'A precise endgame move was missed.',
    lesson: 'In endgames, activate your king, push passed pawns, and put rooks behind passed pawns.',
    hint: 'In the endgame, the king is a fighting piece. Think about kings and passed pawns.',
  },
  'positional-slip': {
    id: 'positional-slip',
    title: 'Planning slip',
    icon: '🧭',
    short: 'A calmer, stronger plan was available.',
    lesson: 'When there is no tactic, improve your worst piece and ask what your opponent wants to do.',
    hint: 'No fireworks needed. Which of your pieces is doing the least? Improve it.',
  },
};

export interface ClassifyInput {
  fenBefore: string;
  playedUci: string;
  bestPv: string[];
  refutation: string[]; // opponent's best line after our move
  bestMate: number | null; // mate score (our pov) before our move
  afterMate: number | null; // mate score (opponent pov) after our move
  phase: Phase;
}

export function classify(i: ClassifyInput): ThemeId {
  const me = i.fenBefore.split(' ')[1] as Side;
  const opp: Side = me === 'w' ? 'b' : 'w';
  const best = i.bestPv[0];

  if (i.bestMate !== null && i.bestMate > 0 && i.bestMate <= 6) return 'missed-mate';
  if (i.afterMate !== null && i.afterMate > 0 && i.afterMate <= 6) return 'allowed-mate';

  // What does the opponent win after our move?
  const afterFen = (() => {
    const c = new Chess(i.fenBefore);
    play(c, i.playedUci);
    return c.fen();
  })();
  const lost = i.refutation.length ? settledSwing(afterFen, i.refutation, opp, 10) : 0;
  const reply = i.refutation[0];
  if (reply && lost >= 2) {
    if (forkAfter(afterFen, reply)) return 'allowed-fork';
    return wasThreatBefore(i.fenBefore, reply) && !touches(i.playedUci, reply) ? 'ignored-threat' : 'hung-piece';
  }

  // What could we have won?
  const gain = best ? settledSwing(i.fenBefore, i.bestPv, me, 10) : 0;
  if (best && gain >= 2) {
    if (forkAfter(i.fenBefore, best)) return 'missed-fork';
    if (pinAfter(i.fenBefore, best)) return 'missed-pin';
    return 'missed-win';
  }

  if (i.phase === 'opening') return 'opening-slip';
  if (i.phase === 'endgame') return 'endgame-technique';
  return 'positional-slip';
}

/** Did the opponent's reply land on the square our move came from or went to? */
function touches(ours: string, theirs: string) {
  return theirs.slice(2, 4) === ours.slice(2, 4);
}
