// "Loop" check on real games: analyze fixture games and print what we find.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { nodeEngine } from './node-engine';
import { analyzeGame } from '../src/lib/analyzer';
import { openingName } from '../src/lib/chesscom';

const dir = process.env.FIXTURES ?? '';
describe.skipIf(!dir || !existsSync(dir))('real game scan', () => {
  it('finds mistakes in fixture games', async () => {
    const engine = nodeEngine();
    const files = readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.json$/.test(f));
    const user = process.env.FIXTURE_USER ?? 'erik';
    let n = 0;
    for (const f of files) {
      const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      for (const g of data.games) {
        if (g.rules !== 'chess' || n >= Number(process.env.MAX_GAMES ?? 4)) continue;
        n++;
        const white = g.white.username.toLowerCase() === user;
        const rec = {
          id: g.url, url: g.url, pgn: g.pgn, endTime: g.end_time, timeClass: g.time_class, timeControl: g.time_control,
          rated: g.rated, userColor: white ? 'white' : 'black', userRating: 0, opponent: '', opponentRating: 0,
          result: 'win', opening: openingName(g.eco ?? ''),
        } as const;
        const t = Date.now();
        const a = await analyzeGame(engine, rec as any, 10);
        console.log(`${g.url} acc=${a.accuracy} moves=${a.moves} ${Date.now() - t}ms`);
        for (const m of a.mistakes) console.log(`  ${m.moveNumber}${m.userColor === 'white' ? '.' : '...'} ${m.played} (best ${m.best}) -${m.winLoss}% ${m.severity} ${m.theme} ${m.phase}${m.timePressure ? ' ⏱' : ''}`);
        expect(a.moves).toBeGreaterThan(0);
      }
    }
    engine.terminate();
  }, 600_000);
});
