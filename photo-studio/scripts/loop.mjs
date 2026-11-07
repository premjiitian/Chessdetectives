// The improvement loop: run every check, then print one scorecard.
// Usage: npm run loop      (screenshots land in scripts/out/ — look at them!)
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const rows = [];
const step = (name, cmd) => {
  const t = Date.now();
  const r = spawnSync('sh', ['-c', cmd], { encoding: 'utf8' });
  rows.push({ name, ok: r.status === 0, ms: Date.now() - t, out: (r.stdout || '') + (r.stderr || '') });
  return rows.at(-1);
};

step('Type check', 'npx tsc --noEmit');
const unit = step('Unit + quality tests', 'npx vitest run');
step('Production build', 'npx vite build');
const web = step('Browser checks', 'node tests/browser.mjs');

const line = '─'.repeat(64);
console.log(`\n${line}\n  PHOTO STUDIO — SCORECARD\n${line}`);
for (const r of rows) console.log(`  ${r.ok ? '✅' : '❌'} ${r.name.padEnd(26)} ${(r.ms / 1000).toFixed(1)}s`);
const passed = unit.out.match(/Tests\s+(\d+) passed/); if (passed) console.log(`     ${passed[1]} unit tests passed`);

try {
  const q = JSON.parse(readFileSync('scripts/out/quality.json', 'utf8'));
  console.log(`\n  Output quality (auto edit on photos with known problems)`);
  console.log('  problem      fixed   brightness  grey cast  blown out');
  for (const r of q.rows) console.log(`  ${r.kind.padEnd(11)} ${String(r.fixedPct).padStart(4)}%   ${r.median.toFixed(2).padStart(6)}      ${r.greyCast.toFixed(3)}     ${r.clipped}%`);
  console.log(`  Already-good photo changed by ${q.goodPhotoChangePct}% (do no harm: < 4%)`);
} catch { console.log('  (no quality numbers — unit tests did not run)'); }

const m = web.out.match(/RESULTS (\{.*\})/);
if (m) {
  const res = JSON.parse(m[1]);
  console.log(`\n  Experience`);
  for (const [k, v] of Object.entries(res)) {
    if (typeof v === 'number') console.log(`  ⏱  ${k.padEnd(44)} ${(v / 1000).toFixed(2)}s`);
    else console.log(`  ${v === 'pass' ? '✅' : '❌'} ${k}${v === 'pass' ? '' : '  → ' + v.slice(5)}`);
  }
}
const failed = rows.filter((r) => !r.ok);
for (const f of failed) console.log(`\n❌ ${f.name} output (last lines):\n${f.out.split('\n').slice(-25).join('\n')}`);
console.log(`${line}\n  ${failed.length ? '❌ Not done yet' : '✅ All green'} — now look at the screenshots in scripts/out/\n${line}`);
process.exit(failed.length ? 1 : 0);
