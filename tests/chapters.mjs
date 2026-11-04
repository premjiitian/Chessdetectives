// Loop 6: the Chapters (video course) journey in a real browser.
//   FIXTURES=/path FIXTURE_USER=name node tests/chapters.mjs
import { createRequire } from 'node:module';
import { waitStep } from './helpers.mjs';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const FIX = process.env.FIXTURES;
const USER = process.env.FIXTURE_USER ?? 'erik';
const OUT = 'tests/screens';
mkdirSync(OUT, { recursive: true });
const port = 4193;
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'pipe', detached: true });
// cleanup-guard: always stop the preview server, even on failure or timeout
const killServer = () => { try { process.kill(-server.pid); } catch {} };
process.on('exit', killServer);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { killServer(); process.exit(1); });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('Local') && r()));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => {
  try {
    localStorage.setItem('voice-settings', JSON.stringify({ engine: 'device' }));
  } catch {}
});
await page.route('https://images.chesscomfiles.com/**', (r) => r.fulfill({ status: 404 }));
// Keep the test offline-friendly: stub the YouTube player itself.
await page.route('https://www.youtube-nocookie.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<html><body style="background:#000;color:#fff">player</body></html>' }));
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

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
};
const axe = async (name) => {
  await page.addScriptTag({ content: axeSource });
  const v = (await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }))).violations;
  check(`${name} has no accessibility issues`, v.length === 0, v.map((x) => `${x.id} (${x.nodes.length}×) ${x.nodes[0]?.target.join(' ')}`).join('; '));
};

await page.goto(`http://localhost:${port}/`);
await page.fill('#uname', USER);
await page.click('.connect button');
await page.waitForSelector('.dash-head');
await page.waitForFunction(() => /games analyzed/.test(document.querySelector('.status')?.textContent ?? '') && !document.querySelector('.status .spin'), null, { timeout: 600000 });
const dashRec = await page.$eval('.rec-mini', (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
check('dashboard recommends a chapter', /Watch Ep \d+/.test(dashRec), dashRec.slice(0, 120));

await page.click('nav a[href="#/chapters"]');
await page.waitForSelector('.chapter-grid');
const count = await page.$$eval('a.chapter', (a) => a.length);
check('all 20 chapters are listed', count === 20, `${count}`);
const withPractice = await page.$$eval('.ch-practice.has', (a) => a.length);
check('chapters show practice positions from your games', withPractice > 0, `${withPractice} chapters have practice`);
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/20-chapters.png` });
await axe('chapters list');

await page.click('a.rec');
await page.waitForSelector('.chapter-page');
const title = await page.textContent('.ch-info h1');
await page.click('.video-poster');
const src = await page.$eval('.video iframe', (f) => f.src).catch(() => '');
check('video loads only after pressing play (privacy-friendly player)', /youtube-nocookie\.com\/embed\/[\w-]{11}/.test(src), src.slice(0, 80));
await page.click('[data-watched]');
await page.waitForTimeout(400);
check('marking as watched gives XP and sticks', await page.$eval('[data-watched]', (b) => b.disabled && /Watched/.test(b.textContent)));
await page.screenshot({ path: `${OUT}/21-chapter.png`, fullPage: true });
await axe('chapter page');

const startBtn = await page.$('a[href^="#/train?chapter="]');
check('chapter offers practice from your games', !!startBtn, title);
if (startBtn) {
  await startBtn.click();
  await page.waitForSelector('.trainer .case-head h2');
  check('practice session says which chapter it is', /Chapter \d+ practice/.test(await page.textContent('.case-no')));
  await waitStep(page, (s) => s.interactive, 60000);
  await page.waitForTimeout(3000);
  await page.click('[data-act=solution]');
  await page.waitForSelector('.stamp', { timeout: 60000 }).catch(() => {});
  const learn = await page.$eval('.learn-more', (a) => a.textContent.trim()).catch(() => '');
  check('after a puzzle Professor Pin links the matching video', /Learn more: Ep \d+/.test(learn), learn);
}

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`http://localhost:${port}/#/chapters/8`);
await page.waitForTimeout(800);
check('chapter page fits a phone (no sideways scroll)', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
await page.screenshot({ path: `${OUT}/22-chapter-mobile.png`, fullPage: true });
check('no page errors', errors.length === 0, errors.join(' | '));

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
try {
  process.kill(-server.pid);
} catch {}
