// Loop 9: is the coaching easy enough for kids? Flesch–Kincaid grade level.
//   npx vitest run tests/readability.test.ts         (fixed texts)
//   FIXTURES=/path FIXTURE_USER=name npx vitest run tests/readability.test.ts   (+ real explanations)
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { THEMES } from '../src/lib/themes';
import { pinLines } from '../src/lib/pin';
import { explainBest, explainFailure, hints, moveBrief } from '../src/lib/coach';
import { CHAPTERS } from '../src/lib/chapters';

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const m = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, m ? m.length : 1);
}

/** Flesch–Kincaid grade of one piece of text (chess moves and numbers removed). */
export function grade(text: string): number {
  const clean = text
    .replace(/\*\*/g, '')
    .replace(/\b\d+\.(\.\.)?/g, '')
    .replace(/\b(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=[QRBN])?[+#]?)\b/g, 'move')
    .replace(/[+-]?\d+(\.\d+)?%?/g, 'some');
  const sentences = Math.max(1, (clean.match(/[.!?]+(\s|$)/g) ?? []).length);
  const words = clean.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (!words.length) return 0;
  const syl = words.reduce((a, w) => a + syllables(w), 0);
  return 0.39 * (words.length / sentences) + 11.8 * (syl / words.length) - 15.59;
}

const report = (label: string, texts: string[]) => {
  const scored = texts.map((t) => ({ t, g: grade(t) })).sort((a, b) => b.g - a.g);
  const avg = scored.reduce((a, x) => a + x.g, 0) / Math.max(1, scored.length);
  console.log(`\n${label}: ${scored.length} texts, average grade ${avg.toFixed(1)}`);
  for (const x of scored.slice(0, 8)) console.log(`  ${x.g.toFixed(1)}  ${x.t.slice(0, 150)}`);
  return { avg, worst: scored[0]?.g ?? 0 };
};

describe('kid-friendly reading level', () => {
  it('fixed coaching texts', () => {
    const texts = [
      ...pinLines(),
      ...Object.values(THEMES).flatMap((t) => [t.short, t.lesson, t.hint]),
      ...CHAPTERS.map((c) => c.learn),
      ...hints('r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1', 'd5c7', '').slice(0, 1).map((h) => h.text),
    ];
    const r = report('Fixed texts', texts);
    expect(r.avg).toBeLessThan(Number(process.env.MAX_AVG ?? 99));
  });

  const dir = process.env.FIXTURES ?? '';
  it.skipIf(!dir || !existsSync(dir))('explanations generated from real games', async () => {
    const { nodeEngine } = await import('./node-engine');
    const { analyzeGame } = await import('../src/lib/analyzer');
    const engine = nodeEngine();
    const user = (process.env.FIXTURE_USER ?? 'erik').toLowerCase();
    const games = readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).flatMap((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')).games).filter((g: any) => g.rules === 'chess').slice(0, Number(process.env.MAX_GAMES ?? 6));
    const texts: string[] = [];
    const briefs: string[] = [];
    for (const g of games) {
      const a = await analyzeGame(engine, { id: g.url, pgn: g.pgn, timeControl: g.time_control, userColor: g.white.username.toLowerCase() === user ? 'white' : 'black' } as any, 8);
      for (const m of a.mistakes) {
        texts.push(...explainBest(m.fenBefore, { uci: m.pv, cp: 0, mate: null, depth: 8 }).filter((t) => !/main line/.test(t)));
        texts.push(...explainFailure(m.fenBefore, m.playedUci, { uci: m.refutation, cp: 0, mate: null, depth: 8 }).filter((t) => !/continuation/.test(t)));
        // The spoken summaries (▶ Listen): good move and wrong move.
        briefs.push(moveBrief(m.fenBefore, { uci: m.pv, cp: 0, mate: null }, 'good'));
        briefs.push(moveBrief(m.fenBefore, { uci: [m.playedUci, ...m.refutation], cp: -300, mate: null }, 'wrong', 'look for checks, captures and threats first.'));
      }
    }
    engine.terminate();
    report('Generated explanations', texts);
    const b = report('Spoken summaries (▶ Listen)', briefs.filter(Boolean));
    // Kids listen to these: easy words, and short (≤ 60 words each).
    expect(b.avg).toBeLessThanOrEqual(6);
    const long = briefs.filter((t) => t.split(/\s+/).length > 60);
    expect(long, long.join('\n')).toEqual([]);
  }, 600_000);
});
