// "Robot student": solves every case in the browser and reports anything odd.
//   FIXTURES=/path FIXTURE_USER=name node tests/audit.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');

const FIX = process.env.FIXTURES;
const USER = process.env.FIXTURE_USER ?? 'erik';
const MAX = Number(process.env.MAX_CASES ?? 40);
const port = 4196;
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'pipe', detached: true });
// cleanup-guard: always stop the preview server, even on failure or timeout
const killServer = () => { try { process.kill(-server.pid); } catch {} };
process.on('exit', killServer);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { killServer(); process.exit(1); });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('Local') && r()));
const stop = () => { try { process.kill(-server.pid); } catch {} };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('Failed to load resource') && errors.push(m.text()));
await page.addInitScript(() => { try { localStorage.setItem('voice-settings', JSON.stringify({ engine: 'device' })); } catch {} });
await page.route('https://api.chess.com/**', (route) => {
  const url = route.request().url();
  let file;
  if (url.endsWith(`/player/${USER}`)) file = 'profile.json';
  else if (url.endsWith('/games/archives')) file = 'archives.json';
  else { const m = url.match(/games\/(\d{4})\/(\d{2})$/); if (m) file = `${m[1]}-${m[2]}.json`; }
  if (file && existsSync(join(FIX, file))) return route.fulfill({ contentType: 'application/json', body: readFileSync(join(FIX, file)) });
  return route.fulfill({ contentType: 'application/json', body: url.includes('/games/') ? '{"games":[]}' : '{}', status: url.includes('/games/') ? 200 : 404 });
});
await page.route('https://images.chesscomfiles.com/**', (r) => r.fulfill({ status: 404 }));

await page.goto(`http://localhost:${port}/`);
await page.fill('#uname', USER);
await page.click('.connect button');
await page.waitForSelector('.dash-head');
const t0 = Date.now();
await page.waitForFunction(() => /games analyzed/.test(document.querySelector('.status')?.textContent ?? '') && !document.querySelector('.status .spin'), null, { timeout: 600000 });
console.log(`analysis of first batch: ${Math.round((Date.now() - t0) / 1000)}s`);

const ids = await page.$$eval('.case-grid a.case', (a) => a.map((x) => decodeURIComponent(x.getAttribute('href').replace('#/train/', ''))))
  .catch(() => []);
let caseIds = ids;
if (!caseIds.length) {
  await page.goto(`http://localhost:${port}/#/cases`);
  await page.waitForTimeout(800);
  caseIds = await page.$$eval('.case-grid a.case', (a) => a.map((x) => decodeURIComponent(x.getAttribute('href').replace('#/train/', ''))));
}
console.log(`cases found: ${caseIds.length}, auditing ${Math.min(MAX, caseIds.length)}`);

const sq = async (s, color) => {
  const box = await page.$eval('#board cg-board', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
  const f = s.charCodeAt(0) - 97, r = +s[1] - 1, size = box.w / 8;
  const x = color === 'white' ? f : 7 - f, y = color === 'white' ? 7 - r : r;
  return { x: box.x + (x + 0.5) * size, y: box.y + (y + 0.5) * size };
};
const move = async (uci, color) => {
  const a = await sq(uci.slice(0, 2), color), b = await sq(uci.slice(2, 4), color);
  await page.mouse.click(a.x, a.y); await page.waitForTimeout(80); await page.mouse.click(b.x, b.y);
};

const until = async (cond, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const st = await page.evaluate(() => window.__cdStep());
    if (cond(st)) return st;
    await page.waitForTimeout(150);
  }
  return null;
};
const SUSPICIOUS = [/undefined/, /NaN/, /\bnull\b/, /\[object/, /their their|your your/, /\bthe the\b/i, /\s—\s*$/m, /It's a quiet move that (improves|keeps)/];
const report = { solved: 0, dismissed: 0, stuck: 0, steps: [], times: [], flags: {} };
const flag = (k, id, extra = '') => { (report.flags[k] ??= []).push(id + (extra ? ` :: ${extra}` : '')); };

for (const id of caseIds.slice(0, MAX)) {
  const t = Date.now();
  await page.goto(`http://localhost:${port}/#/train/${encodeURIComponent(id)}`);
  await page.waitForSelector('.trainer .case-head h2');
  const color = (await page.evaluate(() => window.__cd())).color;
  let steps = 0;
  for (let k = 0; k < 8; k++) {
    const st = await page.evaluate(() => window.__cdStep());
    if (st.solved) break;
    if (!st.best) { flag('no-best', id); break; }
    // wait until the board accepts moves
    const st2 = await until((s) => s.interactive || s.solved, 30000);
    if (!st2) { flag('never-interactive', id); break; }
    if (st2.solved) break;
    await move(st2.best, color);
    steps++;
    const st3 = await until((s) => s.solved || (s.fen !== st2.fen && s.interactive) || (s.fen === st2.fen && s.interactive && false), 60000);
    if (!st3) { flag('timeout', id, `after ${st2.best}`); break; }
  }
  if (process.env.DEBUG && report.steps.length === 0) { await page.screenshot({ path: 'tests/screens/audit-debug.png' }); console.log('FEED>>', (await page.$eval('.feed', (e) => e.innerText)).slice(0, 1500)); console.log('STEP>>', JSON.stringify(await page.evaluate(() => window.__cdStep()))); }
  await page.waitForTimeout(300);
  const done = await page.$('.stamp');
  const feed = await page.$eval('.feed', (e) => e.innerText);
  if (/Case dismissed/.test(feed)) report.dismissed++;
  else if (done) report.solved++;
  else { report.stuck++; flag('stuck', id); }
  const stamp = done ? await done.textContent() : '';
  if (done && !/CASE CLOSED/.test(stamp)) flag('not-clean-despite-best-moves', id, stamp);
  for (const re of SUSPICIOUS) if (re.test(feed)) flag(`text:${re}`, id, (feed.match(new RegExp(`.{0,60}${re.source}.{0,40}`, 'm')) ?? [''])[0]);
  if (!/Correct|Excellent|Brilliant|Spot on|Yes/.test(feed) && done) flag('no-praise', id);
  report.steps.push(steps);
  report.times.push(Date.now() - t);
}
const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
console.log(JSON.stringify({ solved: report.solved, dismissed: report.dismissed, stuck: report.stuck, avgSteps: (report.steps.reduce((a, b) => a + b, 0) / Math.max(1, report.steps.length)).toFixed(2), multiStep: report.steps.filter((s) => s > 1).length, avgCaseMs: avg(report.times) }, null, 1));
for (const [k, v] of Object.entries(report.flags)) console.log(`FLAG ${k} (${v.length}):\n  ` + v.slice(0, 6).join('\n  '));
console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].join('\n') : 'No console errors.');
await browser.close();
stop();
