// Pattern spotting on the board: forks, pins, hanging pieces, material.
// Pure functions on top of chess.js, so they are easy to test.

import { Chess, type Move, type PieceSymbol, type Square } from 'chess.js';

export const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const NAME: Record<PieceSymbol, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export type Side = 'w' | 'b';
export const other = (c: Side): Side => (c === 'w' ? 'b' : 'w');

export function material(chess: Chess, color: Side): number {
  let sum = 0;
  for (const row of chess.board()) for (const p of row) if (p && p.color === color) sum += VALUE[p.type];
  return sum;
}

/** Non-pawn material of both sides together (start of game = 62). */
export function pieceMaterial(chess: Chess): number {
  let sum = 0;
  for (const row of chess.board()) for (const p of row) if (p && p.type !== 'p') sum += VALUE[p.type];
  return sum;
}

export function uciToMove(uci: string) {
  return { from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: uci[4] as PieceSymbol | undefined };
}

/** Plays a UCI move, returning the chess.js move or null if illegal. */
export function play(chess: Chess, uci: string): Move | null {
  try {
    return chess.move(uciToMove(uci));
  } catch {
    return null;
  }
}

export function sanOf(fen: string, uci: string): string {
  const c = new Chess(fen);
  return play(c, uci)?.san ?? uci;
}

/** Converts a UCI line to SAN, stopping at the first illegal move. */
export function lineToSan(fen: string, line: string[], max = 99): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of line.slice(0, max)) {
    const m = play(c, u);
    if (!m) break;
    out.push(m.san);
  }
  return out;
}

/**
 * Material change for `pov` after following `line` for up to `plies` half-moves.
 * We stop on a move where `pov` just moved or the line ends, and take the best
 * "settled" value so a half-finished exchange doesn't fool us.
 */
export function materialSwing(fen: string, line: string[], pov: Side, plies = 6): number {
  const c = new Chess(fen);
  const start = material(c, pov) - material(c, other(pov));
  let settled = 0;
  const n = Math.min(plies, line.length);
  for (let i = 0; i < n; i++) {
    if (!play(c, line[i])) break;
    const diff = material(c, pov) - material(c, other(pov)) - start;
    // After the opponent's reply the exchange is "settled" from pov's side.
    if (c.turn() === pov || i === n - 1) settled = diff;
  }
  return settled;
}

/** Squares of `victimColor` pieces attacked by the piece on `from`. */
export function attackedBy(chess: Chess, from: Square): { square: Square; type: PieceSymbol }[] {
  const piece = chess.get(from);
  if (!piece) return [];
  const out: { square: Square; type: PieceSymbol }[] = [];
  for (const row of chess.board()) {
    for (const p of row) {
      if (!p || p.color === piece.color) continue;
      if (chess.attackers(p.square, piece.color).includes(from)) out.push({ square: p.square, type: p.type });
    }
  }
  return out;
}

export function isDefended(chess: Chess, sq: Square): boolean {
  const p = chess.get(sq);
  if (!p) return false;
  return chess.attackers(sq, p.color).length > 0;
}

/**
 * A fork: after a move, the moved piece attacks two or more targets that are
 * worth more than itself, undefended, or the king.
 */
export function forkAfter(fenBefore: string, uci: string): { targets: { square: Square; type: PieceSymbol }[] } | null {
  const c = new Chess(fenBefore);
  const mv = play(c, uci);
  if (!mv) return null;
  const myVal = VALUE[mv.promotion ?? mv.piece];
  // A fork made by a piece that can simply be taken for free isn't a real fork.
  const attackers = c.attackers(mv.to, c.turn());
  if (attackers.length && !isDefended(c, mv.to) && mv.piece !== 'p') return null;
  const targets = attackedBy(c, mv.to).filter(
    (t) => t.type === 'k' || VALUE[t.type] > myVal || (!isDefended(c, t.square) && t.type !== 'p'),
  );
  return targets.length >= 2 ? { targets } : null;
}

const RAYS: Record<string, [number, number][]> = {
  b: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  r: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  q: [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]],
};

function sq(f: number, r: number): Square | null {
  if (f < 0 || f > 7 || r < 0 || r > 7) return null;
  return ('abcdefgh'[f] + (r + 1)) as Square;
}

/**
 * A pin (or skewer): after a move, the moved line-piece looks through an enemy
 * piece at a more valuable enemy piece behind it.
 */
