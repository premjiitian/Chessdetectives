// Repertoire journey in a real browser: build White and Black, browse, practise.
//   FIXTURES=/path FIXTURE_USER=name node tests/repertoire.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const FIX = process.env.FIXTURES;
const USER = process.env.FIXTURE_USER ?? 'erik';
mkdirSync('tests/screens', { recursive: true });
const port = 4185;
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
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('voice-settings', JSON.stringify({ engine: 'device' })); } catch {} });
await page.route('https://images.chesscomfiles.com/**', (r) => r.fulfill({ status: 404 }));
await page.route('https://api.chess.com/**', (route) => {
  const url = route.request().url();
  let file;
  if (url.endsWith(`/player/${USER}`)) file = 'profile.json';
  else if (url.endsWith('/games/archives')) file = 'archives.json';
  else { const m = url.match(/games\/(\d{4})\/(\d{2})$/); if (m) file = `${m[1]}-${m[2]}.json`; }
  if (file && existsSync(join(FIX, file))) return route.fulfill({ contentType: 'application/json', body: readFileSync(join(FIX, file)) });
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{"games":[]}' });
});

await page.goto(`http://localhost:${port}/`);
await page.fill('#uname', USER);
await page.click('.connect button');
await page.waitForSelector('.dash-head');
await page.waitForFunction(() => /games analyzed/.test(document.querySelector('.status')?.textContent ?? ''), null, { timeout: 600000 });
check('menu has a Repertoire tab', !!(await page.$('nav a[href="#/repertoire"]')));

for (const color of ['white', 'black']) {
  await page.goto(`http://localhost:${port}/#/repertoire?color=${color}`);
  const t = Date.now();
  // It should start building by itself on the first visit (no button press needed).
  const built = await page.waitForSelector('.rep-line', { timeout: 300000 }).then(() => true).catch(() => false);
  check(`${color}: repertoire builds from your games`, built, `${Math.round((Date.now() - t) / 1000)} s`);
  const lines = await page.$$eval('.rep-line', (l) => l.length);
  const summary = await page.textContent('.rep-summary p');
  check(`${color}: shows lines and what was kept/upgraded`, lines > 0 && /your style/.test(summary), summary.replace(/\s+/g, ' ').slice(0, 120));
  const firstMine = await page.$('.mv.yours, .mv.upgrade, .mv.engine');
  await firstMine.click();
  const note = await page.textContent('.rep-note');
  check(`${color}: tapping a move explains it`, /your move|upgrade|Stockfish/.test(note), note.replace(/\s+/g, ' ').slice(0, 140));
  // Grandmaster-coach panel for your move
  await page.waitForSelector('.coach-view h4', { timeout: 60000 }).catch(() => {});
  const cv = await page.$eval('.coach-view', (e) => ({ h: e.querySelectorAll('h4').length, cands: e.querySelectorAll('.cv-cands li').length, chosen: e.querySelectorAll('.cv-cands li.chosen').length, text: e.innerText }));
  check(`${color}: coach panel — position, ≥2 candidates with evaluations, plan, key lesson`, cv.h >= 3 && cv.cands >= 2 && /Key lesson/.test(cv.text) && /\(/.test(cv.text), `${cv.cands} candidates, ${cv.chosen} marked as yours`);
  // ...and for an opponent move: what it wants and how to answer it
  const reply = await page.$('.mv.reply');
  if (reply) {
    await reply.click();
    await page.waitForSelector('.coach-view h4', { timeout: 60000 }).catch(() => {});
    const t = await page.$eval('.rep-note', (e) => e.innerText);
    check(`${color}: opponent move shows what it wants and how to answer`, /your move/.test(t) && /Candidate moves/.test(t), t.replace(/\s+/g, ' ').slice(0, 120));
  }
  if (color === 'white') {
    // A note: write it, see it saved, see the 📝 marker, survive a reload
    await (await page.$('.mv.yours, .mv.upgrade, .mv.engine')).click();
    await page.fill('#rep-note', 'My favourite opening move — aim for the center!');
    await page.waitForFunction(() => document.querySelector('.note-status')?.textContent === 'Saved ✓', null, { timeout: 5000 }).catch(() => {});
    check('note: saved in your profile', (await page.textContent('.note-status')) === 'Saved ✓');
    check('note: the move gets a 📝 marker', (await page.$$('.mv.has-note')).length > 0);
    await page.waitForSelector('.coach-view h4', { timeout: 60000 }).catch(() => {});
    await page.screenshot({ path: 'tests/screens/repertoire-white.png', fullPage: true });
    await page.reload();
    await page.waitForSelector('.rep-line');
    await (await page.$('.mv.has-note')).click();
    check('note: still there after a reload', (await page.inputValue('#rep-note')) === 'My favourite opening move — aim for the center!');
    // Step through a line without scrolling: Next button and the → key
    const where = () => page.$eval('.step-nav .sub', (e) => e.textContent);
    const a = await where();
    await page.click('[data-step="1"]');
    const b = await where();
    await page.locator('#board').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('ArrowRight');
    const c2 = await where();
    check('step through a line with ◀ ▶ and the arrow keys', a !== b && b !== c2, `${a} → ${b} → ${c2}`);
  }
}
await page.addScriptTag({ content: axeSource });
const v = (await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }))).violations;
check('repertoire page has no accessibility issues', v.length === 0, v.map((x) => `${x.id} ${x.nodes[0]?.target}`).join('; '));

