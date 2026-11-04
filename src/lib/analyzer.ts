// Replays one of your games with Stockfish and collects the moments where
// your winning chances dropped the most. Those moments become your puzzles.

import { Chess } from 'chess.js';
import type { Engine } from './engine';
import { moveAccuracy, severityOf, winPercent } from './evaluation';
import { classify } from './themes';
import { phaseOf } from './tactics';
import type { EngineLine, GameAnalysis, GameRecord, MistakeRecord } from './types';

export interface ParsedGame {
  fens: string[]; // fens[i] = position before ply i; fens[n] = final position
  uci: string[];
  san: string[];
  clocks: (number | undefined)[]; // seconds left after each ply
}

export function parsePgn(pgn: string): ParsedGame {
  const c = new Chess();
  c.loadPgn(pgn);
  const moves = c.history({ verbose: true });
  const clocks = [...pgn.matchAll(/\[%clk (\d+):(\d+):(\d+(?:\.\d+)?)\]/g)].map((m) => +m[1] * 3600 + +m[2] * 60 + +m[3]);
  return {
    fens: [...moves.map((m) => m.before), moves.length ? moves[moves.length - 1].after : c.fen()],
    uci: moves.map((m) => m.from + m.to + (m.promotion ?? '')),
    san: moves.map((m) => m.san),
    clocks: moves.map((_, i) => clocks[i]),
  };
}

function baseSeconds(timeControl: string): number | null {
  if (!timeControl || timeControl.includes('/')) return null; // daily games
  const base = Number(timeControl.split('+')[0]);
  return Number.isFinite(base) ? base : null;
}

async function evalPosition(engine: Engine, fen: string, depth: number): Promise<EngineLine> {
  const c = new Chess(fen);
  if (c.isCheckmate()) return { uci: [], cp: null, mate: 0, depth };
  if (c.isDraw() || c.isStalemate()) return { uci: [], cp: 0, mate: null, depth };
  const r = await engine.search(fen, { depth });
  return r.lines[0] ?? { uci: r.bestmove ? [r.bestmove] : [], cp: 0, mate: null, depth };
}

export async function analyzeGame(
  engine: Engine,
  game: GameRecord,
  depth = 10,
  onProgress?: (ply: number, total: number) => void,
): Promise<GameAnalysis> {
  const parsed = parsePgn(game.pgn);
  const userTurn = game.userColor === 'white' ? 'w' : 'b';
  const evals: EngineLine[] = [];
  for (let i = 0; i < parsed.fens.length; i++) {
    evals.push(await evalPosition(engine, parsed.fens[i], depth));
    onProgress?.(i + 1, parsed.fens.length);
  }

  const base = baseSeconds(game.timeControl);
  const mistakes: MistakeRecord[] = [];
  const accs: number[] = [];
  for (let ply = 0; ply < parsed.uci.length; ply++) {
    const fen = parsed.fens[ply];
    if (fen.split(' ')[1] !== userTurn) continue;
    const before = evals[ply];
    const after = evals[ply + 1];
    const winBefore = winPercent(before);
    const winAfter = 100 - winPercent(after);
    const winLoss = Math.max(0, winBefore - winAfter);
    accs.push(moveAccuracy(winLoss));
    const sev = severityOf(winLoss);
    const bestUci = before.uci[0];
    if (!sev || sev === 'inaccuracy' || !bestUci || bestUci === parsed.uci[ply]) continue;
    // Already hopeless or still totally winning? Not a useful lesson.
    if (winBefore < 8) continue;

    const moveNumber = Math.floor(ply / 2) + 1;
    const phase = phaseOf(fen, moveNumber);
    const clock = parsed.clocks[ply];
    const timePressure = base !== null && clock !== undefined && (clock < Math.max(10, base * 0.1));
    const theme = classify({
      fenBefore: fen,
      playedUci: parsed.uci[ply],
      bestPv: before.uci,
      refutation: after.uci,
      bestMate: before.mate,
      afterMate: after.mate,
      phase,
    });
    const c = new Chess(fen);
    const bestSan = c.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci[4] }).san;
    mistakes.push({
      id: `${game.id}#${ply}`,
      gameId: game.id,
      ply,
      moveNumber,
      fenBefore: fen,
      played: parsed.san[ply],
      playedUci: parsed.uci[ply],
      best: bestSan,
      bestUci,
      pv: before.uci.slice(0, 10),
      refutation: after.uci.slice(0, 8),
      winBefore: Math.round(winBefore),
      winAfter: Math.round(winAfter),
      winLoss: Math.round(winLoss),
      severity: sev,
      theme,
      phase,
      timePressure,
      clockSeconds: clock,
      endTime: game.endTime,
      timeClass: game.timeClass,
      opening: game.opening,
      userColor: game.userColor,
    });
  }
  const accuracy = accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : 100;
  return { gameId: game.id, depth, accuracy: Math.round(accuracy * 10) / 10, mistakes, moves: accs.length, analyzedAt: Date.now() };
}
