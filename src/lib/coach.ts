// The coach: turns engine lines into plain-English explanations.
// Rule of the house — explain the *idea* first, then the moves.

import { Chess, type Move, type Square } from 'chess.js';
import { winPercent } from './evaluation';
import { NAME, VALUE, attackedBy, forkAfter, isDefended, lineToSan, materialSwing, pinAfter, play, threatsAgainst, type Side } from './tactics';
import type { EngineLine } from './types';

const pieceName = (t: keyof typeof NAME) => NAME[t];

function article(word: string) {
  return /^[aeiou]/.test(word) ? `an ${word}` : `a ${word}`;
}

function isPassed(chess: Chess, sq: Square, color: Side): boolean {
  const f = sq.charCodeAt(0) - 97;
  const r = +sq[1];
  for (const row of chess.board()) {
    for (const p of row) {
      if (!p || p.type !== 'p' || p.color === color) continue;
      const pf = p.square.charCodeAt(0) - 97;
      const pr = +p.square[1];
      if (Math.abs(pf - f) <= 1 && (color === 'w' ? pr > r : pr < r)) return false;
    }
  }
  return true;
}

/** Plain-language facts about what a single move does. */
export function describeMove(fen: string, uci: string, whose: 'you' | 'opponent' = 'you'): { san: string; facts: string[]; move: Move | null } {
  const d = describeOwnMove(fen, uci);
  if (whose === 'you') return d;
  // Same facts, told from the other side of the board.
  const swap = (t: string) =>
    t
      .replace(/\bfor you\b/g, 'for them')
      .replace('so your opponent has no time for their own plans', '@@')
      .replace(/\bYour\b/g, 'Their')
      .replace(/\byour\b/g, 'their')
      .replace('@@', 'so you are forced to respond');
  return { ...d, facts: d.facts.map(swap) };
}

function describeOwnMove(fen: string, uci: string): { san: string; facts: string[]; move: Move | null } {
  const before = new Chess(fen);
  const after = new Chess(fen);
  const mv = play(after, uci);
  if (!mv) return { san: uci, facts: [], move: null };
  const facts: string[] = [];
  const me = mv.color as Side;
  const moveNo = Number(fen.split(' ')[5] ?? 1);

  if (after.isCheckmate()) return { san: mv.san, facts: ['It is checkmate!'], move: mv };

  const defence: string[] = [];
  // Does this move take care of what the opponent was threatening?
  const threatsBefore = threatsAgainst(fen);
  if (threatsBefore.length) {
    const left = new Set(threatsAgainst(after.fen(), true).map((t) => t.uci));
    const stopped = threatsBefore.find((t) => !left.has(t.uci) && !(mv.captured && t.uci.slice(0, 2) === mv.to));
    if (stopped && !after.inCheck()) {
      defence.push(
        stopped.kind === 'mate'
          ? `It stops your opponent's threat of checkmate with ${stopped.san}.`
          : `It deals with your opponent's threat ${stopped.san}, which would win your ${pieceName(stopped.target!)}.`,
      );
    }
  }

  if (mv.captured) {
    const capV = VALUE[mv.captured];
    const free = !before.attackers(mv.to, me === 'w' ? 'b' : 'w').length;
    if (free) facts.push(`It wins the ${pieceName(mv.captured)} on ${mv.to} for free.`);
    else if (capV > VALUE[mv.piece]) facts.push(`It captures a ${pieceName(mv.captured)} with a ${pieceName(mv.piece)} — a good trade for you.`);
    else facts.push(`It captures the ${pieceName(mv.captured)} on ${mv.to}.`);
  }
  if (mv.promotion) facts.push(`The pawn promotes to ${article(pieceName(mv.promotion))}!`);
  if (after.inCheck()) facts.push('It comes with check, so your opponent has no time for their own plans.');

  const fork = forkAfter(fen, uci);
  if (fork) {
    const names = fork.targets.slice(0, 3).map((t) => (t.type === 'k' ? 'the king' : `the ${pieceName(t.type)} on ${t.square}`));
    facts.push(`It's a fork: your ${pieceName(mv.piece)} attacks ${names.join(' and ')} at the same time.`);
  }
  const pin = pinAfter(fen, uci);
  if (pin) {
    const back = pin.backType === 'k' ? 'king' : pieceName(pin.backType);
    facts.push(
      pin.skewer
        ? `It's a skewer: the ${pin.frontType === 'k' ? 'king' : pieceName(pin.frontType)} on ${pin.front} must move and expose the ${back} on ${pin.back}.`
        : `It pins the ${pieceName(pin.frontType)} on ${pin.front} to the ${back} behind it.`,
    );
  }
  if (!fork && !mv.captured) {
    const loose = attackedBy(after, mv.to).filter((t) => t.type !== 'p' && t.type !== 'k' && (!isDefended(after, t.square) || VALUE[t.type] > VALUE[mv.piece]));
    if (loose.length) facts.push(`It attacks the ${pieceName(loose[0].type)} on ${loose[0].square}.`);
  }
  facts.push(...defence);
  // Was the moved piece in danger before? Then the move rescues it.
  const wasAttacked = before.attackers(mv.from, me === 'w' ? 'b' : 'w').length > 0;
  const wasDefended = before.attackers(mv.from, me).length > 0;
  if (wasAttacked && (!wasDefended || mv.piece === 'q') && mv.piece !== 'k' && !mv.captured) {
    facts.push(`It moves your ${pieceName(mv.piece)} out of danger.`);
  }
  if (mv.isKingsideCastle() || mv.isQueensideCastle()) facts.push('It castles: the king gets safe and a rook joins the game.');
  else if (moveNo <= 12 && (mv.piece === 'n' || mv.piece === 'b') && (mv.from[1] === '1' || mv.from[1] === '8'))
    facts.push(`It develops your ${pieceName(mv.piece)} — getting pieces into play is the main job of the opening.`);
  if (mv.piece === 'p' && ['d4', 'e4', 'd5', 'e5'].includes(mv.to) && moveNo <= 15) facts.push('It grabs space in the center.');
  if (mv.piece === 'p' && isPassed(after, mv.to, me) && !mv.promotion) facts.push('It pushes a passed pawn — nothing can stop it with a pawn anymore.');
  if (mv.piece === 'k' && !mv.captured && !after.inCheck() && moveNo > 30) facts.push('It activates the king — in endgames the king is a strong fighter.');
  if (!facts.length) {
    const mob = (c: Chess) => c.moves().length;
    const b2 = new Chess(fen);
    const gain = mob(new Chess(flipTurn(after.fen()))) - mob(b2);
    if (gain > 3) facts.push(`It improves your ${pieceName(mv.piece)} and gives your pieces more room to work.`);
    else if (!threatsAgainst(after.fen(), true).length) facts.push(`It's a calm, useful move: your ${pieceName(mv.piece)} finds a better square and none of your pieces can be won.`);
    else facts.push(`It's a quiet move that keeps your position together.`);
  }
  return { san: mv.san, facts, move: mv };
}