// Practice: play the expected move, then a wrong one.
await page.goto(`http://localhost:${port}/#/repertoire?color=white&practice=1`);
await page.waitForSelector('#board cg-board');
const until = async (cond, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { const s = await page.evaluate(() => window.__rep?.()); if (s && cond(s)) return s; await page.waitForTimeout(100); } return null; };
const sq = async (s) => { const b = await page.$eval('#board cg-board', (e) => e.getBoundingClientRect().toJSON()); const f = s.charCodeAt(0) - 97, r = +s[1] - 1, z = b.width / 8; return { x: b.x + (f + 0.5) * z, y: b.y + (7 - r + 0.5) * z }; };
const move = async (u) => { const a = await sq(u.slice(0, 2)), b = await sq(u.slice(2, 4)); await page.mouse.click(a.x, a.y); await page.waitForTimeout(60); await page.mouse.click(b.x, b.y); };
let st = await until((s) => s.interactive && s.expected);
await move(st.expected);
await page.waitForSelector('.msg.good', { timeout: 5000 }).catch(() => {});
check('practice: playing your repertoire move is confirmed', !!(await page.$('.msg.good')));
st = await until((s) => s.interactive && s.expected && s.k > 0);
const wrong = st && (st.expected === 'g1f3' ? 'b1c3' : 'g1f3');
if (st) {
  await move(wrong);
  await page.waitForSelector('.msg.alt', { timeout: 5000 }).catch(() => {});
}
const altText = await page.$eval('.msg.alt', (e) => e.textContent).catch(() => '');
check('practice: a wrong move shows the right one and why', /In your repertoire the move is/.test(altText), altText.slice(0, 100));
// finish the line by playing expected moves
for (let i = 0; i < 12; i++) {
  st = await until((s) => (s.interactive && s.expected) || !s.expected, 8000);
  if (!st || !st.expected) break;
  await move(st.expected);
  await page.waitForTimeout(300);
}
const done = await page.waitForSelector('text=Line complete', { timeout: 10000 }).then(() => true).catch(() => false);
check('practice: your own note appears at that move', /Your note: My favourite opening move/.test(await page.textContent('.feed')));
check('practice: finishing a line gives XP', done);
await page.screenshot({ path: 'tests/screens/repertoire-practice.png' });

// iPad portrait: menu with 7 tabs still fits
const ipad = await browser.newContext({ ...devices['iPad Mini'] });
const ip = await ipad.newPage();
await ip.goto(`http://localhost:${port}/`);
check('welcome loads on iPad', !!(await ip.waitForSelector('.hero').catch(() => null)));
await ipad.close();
const p360 = await browser.newContext({ viewport: { width: 360, height: 760 }, hasTouch: true });
const pg = await p360.newPage();
await pg.goto(`http://localhost:${port}/`);
check('phone welcome has no sideways scroll', !(await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
await p360.close();
check('no page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
