// Loop 5: accessibility scan of every screen with axe-core (WCAG 2.1 A/AA).
//   FIXTURES=/path FIXTURE_USER=name node tests/a11y.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const FIX = process.env.FIXTURES;
const USER = process.env.FIXTURE_USER ?? 'erik';
const port = 4194;
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'pipe', detached: true });
// cleanup-guard: always stop the preview server, even on failure or timeout
const killServer = () => { try { process.kill(-server.pid); } catch {} };
process.on('exit', killServer);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { killServer(); process.exit(1); });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('Local') && r()));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, colorScheme: process.env.DARK ? 'dark' : 'light' });
const page = await ctx.newPage();
await page.addInitScript(() => {
  try {
    localStorage.setItem('voice-settings', JSON.stringify({ engine: 'device' }));
  } catch {}
});
await page.route('https://images.chesscomfiles.com/**', (r) => r.fulfill({ status: 404 }));
await page.route('https://api.chess.com/**', (route) => {
  const url = route.request().url();
  let file;
  if (url.endsWith(`/player/${USER}`)) file = 'profile.json';
  else if (url.endsWith('/games/archives')) file = 'archives.json';
  else {
    const m = url.match(/games\/(\d{4})\/(\d{2})$/);
    if (m) file = `${m[1]}-${m[2]}.json`;
  }
  if (file && existsSync(join(FIX, file))) return route.fulfill({ contentType: 'application/json', body: readFileSync(join(FIX, file)) });
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{"games":[]}' });
});

let total = 0;
async function scan(name) {
  await page.addScriptTag({ content: axeSource });
  const res = await page.evaluate(async () =>
    window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }),
  );
  const v = res.violations;
  total += v.length;
  console.log(`\n== ${name}: ${v.length ? v.length + ' issue type(s)' : 'clean ✅'}`);
  for (const x of v) {
    console.log(`  [${x.impact}] ${x.id}: ${x.help} (${x.nodes.length}×)`);
    for (const n of x.nodes.slice(0, 3)) console.log(`      ${n.target.join(' ')}  ${(n.failureSummary || '').split('\n')[1]?.trim() ?? ''}`);
  }
}

await page.goto(`http://localhost:${port}/`);
await page.waitForSelector('.hero');
await scan('welcome');
await page.fill('#uname', USER);
await page.click('.connect button');
await page.waitForSelector('.dash-head');
await page.waitForFunction(() => /games analyzed/.test(document.querySelector('.status')?.textContent ?? '') && !document.querySelector('.status .spin'), null, { timeout: 600000 });
await scan('dashboard');
await page.goto(`http://localhost:${port}/#/train`);
await page.waitForSelector('.trainer .case-head h2');
await page.waitForTimeout(1500);
await scan('train');
await page.goto(`http://localhost:${port}/#/cases`);
await page.waitForTimeout(800);
await scan('case files');
await page.goto(`http://localhost:${port}/#/play`);
await page.waitForTimeout(1500);
await scan('spar');
await page.goto(`http://localhost:${port}/#/progress`);
await page.waitForTimeout(500);
await scan('progress');
console.log(`\nTotal issue types: ${total}`);
await browser.close();
try {
  process.kill(-server.pid);
} catch {}
