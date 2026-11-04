// Loop 15: how often does Professor Pin say something concrete about the best move?
//   FIXTURES=/path FIXTURE_USER=name npx vitest run tests/concrete.test.ts
import { it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describeMove } from '../src/lib/coach';
import { lineToSan } from '../src/lib/tactics';

export const VAGUE = [/calm, useful move/, /quiet move that/, /improves your position/];

const dirs = (process.env.FIXTURES ?? '').split(',').filter((d) => d && existsSync(d));
it.skipIf(!dirs.length)('best-move explanations are concrete', async () => {
  const { nodeEngine } = await import('./node-engine');
  const { analyzeGame } = await import('../src/lib/analyzer');
  const engine = nodeEngine();
  const users = (process.env.FIXTURE_USER ?? 'erik').toLowerCase().split(',');
  let total = 0;
  const vague: string[] = [];
  for (const [i, dir] of dirs.entries()) {
    const user = users[i] ?? users[0];
    const games = readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).flatMap((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')).games).filter((g: any) => g.rules === 'chess').slice(0, Number(process.env.MAX_GAMES ?? 12));
    for (const g of games) {
      const a = await analyzeGame(engine, { id: g.url, pgn: g.pgn, timeControl: g.time_control, userColor: g.white.username.toLowerCase() === user ? 'white' : 'black' } as any, 9);
      for (const m of a.mistakes) {
        total++;
        const facts = describeMove(m.fenBefore, m.bestUci, 'you', m.pv).facts;
        if (process.env.SHOW && !/x|\+/.test(m.best)) console.log(`  ${m.best.padEnd(6)} ${facts.join(' ')}  [pv ${lineToSan(m.fenBefore, m.pv, 5).join(' ')}]`);
        if (facts.every((f) => VAGUE.some((re) => re.test(f)))) vague.push(`${m.best} :: pv ${lineToSan(m.fenBefore, m.pv, 6).join(' ')} :: ${m.fenBefore}`);
      }
    }
  }
  engine.terminate();
  const pct = Math.round((100 * (total - vague.length)) / Math.max(1, total));
  console.log(`concrete: ${total - vague.length}/${total} = ${pct}%`);
  for (const v of vague.slice(0, 12)) console.log('  VAGUE ' + v);
  expect(pct).toBeGreaterThanOrEqual(Number(process.env.MIN_CONCRETE ?? 90));
}, 900_000);
