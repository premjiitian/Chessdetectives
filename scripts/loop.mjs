// The improvement loop in one command: `npm run loop`
//
// 1. Verify: run every check (types, unit tests, build, real-browser suites).
// 2. Score: print a scorecard against the quality bar in CLAUDE.md.
// 3. Fix the worst failing item, then run the loop again.
//
// Browser suites need saved chess.com data (see README → Checks):
//   FIXTURES=/path/to/folder FIXTURE_USER=name npm run loop
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const FIX = process.env.FIXTURES;
const haveFix = !!FIX && existsSync(FIX);
const steps = [
  { name: 'Type check', cmd: 'npx tsc --noEmit' },
  { name: 'Unit tests', cmd: 'npx vitest run', metric: /Tests\s+(\d+ passed[^\n]*)/ },
  { name: 'Build', cmd: 'npm run build' },
  { name: 'Robot student (solve every case)', cmd: 'node tests/audit.mjs', browser: true, metric: /"solved": (\d+)[\s\S]*"dismissed": (\d+)[\s\S]*"stuck": (\d+)/, fmt: (m) => `${m[1]} solved · ${m[2]} dismissed · ${m[3]} stuck`, fail: (out) => /"stuck": [1-9]|ERRORS:/.test(out) || /FLAG (timeout|never-interactive|no-best|not-clean)/.test(out) },
  { name: 'Edge cases', cmd: 'node tests/edge.mjs', browser: true, metric: /(\d+\/\d+) checks passed/ },
  { name: 'Chapters journey', cmd: 'node tests/chapters.mjs', browser: true, metric: /(\d+\/\d+) checks passed/, fail: (out) => /❌/.test(out) },
  { name: 'Accessibility (light)', cmd: 'node tests/a11y.mjs', browser: true, metric: /Total issue types: (\d+)/, fail: (out) => !/Total issue types: 0/.test(out) },
  { name: 'Accessibility (dark)', cmd: 'node tests/a11y.mjs', env: { DARK: '1' }, browser: true, metric: /Total issue types: (\d+)/, fail: (out) => !/Total issue types: 0/.test(out) },
  { name: 'iPad (4 sizes, touch)', cmd: 'node tests/ipad.mjs', browser: true, metric: /(\d+\/\d+) checks passed/ },
  { name: 'Sign-in UI (off / on)', cmd: 'node tests/signin.mjs', browser: true, metric: /(\d+\/\d+) checks passed/ },
  { name: 'Safety + saved progress', cmd: 'node tests/safety.mjs', browser: true, metric: /(\d+\/\d+) checks passed/ },
  { name: 'Offline (no internet)', cmd: 'node tests/offline.mjs', browser: true, metric: /(\d+\/\d+) checks passed/ },
  { name: 'Professor Pin voice', cmd: 'node tests/voice.mjs', browser: true, metric: /(\d+\/\d+) checks passed/ },
  { name: 'Walkthrough + screenshots', cmd: 'node tests/e2e.mjs', browser: true, metric: /(No console errors\.)/ },
];

const rows = [];
for (const s of steps) {
  if (s.browser && !haveFix) {
    rows.push([s.name, '⏭️ skipped', 'needs FIXTURES']);
    continue;
  }
  const t = Date.now();
  process.stdout.write(`▶ ${s.name}… `);
  const r = spawnSync(s.cmd, { shell: true, encoding: 'utf8', env: { ...process.env, ...(s.env ?? {}) }, maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const failed = r.status !== 0 || (s.fail ? s.fail(out) : false);
  const m = s.metric ? out.match(s.metric) : null;
  const detail = m ? (s.fmt ? s.fmt(m) : m[1]) : '';
  const secs = Math.round((Date.now() - t) / 1000);
  console.log(`${failed ? '❌' : '✅'} (${secs}s)`);
  if (failed) console.log(out.split('\n').filter((l) => /❌|FLAG|Error|error|FAIL|✗|×/.test(l)).slice(0, 12).join('\n'));
  rows.push([s.name, failed ? '❌ fail' : '✅ pass', detail]);
}

const w = [36, 10, 40];
const line = (c) => c.map((x, i) => String(x).padEnd(w[i])).join(' │ ');
console.log('\n' + line(['Check', 'Result', 'Detail']));
console.log(w.map((n) => '─'.repeat(n)).join('─┼─'));
for (const r of rows) console.log(line(r));
const bad = rows.filter((r) => r[1].includes('fail'));
console.log(`\n${bad.length ? `❌ ${bad.length} check(s) failing — fix the first one, then run the loop again.` : '✅ All checks pass. Pick the next improvement and loop again.'}`);
process.exit(bad.length ? 1 : 0);