function flipTurn(fen: string) {
  const p = fen.split(' ');
  p[1] = p[1] === 'w' ? 'b' : 'w';
  p[3] = '-';
  return p.join(' ');
}

/** Formats a line of SAN moves with move numbers, e.g. "18...Qb6 19.Qb3 d4". */
export function numberedLine(fen: string, uciLine: string[], max = 6): string {
  const san = lineToSan(fen, uciLine, max);
  let num = Number(fen.split(' ')[5] ?? 1);
  let white = fen.split(' ')[1] === 'w';
  const parts: string[] = [];
  san.forEach((s, i) => {
    if (white) parts.push(`${num}.${s}`);
    else parts.push(i === 0 ? `${num}...${s}` : s);
    if (!white) num++;
    white = !white;
  });
  return parts.join(' ');
}

export function outcomeOf(fen: string, line: EngineLine, pov: Side): string {
  if (line.mate !== null && line.mate > 0) return line.mate === 1 ? 'It ends the game on the spot.' : `It forces checkmate in ${line.mate}.`;
  const swing = materialSwing(fen, line.uci, pov, 8);
  const w = winPercent(line);
  if (swing >= 8) return 'You end up a queen (or more) ahead.';
  if (swing >= 4) return 'You end up a rook or more ahead.';
  if (swing >= 2) return 'You win material — about a piece ahead.';
  if (swing >= 1) return 'You win a pawn and keep the pressure.';
  if (w >= 80) return 'Your position becomes winning.';
  if (w >= 60) return 'You keep a clear advantage.';
  if (w >= 45) return 'The position stays balanced and healthy.';
  return 'It is the most stubborn defence — damage control matters too.';
}

/** Why the best move works. */
export function explainBest(fen: string, line: EngineLine): string[] {
  const pov = fen.split(' ')[1] as Side;
  const d = describeMove(fen, line.uci[0]);
  const out = [`**${d.san}** — ${d.facts.join(' ')}`];
  // For quiet moves, name the follow-up so the idea is concrete.
  const forcing = d.move && (d.move.captured || d.move.san.includes('+') || d.move.promotion);
  if (!forcing && line.uci.length >= 3) {
    const next = lineToSan(fen, line.uci, 3);
    if (next.length === 3) out.push(`The idea: after ${next[1]}, you continue with ${next[2]}.`);
  }
  if (line.uci.length > 1) out.push(`Stockfish's main line: ${numberedLine(fen, line.uci, 7)}.`);
  out.push(outcomeOf(fen, line, pov));
  return out;
}

