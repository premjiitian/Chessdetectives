// Repertoire builder: unit checks with a fake engine, plus a real-games run.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildRepertoire, allLines, countMoves, type RepMove } from '../src/lib/repertoire';
import { openingName } from '../src/lib/chesscom';

const pgn = (moves: string) => `[Event "x"]\n\n${moves} *`;
const game = (moves: string, color: 'white' | 'black', result = 'win') => ({ id: Math.random() + '', pgn: pgn(moves), userColor: color, result, opening: 'Test Opening' }) as any;

describe('repertoire builder', () => {
  it('keeps your usual move when it is good, upgrades it when it is not', async () => {
    const games = [game('1. e4 e5 2. Nf3 Nc6', 'white'), game('1. e4 e5 2. Nf3 Nc6', 'white'), game('1. e4 c5 2. Qh5', 'white', 'loss'), game('1. e4 c5 2. Qh5', 'white', 'loss')];
    // Fake engine: likes e4 and Nf3; thinks Qh5 is bad.
    const search = async (fen: string, _d: number, _m: number) => {
      const c = fen.split(' ')[0];
      if (c === 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR') return [{ uci: ['g1f3'], cp: 30, mate: null, depth: 1 }];
      if (c === 'rnbqkbnr/pp1ppppp/8/2p4Q/4P3/8/PPPP1PPP/RNB1KBNR') return [{ uci: ['g8f6'], cp: 80, mate: null, depth: 1 }]; // after Qh5: black is better
      return [{ uci: [fen.startsWith('rnbqkbnr/pppppppp') ? 'e2e4' : 'g1f3'], cp: 30, mate: null, depth: 1 }];
    };
    const rep = await buildRepertoire(games, 'white', search, { maxPly: 3, maxNodes: 20 });
    const e4 = rep.root.children[0];
    expect(e4.san).toBe('e4');
    expect(e4.kind).toBe('yours');
    const replies = e4.children.map((c: RepMove) => c.san).sort();
    expect(replies).toEqual(['c5', 'e5']);
    const vsC5 = e4.children.find((c: RepMove) => c.san === 'c5')!.children[0];
    expect(vsC5.kind).toBe('upgrade');
    expect(vsC5.san).toBe('Nf3');
    expect(vsC5.usual?.san).toBe('Qh5');
    const vsE5 = e4.children.find((c: RepMove) => c.san === 'e5')!.children[0];
    expect(vsE5.kind).toBe('yours');
    expect(allLines(rep)).toHaveLength(2);
    expect(countMoves(rep).upgrades).toBe(1);
  });

  const dir = process.env.FIXTURES ?? '';
  it.skipIf(!dir || !existsSync(dir))('builds a sensible repertoire from real games', async () => {
    const { nodeEngine } = await import('./node-engine');
    const engine = nodeEngine();
    const user = (process.env.FIXTURE_USER ?? 'erik').toLowerCase();
    const games = readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).flatMap((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')).games).filter((g: any) => g.rules === 'chess').map((g: any) => {
      const white = g.white.username.toLowerCase() === user;
      const me = white ? g.white : g.black;
      return { id: g.url, pgn: g.pgn, userColor: white ? 'white' : 'black', result: me.result === 'win' ? 'win' : ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'].includes(me.result) ? 'draw' : 'loss', opening: openingName(g.eco ?? '') };
    });
    const search = async (fen: string, depth: number, multipv: number) => (await engine.search(fen, { depth, multipv })).lines;
    for (const color of ['white', 'black'] as const) {
      const t = Date.now();
      const rep = await buildRepertoire(games as any, color, search, { depth: 12, maxNodes: 30 });
      const c = countMoves(rep);
      console.log(`\n${color.toUpperCase()}: ${rep.games} games, ${c.lines} lines, ${c.mine} of your moves (${c.yours} your style, ${c.upgrades} upgrades), ${rep.nodes} searches, ${Date.now() - t} ms`);
      const show = (ms: RepMove[], indent: string) => {
        for (const m of ms) {
          const tag = { yours: '✓ yours', upgrade: `⬆ upgrade (you play ${m.usual?.san} ${m.usual?.count}×)`, engine: '★ engine', reply: `· seen ${m.count}×`, 'engine-reply': '· engine reply' }[m.kind];
          console.log(`${indent}${m.ply % 2 ? Math.ceil(m.ply / 2) + '.' : Math.ceil(m.ply / 2) + '...'}${m.san}  ${tag}${m.opening ? '  [' + m.opening + ']' : ''}`);
          show(m.children, indent + '  ');
        }
      };
      show(rep.root.children, '  ');
      expect(c.lines).toBeGreaterThan(0);
    }
    engine.terminate();
  }, 900_000);
});
