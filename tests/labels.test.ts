// Loop 16: are the mistake labels (themes) right? An independent, deeper check
// decides which family each mistake belongs to, then we compare with the label.
//   FIXTURES=/a,/b FIXTURE_USER=u1,u2 npx vitest run tests/labels.test.ts
import { it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Chess } from 'chess.js';
import { materialSwing, play, lineToSan } from '../src/lib/tactics';

const MATERIAL_LOSS = new Set(['hung-piece', 'ignored-threat', 'allowed-fork', 'allowed-mate']);
const MISSED_GAIN = new Set(['missed-win', 'missed-fork', 'missed-pin', 'missed-mate']);

const dirs = (process.env.FIXTURES ?? '').split(',').filter((d) => d && existsSync(d));
it.skipIf(!dirs.length)('mistake labels agree with a deeper independent check', async () => {
  const { nodeEngine } = await import('./node-engine');
  const { analyzeGame } = await import('../src/lib/analyzer');
  const engine = nodeEngine();
  const users = (process.env.FIXTURE_USER ?? 'erik').toLowerCase().split(',');
  let total = 0;
  const wrong: string[] = [];
  const counts: Record<string, number> = {};
  for (const [i, dir] of dirs.entries()) {
    const user = users[i] ?? users[0];
    const games = readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).flatMap((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')).games).filter((g: any) => g.rules === 'chess').slice(0, Number(process.env.MAX_GAMES ?? 14));
    for (const g of games) {
      const a = await analyzeGame(engine, { id: g.url, pgn: g.pgn, timeControl: g.time_control, userColor: g.white.username.toLowerCase() === user ? 'white' : 'black' } as any, 10);
      for (const m of a.mistakes) {
        total++;
        counts[m.theme] = (counts[m.theme] ?? 0) + 1;
        const me = m.fenBefore.split(' ')[1] as 'w' | 'b';
        const opp = me === 'w' ? 'b' : 'w';
        const after = new Chess(m.fenBefore);
        play(after, m.playedUci);
        const ref = (await engine.search(after.fen(), { depth: 16 })).lines[0];
        const best = (await engine.search(m.fenBefore, { depth: 16 })).lines[0];
        const lost = ref?.mate !== null && (ref?.mate ?? 0) > 0 ? 99 : materialSwing(after.fen(), ref?.uci ?? [], opp, 8);
        const gain = best?.mate !== null && (best?.mate ?? 0) > 0 ? 99 : materialSwing(m.fenBefore, best?.uci ?? [], me, 8);
        const expected = lost >= 2 ? 'loses material' : gain >= 2 ? 'misses a win' : 'positional';
        const got = MATERIAL_LOSS.has(m.theme) ? 'loses material' : MISSED_GAIN.has(m.theme) ? 'misses a win' : 'positional';
        if (expected !== got)
          wrong.push(`${m.theme} (=${got}) but deeper check: ${expected} [lost ${lost}, gain ${gain}] ${m.played} best ${m.best} | refut ${lineToSan(after.fen(), ref?.uci ?? [], 4).join(' ')} | ${m.fenBefore}`);
      }
    }
  }
  engine.terminate();
  const pct = Math.round((100 * (total - wrong.length)) / Math.max(1, total));
  console.log(`labels agree: ${total - wrong.length}/${total} = ${pct}%   themes: ${JSON.stringify(counts)}`);
  for (const w of wrong.slice(0, 15)) console.log('  ✗ ' + w);
  expect(pct).toBeGreaterThanOrEqual(Number(process.env.MIN_LABELS ?? 90));
}, 1_800_000);
