// Checks the REAL published site with a REAL chess.com account (no mocks).
//   SITE=https://premjiitian.github.io/Chessdetectives/ CHESS_USER=erik node tests/live.mjs
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const SITE = process.env.SITE ?? 'https://premjiitian.github.io/Chessdetectives/';
const USER = process.env.CHESS_USER ?? 'erik';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
for (const [label, opts] of [
  ['desktop', { viewport: { width: 1300, height: 900 } }],
  ['iPad', devices['iPad Pro 11']],
]) {
  console.log(`\n== ${label}`);
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    try {
      localStorage.setItem('voice-settings', JSON.stringify({ engine: 'device' }));
    } catch {}
  });
  await page.goto(SITE);
  await page.waitForSelector('.hero', { timeout: 30000 });
  check('site loads', true);
  const manifest = await page.evaluate(async () => (await fetch('voice/pin/manifest.json')).json().then((m) => Object.keys(m).length).catch(() => 0));
  check("Professor Pin's voice clips are online", manifest >= 100, `${manifest} clips`);
  await page.fill('#uname', USER);
  await page.click('.connect button');
  await page.waitForSelector('.dash-head', { timeout: 30000 });
  await page.waitForFunction(() => { const m = (document.querySelector('.status')?.textContent ?? '').match(/(\d+) of (\d+) games analyzed/); return m && +m[1] >= 2; }, null, { timeout: 300000 }).catch(() => {});
  check('real chess.com games load and get analyzed', /games analyzed/.test(await page.textContent('.status')));
  check('game-type filter is there', (await page.$$('.sp')).length === 4);
  check('new menu has Chapters', !!(await page.$('nav a[href="#/chapters"]')));
  await page.goto(SITE + '#/chapters');
  await page.waitForSelector('.chapter-grid', { timeout: 15000 });
  check('all 20 chapters', (await page.$$('a.chapter')).length === 20);
  await page.goto(SITE + '#/train');
  const ok = await page.waitForSelector('.trainer .case-head h2', { timeout: 60000 }).then(() => true).catch(() => false);
  check('a puzzle from the real games opens', ok);
  const sw = await page.evaluate(async () => !!(await navigator.serviceWorker?.getRegistration()));
  check('offline support is installed', sw);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: `tests/screens/live-${label}.png` });
  await ctx.close();
}
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
