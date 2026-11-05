// Repertoire builder: your own openings, upgraded with engine-best moves.
//
// For the side you play (White or Black):
//  - your move: keep your usual move when it's about as good as the best one
//    (that's your style); otherwise suggest Stockfish's best move ("upgrade");
//  - opponent's move: branch on the replies you actually meet most often,
//    or Stockfish's best reply when your games don't go that far.

import { Chess } from 'chess.js';
import { winPercent } from './evaluation';
import { parsePgn } from './analyzer';
import type { Color, EngineLine, GameRecord } from './types';

export type RepKind = 'yours' | 'upgrade' | 'engine' | 'reply' | 'engine-reply' | 'saved' | 'saved-reply';

/** Kinds where the opponent moves (the app plays them in practice). */
export const isReply = (k: RepKind) => k === 'reply' || k === 'engine-reply' || k === 'saved-reply';

/** Turns a line you saved (UCI moves from the start) into repertoire moves. */
export function lineFromMoves(color: Color, moves: string[], name = ''): RepMove[] {
  const c = new Chess();
  const out: RepMove[] = [];
  const mineFirst = color === 'white';
  for (const [i, uci] of moves.entries()) {
    let mv;
    try {
      mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      break; // stop at the first illegal move
    }
    const mine = (i % 2 === 0) === mineFirst;
    out.push({ uci, san: mv.san, fen: c.fen(), kind: mine ? 'saved' : 'saved-reply', ply: i + 1, count: 0, score: null, children: [] });
  }
  out.forEach((m, i) => (m.children = out[i + 1] ? [out[i + 1]] : []));
  if (out.length && name) out[out.length - 1].opening = name;
  return out;
}

export interface RepMove {
  uci: string;
  san: string;
  fen: string; // position after this move
  kind: RepKind;
  ply: number; // 1 = first move of the game
  count: number; // times this move happened in your games
  score: number | null; // your score (0..1) in games with this move
  evalLine?: EngineLine; // from YOUR side, after the move (for your moves)
  usual?: { uci: string; san: string; count: number; score: number | null; win: number }; // for upgrades
  bestWin?: number;
  opening?: string;
  /** Stockfish's top moves in the position BEFORE this move (side to move's view). */
  candidates?: EngineLine[];
  children: RepMove[];
}

export interface Repertoire {
  color: Color;
  builtAt: number;
  games: number; // games used
  root: { fen: string; children: RepMove[] };
  nodes: number;
}

export type Search = (fen: string, depth: number, multipv: number) => Promise<EngineLine[]>;