export function pinAfter(fenBefore: string, uci: string): { front: Square; back: Square; frontType: PieceSymbol; backType: PieceSymbol; skewer: boolean } | null {
  const c = new Chess(fenBefore);
  const mv = play(c, uci);
  if (!mv) return null;
  const type = mv.promotion ?? mv.piece;
  const rays = RAYS[type];
  if (!rays) return null;
  const f0 = mv.to.charCodeAt(0) - 97;
  const r0 = +mv.to[1] - 1;
  for (const [df, dr] of rays) {
    let hit: { square: Square; type: PieceSymbol } | null = null;
    for (let k = 1; k < 8; k++) {
      const s = sq(f0 + df * k, r0 + dr * k);
      if (!s) break;
      const p = c.get(s);
      if (!p) continue;
      if (p.color === mv.color) break;
      if (!hit) {
        hit = { square: s, type: p.type };
        continue;
      }
      const frontV = hit.type === 'k' ? 100 : VALUE[hit.type];
      const backV = p.type === 'k' ? 100 : VALUE[p.type];
      if (backV > VALUE[type] || p.type === 'k' || backV > frontV) {
        if (frontV < backV || hit.type === 'k') {
          return { front: hit.square, back: s, frontType: hit.type, backType: p.type, skewer: hit.type === 'k' || frontV > backV };
        }
      }
      break;
    }
  }
  return null;
}

/** Was this exact move already possible for the opponent before we moved? */
export function wasThreatBefore(fenBefore: string, oppUci: string): boolean {
  const parts = fenBefore.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  try {
    const c = new Chess(parts.join(' '));
    if (c.inCheck()) return false;
    return !!play(c, oppUci);
  } catch {
    return false;
  }
}

import type { Phase } from './types';
export type { Phase };
export function phaseOf(fen: string, moveNumber: number): Phase {
  const c = new Chess(fen);
  const pm = pieceMaterial(c);
  if (pm <= 26) return 'endgame';
  if (moveNumber <= 12) return 'opening';
  return 'middlegame';
}

/**
 * What would the opponent do if it were their move right now?
 * Returns their "threats": mate in one, or captures that win material.
 */
export function threatsAgainst(fen: string, theirMoveAlready = false): { san: string; uci: string; kind: 'mate' | 'capture'; target?: PieceSymbol }[] {
  const parts = fen.split(' ');
  if (!theirMoveAlready) {
    parts[1] = parts[1] === 'w' ? 'b' : 'w';
    parts[3] = '-';
  }
  let c: Chess;
  try {
    c = new Chess(parts.join(' '));
  } catch {
    return [];
  }
  if (c.inCheck()) return [];
  const out: { san: string; uci: string; kind: 'mate' | 'capture'; target?: PieceSymbol }[] = [];
  for (const m of c.moves({ verbose: true })) {
    const uci = m.from + m.to + (m.promotion ?? '');
    if (m.san.endsWith('#')) {
      out.push({ san: m.san, uci, kind: 'mate' });
      continue;
    }
    if (!m.captured) continue;
    const defenders = c.attackers(m.to, c.turn() === 'w' ? 'b' : 'w');
    // A king can't recapture on a square the attacker still controls.
    const onlyKing = defenders.length === 1 && c.get(defenders[0])?.type === 'k';
    const defended = defenders.length > 0 && !(onlyKing && c.attackers(m.to, c.turn()).length >= 2);
    if (VALUE[m.captured] > VALUE[m.piece] || (!defended && VALUE[m.captured] >= 1)) {
      out.push({ san: m.san, uci, kind: 'capture', target: m.captured });
    }
  }
  // Mates first, then the most valuable captures.
  return out.sort((a, b) => (a.kind === 'mate' ? -100 : -VALUE[a.target!]) - (b.kind === 'mate' ? -100 : -VALUE[b.target!]));
}

/**
 * Material that STAYS won for `pov` along a line: after each of the
 * opponent's replies we take a reading, and keep the smallest one. A piece
 * grabbed mid-exchange and given back two moves later doesn't count.
 */
export function settledSwing(fen: string, line: string[], pov: Side, plies = 10): number {
  const c = new Chess(fen);
  const start = material(c, pov) - material(c, other(pov));
  const readings: number[] = [];
  for (let i = 0; i < Math.min(plies, line.length); i++) {
    if (!play(c, line[i])) break;
    if (c.turn() === pov && i >= 1) readings.push(material(c, pov) - material(c, other(pov)) - start);
  }
  if (!readings.length) return materialSwing(fen, line, pov, plies);
  // Ignore the very last reading if it's mid-trade (the line may stop early).
  return Math.min(...readings.slice(-3));
}
