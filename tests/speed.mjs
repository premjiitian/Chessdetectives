// Speed + "can't move the pieces" check, like a quick kid on an iPad.
// CPU slowed down 4× (roughly an iPad), background analysis running.
//   FIXTURES=/path FIXTURE_USER=name node tests/speed.mjs
// Prints timings and fails on: board out of sync with the game, a legal
// move refused when it is your turn, or timings over budget.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');

const FIX = process.env.FIXTURES;
const USER = process.env.FIXTURE_USER ?? 'erik';
const SLOW = Number(process.env.CPU_SLOWDOWN ?? 4);
const port = 4197;
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
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);
const max = (a) => (a.length ? Math.max(...a) : NaN);

const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOW });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => {
  try { localStorage.setItem('voice-settings', JSON.stringify({ engine: 'device' })); } catch {}
  // Measured inside the page: finger lifted → your move shows up in the coach panel.
  window.__reactions = [];
  let up = 0;
  addEventListener('mouseup', () => (up = performance.now()), true);
  addEventListener('touchend', () => (up = performance.now()), true);
  new MutationObserver((list) => {
    for (const r of list) for (const n of r.addedNodes) if (n.classList?.contains('you') && up) { window.__reactions.push(Math.round(performance.now() - up)); up = 0; }
  }).observe(document, { childList: true, subtree: true });
});
await page.route('https://images.chesscomfiles.com/**', (r) => r.fulfill({ status: 404 }));
await page.route('https://i.ytimg.com/**', (r) => r.fulfill({ status: 404 }));
await page.route('https://api.chess.com/**', (route) => {
  const url = route.request().url();
  let file;
  if (url.endsWith(`/player/${USER}`)) file = 'profile.json';
  else if (url.endsWith('/games/archives')) file = 'archives.json';
  else { const m = url.match(/games\/(\d{4})\/(\d{2})$/); if (m) file = `${m[1]}-${m[2]}.json`; }
  if (file && existsSync(join(FIX, file))) return route.fulfill({ contentType: 'application/json', body: readFileSync(join(FIX, file)) });
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{"games":[]}' });
});

// ---- 1. Opening the app ----
let t = Date.now();
await page.goto(`http://localhost:${port}/`);
await page.waitForSelector('#uname');
const openMs = Date.now() - t;
const jsKb = await page.evaluate(() => Math.round(performance.getEntriesByType('resource').filter((e) => /\.js$/.test(e.name)).reduce((s, e) => s + (e.transferSize || e.encodedBodySize || 0), 0) / 1024));
console.log(`open app: ${openMs} ms · JavaScript ${jsKb} KB`);

// ---- 2. Connect: until the first games are ready to train ----
await page.fill('#uname', USER);
t = Date.now();
await page.click('.connect button');
await page.waitForSelector('.dash-head');
await page.waitForFunction(() => /Start training/.test(document.querySelector('.cta')?.textContent ?? ''), null, { timeout: 300000 });
const firstPuzzleReadyMs = Date.now() - t;
console.log(`connect → first puzzles ready: ${firstPuzzleReadyMs} ms (analysis keeps running in the background)`);

// helpers on the live board
const boardState = () => page.evaluate(() => {
  const b = window.__cdBoard;
  if (!b) return null;
  return { sync: b.inSync(), fen: b.chess.fen(), legal: b.chess.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? '')), movable: b.cg.state.movable.color ?? null, turn: b.chess.turn() === 'w' ? 'white' : 'black', orientation: b.cg.state.orientation };
});
const sq = async (s, orientation) => {
  const box = await page.$eval('#board cg-board', (e) => e.getBoundingClientRect().toJSON());
  const f = s.charCodeAt(0) - 97, r = +s[1] - 1, z = box.width / 8;
  return { x: box.x + ((orientation === 'white' ? f : 7 - f) + 0.5) * z, y: box.y + ((orientation === 'white' ? 7 - r : r) + 0.5) * z };
};
/** A kid drags a piece (pointer down, move, up) — the way most kids move on an iPad. */
const drag = async (uci, orientation) => {
  const a = await sq(uci.slice(0, 2), orientation), b = await sq(uci.slice(2, 4), orientation);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 3 });
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.mouse.up();
};
const waitFor = async (fn, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await page.waitForTimeout(50);
  }
  return null;
};

