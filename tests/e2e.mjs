// End-to-end walkthrough in a real browser (Playwright + Chromium).
// chess.com is mocked with saved JSON files so the test is repeatable:
//   FIXTURES=/path/to/folder npm run e2e
// The folder needs archives.json, profile.json and YYYY-MM.json files.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // pre-installed or `npm i -D playwright`
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const FIX = process.env.FIXTURES;
const USER = process.env.FIXTURE_USER ?? 'erik';
const OUT = 'tests/screens';
mkdirSync(OUT, { recursive: true });
const port = 4199;
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'pipe', detached: true });
const stopServer = () => {
  try {
    process.kill(-server.pid);
  } catch {}
};
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('Local') && r()));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const page = await ctx.newPage();
// Headless Chromium has no voices: record what the voice coach would say.
await page.addInitScript(() => {
  window.__spoken = [];
  const fake = {
    speak: (u) => window.__spoken.push(u.text),
    cancel: () => {},
    getVoices: () => [{ name: 'Test Natural Voice', lang: 'en-US', voiceURI: 'test', localService: true }],
    addEventListener: () => {},
  };
  Object.defineProperty(window, 'speechSynthesis', { value: fake });
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('Failed to load resource') && errors.push(m.text()));

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
  if (url.includes('/games/')) return route.fulfill({ contentType: 'application/json', body: '{"games":[]}' });
  return route.fulfill({ status: 404, body: '{}' });
});
await page.route('https://images.chesscomfiles.com/**', (r) => r.fulfill({ status: 404 }));

const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const step = (s) => console.log('•', s);

step('welcome');
await page.goto(`http://localhost:${port}/`);
await page.waitForSelector('.hero');
await page.waitForTimeout(1500);
await shot('01-welcome');

step('connect');
await page.fill('#uname', USER);
await page.click('.connect button');
await page.waitForSelector('.dash-head');
await page.waitForFunction(() => /games analyzed/.test(document.querySelector('.status')?.textContent ?? '') && !document.querySelector('.status .spin'), null, { timeout: 240000 });
await shot('02-dashboard');
const kpis = await page.$$eval('.kpi .k-value', (els) => els.map((e) => e.textContent));
console.log('  KPIs', kpis.join(' | '));
console.log('  themes', (await page.$$eval('.themes li strong', (e) => e.map((x) => x.textContent))).join(', '));

step('period switch');
await page.click('[data-period="7d"]');
await page.waitForTimeout(500);
await shot('03-dashboard-7d');
await page.click('[data-period="90d"]');
await page.waitForTimeout(500);

step('train');
await page.click('a[href="#/train"]');
await page.waitForSelector('.trainer .case-head h2', { timeout: 20000 });
await page.waitForTimeout(2500);
await page.click('[data-v=toggle]');
await page.waitForTimeout(300);
await shot('04-train-start');
console.log('  flashback:', (await page.$eval('.flashback', (e) => e.innerText)).replace(/\n/g, ' | '));
const hiddenAtStart = await page.$$eval('.chip-reveal.shown', (e) => e.length);
await page.click('[data-reveal=difficulty]');
await page.waitForTimeout(300);
await page.locator('.case-head').screenshot({ path: `${OUT}/04b-difficulty-revealed.png` });
console.log('  tags revealed at start:', hiddenAtStart, '| difficulty:', await page.$eval('[data-reveal=difficulty] .chip-shown', (e) => e.textContent.trim()));

const sq = async (s, color) => {
  const box = await page.$eval('#board cg-board', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width };
  });
  const f = s.charCodeAt(0) - 97;
  const r = +s[1] - 1;
  const size = box.w / 8;
  const x = color === 'white' ? f : 7 - f;
  const y = color === 'white' ? 7 - r : r;
  return { x: box.x + (x + 0.5) * size, y: box.y + (y + 0.5) * size };
};
const move = async (uci, color) => {
  const a = await sq(uci.slice(0, 2), color);
  const b = await sq(uci.slice(2, 4), color);
  await page.mouse.click(a.x, a.y);
  await page.waitForTimeout(150);
  await page.mouse.click(b.x, b.y);
};
const current = await page.evaluate(() => window.__cd?.());
console.log('  case', JSON.stringify(current));
if (current) {
  step('play the game move (should be refuted)');
  await move(current.played, current.color);
  await page.waitForSelector('.msg.bad', { timeout: 30000 });
  await page.waitForTimeout(1200);
  await shot('05-train-wrong');
  await page.click('.msg.coach button:not(.replay)');
  step('hint x2');
  await page.click('[data-act=hint]');
  await page.click('[data-act=hint]');
  await page.click('[data-act=hint]');
  await page.waitForTimeout(400);
  await shot('06-train-hint');
  step('play best move');
  await move(current.best, current.color);
  await page.waitForSelector('.msg.good', { timeout: 30000 });
  await page.waitForTimeout(2500);
  await shot('07-train-correct');
  // Finish any continuation by asking for the solution.
  for (let i = 0; i < 5; i++) {
    if (await page.isVisible('[data-act=next]')) break;
    if (await page.isVisible('[data-act=solution]')) await page.click('[data-act=solution]').catch(() => {});
    await page.waitForTimeout(2500);
  }
  await page.waitForSelector('.stamp', { timeout: 30000 });
  await page.waitForTimeout(600);
  await shot('08-train-solved');
  const spoken = await page.evaluate(() => window.__spoken);
  console.log(`  voice coach spoke ${spoken.length} lines, e.g.:\n` + spoken.slice(0, 6).map((t) => '  🔊 ' + t).join('\n'));
  console.log('  tags revealed after solve:', await page.$$eval('.chip-reveal.shown', (e) => e.length));
  const feed = await page.$eval('.feed', (e) => e.innerText);
  console.log('  ---- coach feed ----\n' + feed.split('\n').filter(Boolean).map((l) => '  | ' + l).join('\n'));
}

step('cases');
await page.goto(`http://localhost:${port}/#/cases`);
await page.waitForTimeout(800);
await shot('09-cases');

step('spar');
await page.goto(`http://localhost:${port}/#/play`);
await page.waitForTimeout(1500);
await move('e2e4', 'white');
await page.waitForFunction(() => document.querySelectorAll('.movelist span:not(.no)').length >= 2, null, { timeout: 30000 });
await page.waitForTimeout(1500);
await shot('10-spar');

step('progress');
await page.goto(`http://localhost:${port}/#/progress`);
await page.waitForTimeout(600);
await shot('11-progress');

step('mobile');
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`http://localhost:${port}/#/dashboard`);
await page.waitForTimeout(800);
await shot('12-mobile-dash');
await page.goto(`http://localhost:${port}/#/train`);
await page.waitForTimeout(2000);
await shot('13-mobile-train');
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
console.log('  horizontal overflow on mobile:', overflow);

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'No console errors.');
await browser.close();
stopServer();
process.exit(errors.length ? 1 : 0);