interface Stat {
  count: number;
  points: number;
  openings: Map<string, number>;
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const key = (fen: string) => fen.split(' ').slice(0, 4).join(' '); // ignore move counters

/** Your games as a tree: position -> move -> how often and how well. */
export function openingStats(games: GameRecord[], color: Color, maxPly: number) {
  const stats = new Map<string, Map<string, Stat>>();
  let used = 0;
  for (const g of games) {
    if (g.userColor !== color) continue;
    let p;
    try {
      p = parsePgn(g.pgn);
    } catch {
      continue;
    }
    used++;
    const pts = g.result === 'win' ? 1 : g.result === 'draw' ? 0.5 : 0;
    for (let i = 0; i < Math.min(maxPly, p.uci.length); i++) {
      const k = key(p.fens[i]);
      const moves = stats.get(k) ?? new Map<string, Stat>();
      const st = moves.get(p.uci[i]) ?? { count: 0, points: 0, openings: new Map() };
      st.count++;
      st.points += pts;
      st.openings.set(g.opening, (st.openings.get(g.opening) ?? 0) + 1);
      moves.set(p.uci[i], st);
      stats.set(k, moves);
    }
  }
  return { stats, used };
}

export interface BuildOptions {
  maxPly?: number; // how deep the repertoire goes (plies)
  depth?: number; // engine depth
  oppBranches?: number; // opponent replies to cover per position
  keepWithin?: number; // keep your move if within this many win-% of the best
  maxNodes?: number; // engine searches budget
  onProgress?: (done: number, budget: number) => void;
}

export async function buildRepertoire(games: GameRecord[], color: Color, search: Search, o: BuildOptions = {}): Promise<Repertoire> {
  const maxPly = o.maxPly ?? 12;
  const depth = o.depth ?? 14;
  const oppBranches = o.oppBranches ?? 2;
  const keepWithin = o.keepWithin ?? 4;
  const budget = o.maxNodes ?? 40;
  const { stats, used } = openingStats(games, color, maxPly);
  const myTurn = color === 'white' ? 'w' : 'b';
  let searches = 0;

  const sanOf = (fen: string, uci: string) => {
    const c = new Chess(fen);
    try {
      return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
    } catch {
      return '';
    }
  };
  const after = (fen: string, uci: string) => {
    const c = new Chess(fen);
    c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return c.fen();
  };
  const topOpening = (st?: Stat) => (st ? [...st.openings.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] : undefined);
  const seen = new Set<string>();

  async function expand(fen: string, ply: number): Promise<RepMove[]> {
    if (ply >= maxPly || seen.has(key(fen))) return [];
    seen.add(key(fen));
    const here = stats.get(key(fen));
    const ranked = here ? [...here.entries()].sort((a, b) => b[1].count - a[1].count) : [];

    if (fen.split(' ')[1] === myTurn) {
      // Your move.
      if (searches >= budget) return [];
      searches++;
      o.onProgress?.(searches, budget);
      const lines = await search(fen, depth, 3);
      const best = lines[0];
      if (!best?.uci[0]) return [];
      const bestWin = winPercent(best);
      const usual = ranked[0];
      let chosen = best.uci[0];
      let kind: RepKind = 'engine';
      let usualInfo: RepMove['usual'];
      let evalLine = best;
      if (usual) {
        const [u, st] = usual;
        let uLine = lines.find((l) => l.uci[0] === u);
        if (!uLine && searches < budget) {
          searches++;
          const r = (await search(after(fen, u), depth, 1))[0];
          if (r) uLine = { ...r, cp: r.cp === null ? null : -r.cp, mate: r.mate === null ? null : -r.mate, uci: [u, ...r.uci] };
        }
        const uWin = uLine ? winPercent(uLine) : 0;
        if (u === best.uci[0] || bestWin - uWin <= keepWithin) {
          chosen = u;
          kind = 'yours';
          evalLine = uLine ?? best;
        } else {
          kind = 'upgrade';
          usualInfo = { uci: u, san: sanOf(fen, u), count: st.count, score: st.count ? st.points / st.count : null, win: Math.round(uWin) };
        }
      }
      const st = here?.get(chosen);
      const next = after(fen, chosen);
      return [
        {
          uci: chosen,
          san: sanOf(fen, chosen),
          fen: next,
          kind,
          ply: ply + 1,
          count: st?.count ?? 0,
          score: st && st.count ? st.points / st.count : null,
          evalLine,
          usual: usualInfo,
          bestWin: Math.round(bestWin),
          opening: topOpening(st),
          candidates: lines.slice(0, 3).map((l) => ({ ...l, uci: l.uci.slice(0, 8) })),
          children: await expand(next, ply + 1),
        },
      ];
    }

    // Opponent's move: the replies you actually face, most common first.
    const replies = ranked.filter(([, st], i) => i < oppBranches && (st.count >= 2 || (ply < 4 && i === 0)));
    if (replies.length) {
      const out: RepMove[] = [];
      for (const [u, st] of replies) {
        const next = after(fen, u);
        out.push({ uci: u, san: sanOf(fen, u), fen: next, kind: 'reply', ply: ply + 1, count: st.count, score: st.points / st.count, opening: topOpening(st), children: await expand(next, ply + 1) });
      }
      return out;
    }
    // Nothing in your games: prepare for the engine's best reply (a few moves only).
    if (ply >= Math.min(maxPly, 10) || searches >= budget) return [];
    searches++;
    o.onProgress?.(searches, budget);
    const r = (await search(fen, depth, 1))[0];
    const u = r?.uci[0];
    if (!u) return [];
    const next = after(fen, u);
    return [{ uci: u, san: sanOf(fen, u), fen: next, kind: 'engine-reply', ply: ply + 1, count: 0, score: null, children: await expand(next, ply + 1) }];
  }

  const children = await expand(START, 0);
  return { color, builtAt: Date.now(), games: used, root: { fen: START, children }, nodes: searches };
}

/** Every line from the start to a leaf (for practice and display). */
export function allLines(rep: Repertoire): RepMove[][] {
  const out: RepMove[][] = [];
  const walk = (moves: RepMove[], path: RepMove[]) => {
    for (const m of moves) {
      const p = [...path, m];
      if (!m.children.length) out.push(p);
      else walk(m.children, p);
    }
  };
  walk(rep.root.children, []);
  return out;
}

export function countMoves(rep: Repertoire) {
  let mine = 0,
    upgrades = 0,
    yours = 0;
  const walk = (ms: RepMove[]) =>
    ms.forEach((m) => {
      if (m.kind === 'yours' || m.kind === 'upgrade' || m.kind === 'engine') mine++;
      if (m.kind === 'upgrade') upgrades++;
      if (m.kind === 'yours') yours++;
      walk(m.children);
    });
  walk(rep.root.children);
  return { mine, upgrades, yours, lines: allLines(rep).length };
}