/** Why a move (the one you played, or one you tried) doesn't work. */
export function explainFailure(fen: string, uci: string, reply: EngineLine | undefined): string[] {
  const after = new Chess(fen);
  const mv = play(after, uci);
  if (!mv) return [];
  const out: string[] = [];
  if (!reply || !reply.uci.length) return [`${mv.san} lets your advantage slip away.`];
  const oppPov = after.turn() as Side;
  const r = describeMove(after.fen(), reply.uci[0], 'opponent');
  const lost = materialSwing(after.fen(), reply.uci, oppPov, 8);
  if (reply.mate !== null && reply.mate > 0) {
    out.push(`After ${mv.san}, your opponent has **${r.san}** and a forced checkmate in ${reply.mate}.`);
  } else {
    out.push(`After ${mv.san}, your opponent answers **${r.san}**. ${r.facts.join(' ')}`);
    if (lost >= 2) out.push(`Overall that line costs you about ${lost} points of material (pawn = 1, knight/bishop = 3, rook = 5, queen = 9).`);
  }
  if (reply.uci.length > 1) out.push(`A likely continuation: ${numberedLine(after.fen(), reply.uci, 6)}.`);
  return out;
}

/** Kind words for an alternative that is fine but not the best. */
export function explainAlternative(fen: string, uci: string, altWin: number, bestWin: number): string[] {
  const d = describeMove(fen, uci);
  const gap = Math.round(bestWin - altWin);
  const out = [`**${d.san}** is a reasonable idea. ${d.facts.join(' ')}`];
  out.push(
    altWin >= 60
      ? `You'd still be better (≈${Math.round(altWin)}% winning chances) — but there's a stronger move worth about ${gap}% more. Detectives don't settle!`
      : `It keeps you in the game (≈${Math.round(altWin)}% winning chances), but there's a move that's about ${gap}% better. Look again.`,
  );
  return out;
}

export interface HintStep {
  text: string;
  square?: Square; // highlight this square
  arrow?: [Square, Square];
}

/** Progressive hints, from gentle to "here it is". */
export function hints(fen: string, best: string, themeHint: string): HintStep[] {
  const c = new Chess(fen);
  const mv = play(c, best);
  const forcing = mv && (mv.captured || c.inCheck() || mv.promotion);
  const steps: HintStep[] = [];
  const threat = threatsAgainst(fen)[0];
  steps.push({
    text: threat && !forcing
      ? `Danger! Your opponent is threatening something${threat.kind === 'mate' ? ' very serious' : ''}. If it were their move, what would they play?`
      : forcing
      ? 'Start with forcing moves: checks, captures and threats. Look at every one of them.'
      : 'First ask: what does your opponent want to do next? Then look for the move that stops it — or that makes your position clearly better.',
  });
  steps.push({ text: themeHint });
  if (mv) {
    steps.push({ text: `The hero of this position is your ${NAME[mv.piece]} — it's glowing on the board.`, square: mv.from });
    steps.push({ text: `Here's the move: ${mv.san}. Play it on the board to see why it works.`, arrow: [mv.from, mv.to] });
  }
  return steps;
}

export const QUOTES = [
  ['You may learn much more from a game you lose than from a game you win.', 'José Raúl Capablanca'],
  ['The blunders are all there on the board, waiting to be made.', 'Savielly Tartakower'],
  ['Every chess master was once a beginner.', 'Irving Chernev'],
  ['Tactics flow from a superior position.', 'Bobby Fischer'],
  ['When you see a good move, look for a better one.', 'Emanuel Lasker'],
  ['The threat is stronger than the execution.', 'Aron Nimzowitsch'],
];

/** "+1.4" style number plus plain words, from YOUR point of view. */
export function evalWords(line: Pick<EngineLine, 'cp' | 'mate'>): string {
  if (line.mate !== null && line.mate !== undefined) {
    if (line.mate > 0) return `M${line.mate} (a forced checkmate for you)`;
    if (line.mate < 0) return `-M${-line.mate} (a forced checkmate for your opponent)`;
    return 'checkmate';
  }
  const v = (line.cp ?? 0) / 100;
  const num = (v > 0 ? '+' : '') + v.toFixed(1);
  const a = Math.abs(v);
  const side = v > 0 ? 'you' : 'your opponent';
  const words =
    a < 0.5 ? 'about equal'
    : a < 1.5 ? `a small edge for ${side}`
    : a < 3 ? `clearly better for ${side}`
    : a < 6 ? `winning for ${side} — like being a piece up`
    : `completely winning for ${side}`;
  return `${num} (${words})`;
}

/** One sentence about how a move changed the evaluation. */
export function evalChange(before: Pick<EngineLine, 'cp' | 'mate'>, after: Pick<EngineLine, 'cp' | 'mate'>): string {
  const same = evalWords(before) === evalWords(after);
  return same ? `📊 Evaluation stays at ${evalWords(after)}.` : `📊 Evaluation: ${evalWords(before)} → ${evalWords(after)}.`;
}
