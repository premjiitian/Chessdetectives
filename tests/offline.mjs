// Loop 14: after one visit, puzzles and Stockfish work with no internet.
//   FIXTURES=/path FIXTURE_USER=name node tests/offline.mjs
import { createRequire } from 'node:module';
import { waitStep } from './helpers.mjs';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');

const FIX = process.env.FIXTURES;
const USER = process.env.FIXTURE_USER ?? 'erik';
const port = 4187;
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'pipe', detached: true });
// cleanup-guard: always stop the preview server, even on failure or timeout
const killServer = () => { try { process.kill(-server.pid); } catch {} };
process.on('exit', killServer);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { killServer(); process.exit(1); });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('Local') && r()));
const browser = await chromium.launch();
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => {
  try {
    localStorage.setItem('voice-settings', JSON.stringify({ engine: 'device' }));
  } catch {}
});
await ctx.route('https://images.chesscomfiles.com/**', (r) => r.fulfill({ status: 404 }));
await ctx.route('https://i.ytimg.com/**', (r) => r.fulfill({ status: 404 }));
await ctx.route('https://api.chess.com/**', (route) => {
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

// First visit, online.
await page.goto(`http://localhost:${port}/`);
await page.fill('#uname', USER);
await page.click('.connect button');
await page.waitForSelector('.dash-head');
await page.waitForFunction(() => /games analyzed/.test(document.querySelector('.status')?.textContent ?? '') && !document.querySelector('.status .spin'), null, { timeout: 600000 });
await page.goto(`http://localhost:${port}/#/train`);
await page.waitForSelector('.trainer .case-head h2');
await waitStep(page, (s) => !!s.best, 60000);
const swReady = await page.evaluate(async () => !!(await navigator.serviceWorker?.ready));
check('offline helper is installed after the first visit', swReady);
// Give it a moment to save files, then report what is saved.
const saved = await page
  .waitForFunction(async () => {
    const c = await caches.open('chess-detectives-v2');
    const keys = (await c.keys()).map((r) => r.url);
    return keys.some((u) => u.endsWith('.wasm')) && keys.some((u) => /assets\/index-.*\.js$/.test(u)) ? keys.length : false;
  }, null, { timeout: 30000, polling: 500 })
  .then((h) => h.jsonValue())
  .catch(async () => page.evaluate(async () => (await (await caches.open('chess-detectives-v2')).keys()).map((r) => r.url.split('/').pop())));
check('app files and Stockfish are saved for offline use', typeof saved === 'number', JSON.stringify(saved).slice(0, 200));

// Now: no internet at all. (Request interception bypasses service workers in
// Chromium, so switch our fake chess.com off first — real users never have it.)
await ctx.unrouteAll({ behavior: 'ignoreErrors' });
await ctx.setOffline(true);
const ctrl = await page.evaluate(() => !!navigator.serviceWorker.controller);
if (process.env.DEBUG) {
  page.on('requestfailed', (r) => console.log('  failed:', r.url().replace(/^https?:\/\/[^/]+/, ''), r.failure()?.errorText));
  page.on('console', (m) => m.type() === 'error' && console.log('  console:', m.text().slice(0, 160)));
}
let reloadErr = '';
await page.reload().catch((e) => (reloadErr = e.message.split('\n')[0]));
if (process.env.DEBUG) console.log('controlled before reload:', ctrl, '| reload error:', reloadErr, '| body:', (await page.content().catch(() => '')).slice(0, 200));
const loaded = await page.waitForSelector('.topbar', { timeout: 15000 }).then(() => true).catch(() => false);
check('the app opens with no internet', loaded);
await page.goto(`http://localhost:${port}/#/train`);
const puzzle = await page.waitForSelector('.trainer .case-head h2', { timeout: 15000 }).then(() => true).catch(() => false);
check('puzzles from analyzed games open offline', puzzle);
const engineOk = !!(await waitStep(page, (s) => !!s.best, 60000));
check('Stockfish works offline', engineOk);
await page.goto(`http://localhost:${port}/#/dashboard`);
await page.waitForTimeout(3000);
const toasts = await page.$$eval('.toast', (t) => t.map((x) => x.textContent).join(' | '));
check('dashboard explains it is offline (no scary error)', !/Failed to fetch|TypeError/.test(toasts), toasts || '(no message needed)');
check('no page errors offline', errors.length === 0, errors.join(' | '));

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
try {
  process.kill(-server.pid);
} catch {}
process.exit(results.every(Boolean) ? 0 : 1);
