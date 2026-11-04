// Friendly sparring partners for beginners and kids.
// Stockfish's own "weakest" setting is still ~1320 rating, so for lower levels
// we let it look at a few good moves and choose like a human would: usually a
// decent move, sometimes a weaker one, and now and then a real blunder that a
// young player can learn to punish.

import { Chess } from 'chess.js';
import type { Engine } from './engine';
import type { EngineLine } from './types';

export interface BotStyle {
  depth: number;
  multipv: number;
  blunder: number; // chance of a random (often bad) move
  temperature: number; // in centipawns: higher = more random among good moves
  seesMateInOne: boolean;
}

export const KID_LEVELS: Record<number, BotStyle> = {
  600: { depth: 2, multipv: 8, blunder: 0.3, temperature: 260, seesMateInOne: false },
  900: { depth: 3, multipv: 6, blunder: 0.18, temperature: 170, seesMateInOne: true },
  1100: { depth: 5, multipv: 5, blunder: 0.1, temperature: 110, seesMateInOne: true },
};

const score = (l: EngineLine) => (l.mate !== null ? (l.mate > 0 ? 10000 - l.mate : -10000 - l.mate) : (l.cp ?? 0));

/** Pure choice so it can be tested: lines are the engine's top moves, best first. */
export function chooseMove(lines: EngineLine[], legal: string[], style: BotStyle, rand: () => number = Math.random): string | null {
  if (!legal.length) return null;
  const top = lines.filter((l) => l.uci[0]);
  if (style.seesMateInOne && top[0]?.mate === 1) return top[0].uci[0];
  if (!top.length || rand() < style.blunder) return legal[Math.floor(rand() * legal.length)];
  const best = score(top[0]);
  const w = top.map((l) => Math.exp((score(l) - best) / style.temperature));
  let r = rand() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < top.length; i++) if ((r -= w[i]) <= 0) return top[i].uci[0];
  return top[0].uci[0];
}

export async function botMove(engine: Engine, fen: string, level: number): Promise<string | null> {
  const style = KID_LEVELS[level];
  if (!style) {
    const r = await engine.search(fen, level ? { movetime: 700, elo: level } : { movetime: 900 });
    return r.bestmove;
  }
  const r = await engine.search(fen, { depth: style.depth, multipv: style.multipv });
  const legal = new Chess(fen).moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? ''));
  // Think for a moment, like a person would.
  await new Promise((res) => setTimeout(res, 350 + Math.random() * 500));
  return chooseMove(r.lines, legal, style);
}
