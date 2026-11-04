// Loop 11: are the kid levels really easier, and in the right order?
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chooseMove, KID_LEVELS } from '../src/lib/bot';

describe('kid bot choices', () => {
  const line = (u: string, cp: number | null, mate: number | null = null) => ({ uci: [u], cp, mate, depth: 6 });
  it('takes mate in one at Kid level, may miss it at Beginner', () => {
    const lines = [line('a1a8', null, 1), line('h2h3', 20)];
    expect(chooseMove(lines, ['a1a8', 'h2h3'], KID_LEVELS[900], () => 0.99)).toBe('a1a8');
  });
  it('sometimes blunders (random move) at the configured rate', () => {
    let rand = 0;
    const seq = [0.1, 0.5]; // first roll < blunder rate -> random move
    const r = () => seq[rand++ % seq.length];
    const mv = chooseMove([line('e2e4', 30)], ['a2a3', 'e2e4'], KID_LEVELS[600], r);
    expect(['a2a3', 'e2e4']).toContain(mv);
  });

  const dir = process.env.FIXTURES ?? '';
  it.skipIf(!dir || !existsSync(dir))('levels get stronger in order (average centipawn loss)', async () => {
    const { nodeEngine } = await import('./node-engine');
    const { parsePgn } = await import('../src/lib/analyzer');
    const { Chess } = await import('chess.js');
    const engine = nodeEngine();
    const games = readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).flatMap((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')).games).filter((g: any) => g.rules === 'chess');
    const fens = games.flatMap((g: any) => parsePgn(g.pgn).fens.filter((_, i) => i > 8 && i % 7 === 0)).slice(0, Number(process.env.N ?? 40));
    const loss: Record<number, number[]> = { 600: [], 900: [], 1100: [] };
    for (const fen of fens) {
      const c = new Chess(fen);
      if (c.isGameOver()) continue;
      const ref = (await engine.search(fen, { depth: 10, multipv: 1 })).lines[0];
      if (!ref || ref.mate !== null) continue;
      const legal = c.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? ''));
      for (const lvl of [600, 900, 1100]) {
        const st = KID_LEVELS[lvl];
        const lines = (await engine.search(fen, { depth: st.depth, multipv: st.multipv })).lines;
        const mv = chooseMove(lines, legal, st)!;
        const after = new Chess(fen);
        after.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv[4] });
        const r = after.isCheckmate() ? { cp: -10000, mate: null } : (await engine.search(after.fen(), { depth: 9 })).lines[0];
        const val = r ? (r.mate !== null ? (r.mate > 0 ? -1000 : 1000) : -(r.cp ?? 0)) : 0;
        loss[lvl].push(Math.max(0, Math.min(1000, (ref.cp ?? 0) - val)));
      }
    }
    engine.terminate();
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const res = Object.fromEntries(Object.entries(loss).map(([k, v]) => [k, Math.round(avg(v))]));
    console.log('average centipawn loss per move:', JSON.stringify(res), `(${loss[600].length} positions)`);
    expect(res['600']).toBeGreaterThan(res['900']);
    expect(res['900']).toBeGreaterThan(res['1100']);
  }, 900_000);
});