// ---- 3. Puzzles, played by an impatient kid ----
const boardShown = [], playable = [], verdict = [], desync = [], refused = [], stuck = [], firstReaction = [];
await page.goto(`http://localhost:${port}/#/train`);
for (let puzzle = 0; puzzle < 5; puzzle++) {
  t = Date.now();
  const first = await waitFor(async () => (await page.$('#board cg-board')) && (await boardState()), 20000);
  if (!first) {
    stuck.push(`puzzle ${puzzle + 1}: no board after "Next" — ${page.url().split('#')[1]} | ${(await page.$eval('main', (e) => e.innerText).catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)}`);
    break;
  }
  boardShown.push(Date.now() - t);
  // The kid does not wait: as soon as the board is there and it is their turn, they move.
  const ready = await waitFor(async () => { const s = await boardState(); return s && s.movable === s.turn && s.legal.length ? s : null; }, 60000);
  playable.push(Date.now() - t);
  if (!ready) { refused.push(`puzzle ${puzzle + 1}: never playable`); break; }
  const mv = ready.legal[Math.floor(ready.legal.length / 2)];
  const before = ready.fen;
  const tm = Date.now();
  await drag(mv, ready.orientation);
  await page.waitForTimeout(150);
  const after = await boardState();
  if (after && !after.sync) desync.push(`puzzle ${puzzle + 1}: screen differs from game after ${mv}`);
  if (after && after.fen === before) {
    refused.push(`puzzle ${puzzle + 1}: ${mv} not taken while it was your turn`);
    if (process.env.DEBUG) console.log('DEBUG', JSON.stringify(await page.evaluate((mv) => {
      const b = window.__cdBoard; const st = b.cg.state;
      return { mv, dests: [...(st.movable.dests?.get(mv.slice(0, 2)) ?? [])], movable: st.movable.color, turnColor: st.turnColor, viewOnly: st.viewOnly, draggable: st.draggable.enabled, selected: st.selected, step: null, cgFen: b.cg.getFen(), fen: b.chess.fen(), sameBoard: document.querySelector('#board cg-board') !== null };
    }, mv)), JSON.stringify(await page.evaluate(() => window.__cdStep?.())).slice(0, 300));
  }
  // Something must happen on screen at once (not a frozen board).
  const seen = await waitFor(() => page.evaluate(() => !!document.querySelector('.feed .msg.you:not(.old)')), 2000);
  firstReaction.push(seen ? Date.now() - tm : 2000);
  // How long until Professor Pin reacts?
  const said = await waitFor(() => page.evaluate(() => !!document.querySelector('.feed .msg.good, .feed .msg.bad, .feed .msg.alt')), 60000);
  verdict.push(said ? Date.now() - tm : 60000);
  // Impatient again: try another move right away (during the explanation / Stockfish reply).
  const mid = await boardState();
  if (mid && mid.legal.length) {
    await drag(mid.legal[0], mid.orientation);
    await page.waitForTimeout(200);
    const s2 = await boardState();
    if (s2 && !s2.sync) desync.push(`puzzle ${puzzle + 1}: screen differs from game after a quick second move`);
  }
  // Settle, then go to the next case (show the solution if still open).
  await page.waitForTimeout(2500);
  const s3 = await boardState();
  if (s3 && !s3.sync) desync.push(`puzzle ${puzzle + 1}: screen still differs after settling`);
  if (await page.$('[data-act=solution]:not([hidden])')) await page.click('[data-act=solution]').catch(() => {});
  await page.waitForSelector('.stamp', { timeout: 60000 }).catch(() => {});
  const next = await page.$('[data-act=next]:not([hidden])');
  if (!next) {
    stuck.push(`puzzle ${puzzle + 1}: could not reach the next case — ${JSON.stringify(await page.evaluate(() => window.__cdStep?.())).slice(0, 160)} | feed: ${(await page.$eval('.feed', (e) => e.innerText).catch(() => '')).replace(/\s+/g, ' ').slice(-160)}`);
    break;
  }
  await next.click();
  await page.waitForTimeout(100);
}
console.log(`first reaction to a move: max ${max(firstReaction)} ms`);
console.log(`puzzle board shown: median ${median(boardShown)} ms · playable: median ${median(playable)} ms, max ${max(playable)} ms · coach reacts: median ${median(verdict)} ms, max ${max(verdict)} ms`);

// ---- 4. Spar vs Stockfish, impatient ----
const replies = [];
await page.goto(`http://localhost:${port}/#/play`);
await page.waitForSelector('#board cg-board');
for (let k = 0; k < 4; k++) {
  const s = await waitFor(async () => { const x = await boardState(); return x && x.movable === x.turn && x.legal.length ? x : null; }, 60000);
  if (!s) { refused.push(`spar move ${k + 1}: board never playable`); break; }
  const tm = Date.now();
  await drag(s.legal[k % s.legal.length], s.orientation);
  await page.waitForTimeout(120);
  const a = await boardState();
  if (a && !a.sync) desync.push(`spar move ${k + 1}: screen differs from game`);
  if (a && a.fen === s.fen) refused.push(`spar move ${k + 1}: move not taken on your turn`);
  // impatient: move again before Stockfish answered
  if (a && a.legal.length) {
    await drag(a.legal[0], a.orientation);
    await page.waitForTimeout(150);
    const b = await boardState();
    if (b && !b.sync) desync.push(`spar move ${k + 1}: screen differs after moving during Stockfish's turn`);
  }
  const back = await waitFor(async () => { const x = await boardState(); return x && x.turn === s.turn && x.fen !== s.fen ? x : null; }, 60000);
  replies.push(back ? Date.now() - tm : 60000);
}
console.log(`spar: Stockfish answers in median ${median(replies)} ms, max ${max(replies)} ms`);

// ---- verdicts ----
check('the board on screen always matches the game (no stuck/ghost pieces)', desync.length === 0, desync.slice(0, 3).join(' | '));
check('a whole session can be played: 5 puzzles in a row', boardShown.length >= 5 && stuck.length === 0, `${boardShown.length} puzzles · ${stuck.join(' | ')}`);
check('a legal move on your turn is always taken', refused.length === 0, refused.slice(0, 3).join(' | '));
check(`app opens fast (≤ ${2500 * SLOW / 4} ms at ${SLOW}× slower CPU)`, openMs <= 2500 * SLOW / 4, `${openMs} ms`);
check('puzzle is playable quickly (median ≤ 1.5 s)', median(playable) <= 1500, `${median(playable)} ms`);
const inPage = await page.evaluate(() => window.__reactions ?? []).catch(() => []);
check('every move gets an instant reaction on screen (≤ 100 ms, measured in the page)', inPage.length >= 3 && max(inPage) <= 100, `${inPage.length} moves · max ${max(inPage)} ms`);
check('Professor Pin reacts quickly to a move (median ≤ 2.5 s)', median(verdict) <= 2500, `${median(verdict)} ms`);
check('Stockfish answers in Spar quickly (median ≤ 3 s)', median(replies) <= 3000, `${median(replies)} ms`);
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
