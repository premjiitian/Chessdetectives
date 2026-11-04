// Loops 12-13: hostile data can't run code; progress survives reloads and private mode.
//   FIXTURES=/path FIXTURE_USER=name node tests/safety.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');

const FIX = process.env.FIXTURES;
const USER = process.env.FIXTURE_USER ?? 'erik';
const port = 4188;
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

const EVIL = `<img src=x onerror="window.__pwned=1">"><script>window.__pwned=1</script>`;
function poison(json) {
  const d = JSON.parse(json);
  for (const g of d.games ?? []) {
    const opp = g.white.username.toLowerCase() === USER ? g.black : g.white;
    opp.username = 'Evil' + EVIL;
    g.eco = 'https://www.chess.com/openings/' + encodeURIComponent('<svg onload=window.__pwned=1>') + '-Gambit';
    g.url = g.url + '?x=' + encodeURIComponent('"><img src=x onerror=window.__pwned=1>');
  }
  return JSON.stringify(d);
}

async function context({ evil = false, noIDB = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.dialogs = 0;
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => {
    page.dialogs++;
    d.dismiss();
  });
  await page.addInitScript((noIDB) => {
    try {
      localStorage.setItem('voice-settings', JSON.stringify({ engine: 'device' }));
    } catch {}
    if (noIDB) {
      // Like some private-browsing modes: IndexedDB refuses to open.
      Object.defineProperty(window, 'indexedDB', { value: { open() { throw new Error('blocked'); } } });
    }
  }, noIDB);
  await page.route('https://images.chesscomfiles.com/**', (r) => r.fulfill({ status: 404 }));
  await page.route('https://i.ytimg.com/**', (r) => r.fulfill({ status: 404 }));
  await page.route('https://api.chess.com/**', (route) => {
    const url = route.request().url();
    let file;
    if (url.endsWith(`/player/${USER}`)) file = 'profile.json';
    else if (url.endsWith('/games/archives')) file = 'archives.json';
    else {
      const m = url.match(/games\/(\d{4})\/(\d{2})$/);
      if (m) file = `${m[1]}-${m[2]}.json`;
    }
    if (file && existsSync(join(FIX, file))) {
      const body = readFileSync(join(FIX, file), 'utf8');
      return route.fulfill({ contentType: 'application/json', body: evil && /\d{4}-\d{2}/.test(file) ? poison(body) : body });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"games":[]}' });
  });
  return { ctx, page };
}

async function connectAndAnalyze(page) {
  await page.goto(`http://localhost:${port}/`);
  await page.fill('#uname', USER);
  await page.click('.connect button');
  await page.waitForSelector('.dash-head');
  await page.waitForFunction(() => /games analyzed/.test(document.querySelector('.status')?.textContent ?? '') && !document.querySelector('.status .spin'), null, { timeout: 600000 });
}

// Loop 12: poisoned chess.com data
{
  const { ctx, page } = await context({ evil: true });
  await connectAndAnalyze(page);
  for (const r of ['#/dashboard', '#/cases', '#/train', '#/chapters', '#/progress', '#/play']) {
    await page.goto(`http://localhost:${port}/${r}`);
    await page.waitForTimeout(1200);
  }
  const pwned = await page.evaluate(() => window.__pwned === 1);
  check('hostile opponent names, openings and links cannot run code', !pwned && page.dialogs === 0);
  await page.goto(`http://localhost:${port}/#/train`);
  await page.waitForTimeout(1500);
  const shown = await page.$eval('.flashback', (e) => e.textContent).catch(() => '');
  check('the hostile name is shown as plain text', shown.includes('Evil<img'), shown.slice(0, 80));
  const href = await page.$eval('[data-act=game]', (a) => a.getAttribute('href')).catch(() => '');
  check('game links stay on chess.com', /^https:\/\/www\.chess\.com\//.test(href), href.slice(0, 60));
  check('no page errors with hostile data', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}

// Loop 13a: progress survives a reload
{
  const { ctx, page } = await context();
  await connectAndAnalyze(page);
  await page.goto(`http://localhost:${port}/#/train`);
  await page.waitForSelector('.trainer .case-head h2');
  await page.waitForFunction(() => window.__cdStep && window.__cdStep().then((s) => s.interactive), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.click('[data-act=solution]');
  await page.waitForSelector('.stamp', { timeout: 60000 });
  const xpBefore = await page.$eval('.who .xp', (e) => e.textContent);
  await page.reload();
  await page.waitForSelector('.topbar');
  await page.waitForTimeout(800);
  const xpAfter = await page.$eval('.who .xp', (e) => e.textContent).catch(() => '');
  check('XP survives a page reload', xpBefore === xpAfter && /\d+ XP/.test(xpAfter), `${xpBefore} → ${xpAfter}`);
  await page.goto(`http://localhost:${port}/#/progress`);
  await page.waitForTimeout(600);
  check('XP history survives a reload', /XP history \(1 puzzle\)/.test(await page.textContent('main')));
  await ctx.close();
}

// Loop 13b: storage blocked (private mode) — the app must still work
{
  const { ctx, page } = await context({ noIDB: true });
  await connectAndAnalyze(page);
  await page.goto(`http://localhost:${port}/#/train`);
  const ok = await page.waitForSelector('.trainer .case-head h2', { timeout: 30000 }).then(() => true).catch(() => false);
  check('works when storage is blocked (private browsing)', ok);
  check('no page errors when storage is blocked', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
try {
  process.kill(-server.pid);
} catch {}
process.exit(results.every(Boolean) ? 0 : 1);
