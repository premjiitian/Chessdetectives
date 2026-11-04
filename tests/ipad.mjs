// Loop 8: iPad checks (touch, sizes, layout) using Playwright's iPad profiles.
// Note: this runs Chromium pretending to be an iPad. Real iPad Safari uses
// WebKit, so also do the short manual checklist in README → "iPad".
//   FIXTURES=/path FIXTURE_USER=name node tests/ipad.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const FIX = process.env.FIXTURES;
const USER = process.env.FIXTURE_USER ?? 'erik';
const OUT = 'tests/screens';
mkdirSync(OUT, { recursive: true });
const port = 4191;
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

const profiles = [
  ['iPad Pro 11 portrait', devices['iPad Pro 11']],
  ['iPad Pro 11 landscape', devices['iPad Pro 11 landscape']],
  ['iPad Mini portrait', devices['iPad Mini']],
  ['iPad (gen 7) landscape', devices['iPad (gen 7) landscape']],
];

for (const [label, dev] of profiles) {
  console.log(`\n== ${label} (${dev.viewport.width}×${dev.viewport.height})`);
  const ctx = await browser.newContext({ ...dev });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    try {
      localStorage.setItem('voice-settings', JSON.stringify({ engine: 'device' }));
    } catch {}
  });
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
    if (file && existsSync(join(FIX, file))) return route.fulfill({ contentType: 'application/json', body: readFileSync(join(FIX, file)) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"games":[]}' });
  });
  const slug = label.replace(/\W+/g, '-').toLowerCase();
  const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  await page.goto(`http://localhost:${port}/`);
  await page.waitForSelector('.hero');
  check('username box is 16px+ (Safari will not zoom in)', (await page.$eval('#uname', (e) => parseFloat(getComputedStyle(e).fontSize))) >= 16);
  check('welcome fits the screen', await noSideScroll());
  await page.tap('#uname');
  await page.fill('#uname', USER);
  await page.tap('.connect button');
  await page.waitForSelector('.dash-head');
  await page.waitForFunction(() => /games analyzed/.test(document.querySelector('.status')?.textContent ?? '') && !document.querySelector('.status .spin'), null, { timeout: 600000 });
  check('dashboard fits the screen', await noSideScroll());
  const nav = await page.$eval('.topbar nav', (n) => ({ fits: n.scrollWidth <= n.clientWidth + 1, wrapped: [...n.querySelectorAll('a')].some((a) => a.getBoundingClientRect().height > 70) }));
  check('top menu fits on one line', nav.fits && !nav.wrapped);
  await page.screenshot({ path: `${OUT}/ipad-${slug}-dashboard.png` });
  const small = await page.$$eval('.btn, .tabs button, .sp, select, .topbar nav a', (els) =>
    els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 43.5).map((e) => `${e.textContent.trim().slice(0, 18)} ${Math.round(e.getBoundingClientRect().height)}px`),
  );
  check('buttons are finger-sized (44px+)', small.length === 0, small.slice(0, 5).join(', '));

  await page.goto(`http://localhost:${port}/#/chapters`);
  await page.waitForSelector('.chapter-grid');
  check('chapters fit the screen', await noSideScroll());

  await page.goto(`http://localhost:${port}/#/train`);
  await page.waitForSelector('.trainer .case-head h2');
  await page.waitForTimeout(1500);
  const vh = dev.viewport.height;
  const board = await page.$eval('#board', (e) => e.getBoundingClientRect().toJSON());
  const hint = await page.$eval('[data-act=hint]', (e) => e.getBoundingClientRect().toJSON());
  check('whole board is visible without scrolling', board.bottom <= vh + 1 && board.top >= 0, `board ${Math.round(board.top)}–${Math.round(board.bottom)} of ${vh}px`);
  check('Hint button is visible next to the board', hint.bottom <= vh + 1, `hint at ${Math.round(hint.top)}px`);
  check('trainer fits the screen', await noSideScroll());

  // Tap-to-move: tap one of your pieces, then a legal square.
  // Poll properly (a returned Promise would count as "true" immediately).
  for (let i = 0; i < 300; i++) {
    const s = await page.evaluate(() => window.__cdStep?.());
    if (s?.interactive) break;
    await page.waitForTimeout(200);
  }
  const st = await page.evaluate(() => window.__cdStep());
  const color = (await page.evaluate(() => window.__cd())).color;
  const uci = st.legal[0];
  const box = await page.$eval('#board cg-board', (e) => e.getBoundingClientRect().toJSON());
  const at = (s) => {
    const f = s.charCodeAt(0) - 97;
    const r = +s[1] - 1;
    const size = box.width / 8;
    return { x: box.x + ((color === 'white' ? f : 7 - f) + 0.5) * size, y: box.y + ((color === 'white' ? 7 - r : r) + 0.5) * size };
  };
  const a = at(uci.slice(0, 2));
  const b = at(uci.slice(2, 4));
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.touchscreen.tap(a.x, a.y);
  await page.waitForTimeout(150);
  await page.touchscreen.tap(b.x, b.y);
  await page.waitForSelector('.msg.you', { timeout: 10000 }).catch(() => {});
  check('tap a piece, tap a square — the move is played', !!(await page.$('.msg.you')));
  check('tapping the board does not scroll the page', (await page.evaluate(() => window.scrollY)) === scrollBefore);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/ipad-${slug}-train.png` });
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
try {
  process.kill(-server.pid);
} catch {}
process.exit(results.every(Boolean) ? 0 : 1);
