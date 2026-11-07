// Writes the quality numbers the improvement loop prints (scripts/out/quality.json).
import { it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { develop } from '../src/lib/develop';
import { autoSettings, sample } from '../src/lib/auto';
import { scene, degrade, meanDiff, metrics } from '../src/lib/quality';

it('quality scorecard', () => {
  const good = scene();
  const run = (img: typeof good) => develop(img.data, img.w, img.h, autoSettings(sample(img.data, img.w, img.h)).settings);
  const goodAuto = run(good);
  const rows: Record<string, unknown>[] = [];
  for (const kind of ['dark', 'bright', 'blue', 'warm', 'flat', 'dark+blue'] as const) {
    const bad = degrade(good, kind);
    const out = run(bad);
    const before = meanDiff(bad.data, goodAuto), after = meanDiff(out, goodAuto);
    const m = metrics({ ...bad, data: out });
    rows.push({ kind, fixedPct: Math.round((1 - after / before) * 100), median: +m.median.toFixed(2), greyCast: +m.greyCast.toFixed(3), clipped: +(m.clippedHi * 100).toFixed(2) });
  }
  const harm = meanDiff(goodAuto, good.data);
  mkdirSync('scripts/out', { recursive: true });
  writeFileSync('scripts/out/quality.json', JSON.stringify({ rows, goodPhotoChangePct: +(harm * 100).toFixed(1) }, null, 2));
});
