// Importing games from chess.com must never end in a silent "0 of 0 games".
// Owner report: "web version is not able to import games for chess.com".
// Found: accounts with no games in the last 30/120 days showed "✅ 0 of 0".
//   FIXTURES=/path FIXTURE_USER=name node tests/import.mjs
// Builds test accounts from the saved games:
//   sleepy    – last game ~13 months ago (plays rarely)
//   dailyonly – only daily games, but "Only rapid, blitz and bullet" ticked
//   newbie    – a chess.com account without any games
//   <user>    – a normal, active account (must stay unchanged)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const axe = async (page, name) => {
  await page.addScriptTag({ content: axeSource });
  const v = (await page.evaluate(() => window.axe.run(document.querySelector('.status'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }))).violations;
  check(`${name} has no accessibility issues`, v.length === 0, v.map((x) => `${x.id} ${x.nodes[0]?.target}`).join('; '));
};

const FIX = process.env.FIXTURES;
const USER = (process.env.FIXTURE_USER ?? 'erik').toLowerCase();
const port = 4196;
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

// ---- test accounts built from the saved games ----
const months = readdirSync(FIX).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).sort();
const allGames = months.flatMap((f) => JSON.parse(readFileSync(join(FIX, f), 'utf8')).games);
const profile = JSON.parse(readFileSync(join(FIX, 'profile.json'), 'utf8'));
const DAY = 86400;
/** Copies games so the newest ended `daysAgo` days ago, played by `name`. */
function account(name, daysAgo, filter = () => true) {
  const games = allGames.filter(filter).map((g) => JSON.parse(JSON.stringify(g)));
  const newest = Math.max(...games.map((g) => g.end_time));
  const shift = Math.floor(Date.now() / 1000) - daysAgo * DAY - newest;
  const byMonth = {};
  for (const g of games) {
    g.end_time += shift;
    for (const side of ['white', 'black']) if (g[side].username.toLowerCase() === USER) g[side].username = name;
    g.url = `${g.url}-${name}`;
    const d = new Date(g.end_time * 1000);
    const key = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    (byMonth[key] ??= []).push(g);
  }
  return byMonth;
}
const ACCOUNTS = {
  sleepy: account('sleepy', 395),
  dailyonly: account('dailyonly', 2, (g) => g.time_class === 'daily'),
  newbie: {},
};

async function open(name, { liveOnly = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('voice-settings', JSON.stringify({ engine: 'device' })); } catch {} });
  await page.route('https://images.chesscomfiles.com/**', (r) => r.fulfill({ status: 404 }));
  await page.route('https://api.chess.com/**', (route) => {
    const url = route.request().url();
    const json = (body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    const acc = ACCOUNTS[name];
    if (!acc) {
      // the normal account: the saved files as they are
      let file;
      if (/\/player\/[^/]+$/.test(url)) file = 'profile.json';
      else if (url.endsWith('/games/archives')) file = 'archives.json';
      else { const m = url.match(/games\/(\d{4})\/(\d{2})$/); if (m) file = `${m[1]}-${m[2]}.json`; }
      try { return route.fulfill({ contentType: 'application/json', body: readFileSync(join(FIX, file)) }); } catch { return json({ games: [] }); }
    }
    if (/\/player\/[^/]+$/.test(url)) return json({ ...profile, username: name, name: name });
    if (url.endsWith('/games/archives')) return json({ archives: Object.keys(acc).sort().map((k) => `https://api.chess.com/pub/player/${name}/games/${k}`) });
    const m = url.match(/games\/(\d{4}\/\d{2})$/);
    return json({ games: (m && acc[m[1]]) || [] });
  });
  await page.goto(`http://localhost:${port}/`);
  await page.fill('#uname', name);
  if (liveOnly) await page.check('.live-only input');
  await page.click('.connect button');
  await page.waitForSelector('.dash-head');
  return { ctx, page };
}
/** Waits until the dashboard has settled: not downloading, not analysing. */
const settle = async (page, ms = 240000) => {
  const end = Date.now() + ms;
  await page.waitForTimeout(1500);
  while (Date.now() < end) {
    const busy = await page.evaluate(() => !!document.querySelector('.status .spin'));
    if (!busy) return;
    await page.waitForTimeout(1000);
  }
};
const statusText = (page) => page.$eval('.status', (e) => e.innerText.replace(/\s+/g, ' ').trim());
const zeroOfZero = (t) => /\b0 of 0 games/.test(t);

// 1) Plays rarely: last game ~13 months ago
{
  const { ctx, page } = await open('sleepy');
  await settle(page);
  const t = await statusText(page);
  const games = await page.evaluate(() => document.querySelectorAll('.status').length && Number((document.querySelector('.status')?.textContent ?? '').match(/of (\d+) games/)?.[1] ?? 0));
  const expected = Object.values(ACCOUNTS.sleepy).flat().filter((g) => g.rules === 'chess').length;
  check('rare player: all their games are imported (not "0 of 0", not just the last one)', !zeroOfZero(t) && games >= expected - 2, `${games} of ${expected} games · ${t.slice(0, 60)}`);
  const period = await page.$eval('.tabs [role=tab].on', (e) => e.textContent);
  check('rare player: the period widens to include the last game', /year/.test(period), period);
  check('rare player: it says when the last game was', /last game/i.test(await page.textContent('main')), (await page.$eval('.status', (e) => e.innerText)).slice(0, 140));
  check('no page errors (rare player)', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}

// 2) Only daily games, but "only rapid, blitz and bullet" ticked
{
  const { ctx, page } = await open('dailyonly', { liveOnly: true });
  await settle(page);
  const t = await statusText(page);
  check('filtered out: explains the game-type filter instead of "0 of 0"', !zeroOfZero(t) && /daily/i.test(t), t.slice(0, 140));
  const head = await page.$eval('.headline', (e) => e.textContent);
  const cta = await page.$eval('.cta', (e) => e.textContent.replace(/\s+/g, ' '));
  check('the page does not contradict itself (headline + case files agree games exist)', !/No games in this period/.test(head) && !/Press .Analyze. above/.test(cta), `${head.slice(0, 70)} | ${cta.slice(0, 80)}`);
  await axe(page, 'game-type explanation');
  await page.screenshot({ path: 'tests/screens/import-filtered.png' });
  const fix = await page.$('.status [data-all]');
  check('filtered out: one tap shows all game types', !!fix);
  if (fix) {
    await fix.click();
    await page.waitForTimeout(800);
    const t2 = await statusText(page);
    // Either listed ("13 of 13 games") or already being analysed ("game 1 of 13").
    check('after the tap the games are there', /of [1-9]\d* games|investigating game \d+ of [1-9]/.test(t2), t2.slice(0, 100));
  }
  await ctx.close();
}

// 3) A chess.com account without any games
{
  const { ctx, page } = await open('newbie');
  await settle(page, 30000);
  const t = await statusText(page);
  await axe(page, '"no games yet" message');
  check('no games at all: says so plainly', !zeroOfZero(t) && /no (standard )?games|hasn.t played|play a few/i.test(t), t.slice(0, 140));
  await ctx.close();
}

// 4) A normal active account: unchanged (30 days, games imported)
{
  const { ctx, page } = await open(USER);
  await settle(page);
  const period = await page.$eval('.tabs [role=tab].on', (e) => e.textContent);
  const t = await statusText(page);
  check('active player: stays on 30 days with games imported', /30 days/.test(period) && !zeroOfZero(t), `${period} · ${t.slice(0, 80)}`);
  check('no page errors (active player)', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
