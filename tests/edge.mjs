// Loop 3: awkward real-life situations, checked in a real browser.
//   FIXTURES=/path FIXTURE_USER=name node tests/edge.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');

const FIX = process.env.FIXTURES;
const USER = process.env.FIXTURE_USER ?? 'erik';
const port = 4195;
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'pipe', detached: true });
// cleanup-guard: always stop the preview server, even on failure or timeout
const killServer = () => { try { process.kill(-server.pid); } catch {} };
process.on('exit', killServer);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { killServer(); process.exit(1); });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('Local') && r()));
const browser = await chromium.launch();
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

async function fresh(mode = 'fixtures') {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.addInitScript(() => {
    try {
      localStorage.setItem('voice-settings', JSON.stringify({ engine: 'device' }));
    } catch {}
  });
  await page.route('https://images.chesscomfiles.com/**', (r) => r.fulfill({ status: 404 }));
  await page.route('https://api.chess.com/**', (route) => {
    const url = route.request().url();
    if (mode === 'down') return route.fulfill({ status: 503, body: 'down' });
    if (mode === 'nogames') {
      if (url.endsWith('/games/archives')) return route.fulfill({ contentType: 'application/json', body: '{"archives":[]}' });
      if (/\/player\/[^/]+$/.test(url)) return route.fulfill({ contentType: 'application/json', body: '{"username":"newbie"}' });
    }
    let file;
    if (url.endsWith(`/player/${USER}`)) file = 'profile.json';
    else if (url.endsWith('/games/archives')) file = 'archives.json';
    else {
      const m = url.match(/games\/(\d{4})\/(\d{2})$/);
      if (m) file = `${m[1]}-${m[2]}.json`;
    }
    if (file && existsSync(join(FIX, file))) return route.fulfill({ contentType: 'application/json', body: readFileSync(join(FIX, file)) });
    const games = url.includes('/games/');
    return route.fulfill({ status: games ? 200 : 404, contentType: 'application/json', body: games ? '{"games":[]}' : '{}' });
  });
  await page.goto(`http://localhost:${port}/`);
  return { ctx, page };
}
const connect = async (page, name) => {
  await page.fill('#uname', name);
  await page.click('.connect button');
};

// 1. Unknown username
{
  const { ctx, page } = await fresh();
  await connect(page, 'this-user-does-not-exist-123');
  await page.waitForSelector('.err:not([hidden])', { timeout: 15000 }).catch(() => {});
  const msg = await page.$eval('.err', (e) => (e.hidden ? '' : e.textContent));
  check('unknown username shows a friendly error', /couldn.t find/i.test(msg), msg);
  check('button is usable again after the error', await page.$eval('.connect button', (b) => !b.disabled));
  await ctx.close();
}

// 2. chess.com down
{
  const { ctx, page } = await fresh('down');
  await connect(page, USER);
  await page.waitForSelector('.err:not([hidden])', { timeout: 30000 }).catch(() => {});
  const msg = await page.$eval('.err', (e) => (e.hidden ? '' : e.textContent));
  check('chess.com outage gives a clear message (not a crash)', msg.length > 10 && !/undefined|TypeError/.test(msg), msg);
  await ctx.close();
}

// 3. Player with no games
{
  const { ctx, page } = await fresh('nogames');
  await connect(page, 'newbie');
  await page.waitForSelector('.dash-head', { timeout: 15000 });
  await page.waitForTimeout(2500);
  const headline = await page.textContent('.headline');
  // Guidance stays on screen in the status box (it used to be a 6-second toast).
  const box = await page.$eval('.status', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  check('no-games player sees a helpful dashboard', /No games|play a few|find your games/i.test(headline) && !/\b0 of 0 games/.test(box), headline);
  check('no-games player gets guidance that stays on screen', /No games found on chess.com for newbie/i.test(box) && /play a few games/i.test(box), box.slice(0, 120));
  await page.goto(`http://localhost:${port}/#/train`);
  await page.waitForTimeout(800);
  check('train page explains there are no cases yet', /No cases yet|Analyze/i.test(await page.textContent('main')));
  check('no page errors for empty account', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}

// 4. Puzzle behaviours
{
  const { ctx, page } = await fresh();
  await connect(page, USER);
  await page.waitForFunction(
    () => /games analyzed/.test(document.querySelector('.status')?.textContent ?? '') && !document.querySelector('.status .spin'),
    null,
    { timeout: 600000 },
  );
  const sq = async (s, color) => {
    const box = await page.$eval('#board cg-board', (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width };
    });
    const f = s.charCodeAt(0) - 97;
    const r = +s[1] - 1;
    const size = box.w / 8;
    return { x: box.x + ((color === 'white' ? f : 7 - f) + 0.5) * size, y: box.y + ((color === 'white' ? 7 - r : r) + 0.5) * size };
  };
  const move = async (uci, color) => {
    const a = await sq(uci.slice(0, 2), color);
    const b = await sq(uci.slice(2, 4), color);
    await page.mouse.click(a.x, a.y);
    await page.waitForTimeout(80);
    await page.mouse.click(b.x, b.y);
  };
  const step = () => page.evaluate(() => window.__cdStep());
  const until = async (cond, ms = 60000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const s = await step();
      if (cond(s)) return s;
      await page.waitForTimeout(150);
    }
    return null;
  };

  await page.goto(`http://localhost:${port}/#/train`);
  await page.waitForSelector('.trainer .case-head h2');
  let st = await until((s) => s.interactive && s.lines.length >= 2);
  const color = (await page.evaluate(() => window.__cd())).color;
  const caseId = st.id;

  // a) a decent alternative (2nd or 3rd line, 3-10% worse than the best)
  const alt = st.lines.slice(1).find((l) => st.lines[0].win - l.win > 3 && st.lines[0].win - l.win <= 10);
  if (alt) {
    await move(alt.uci, color);
    await page.waitForSelector('.msg.alt', { timeout: 60000 }).catch(() => {});
    const t = await page.$eval('.feed', (e) => e.innerText);
    check('good alternative is praised but pushes for the best move', /reasonable idea/.test(t) && /stronger move|better/.test(t));
    st = await until((s) => s.interactive, 8000);
  } else {
    check('good alternative is praised but pushes for the best move', true, 'skipped: no near-best alternative in this case');
  }

  // b) a bad move
  const top = new Set(st.lines.map((l) => l.uci));
  // A move that is always bad here: the move from the actual game (that's why this puzzle exists).
  const gameMove = (await page.evaluate(() => window.__cd())).played;
  const barBefore = await page.$eval('.evalbar i', (e) => e.style.height);
  await move(gameMove, color);
  await page.waitForSelector('.msg.bad:not(.old)', { timeout: 60000 }).catch(() => {});
  const t2 = await page.$eval('.feed', (e) => e.innerText);
  const barAfter = await page.$eval('.evalbar i', (e) => e.style.height);
  check('bad move gets an explanation and Stockfish shows the punishment', /Not quite|move you played/.test(t2) && /answers/.test(t2));
  check('evaluation bar moves after a wrong move', barBefore !== barAfter, `${barBefore} → ${barAfter}`);
  const evalMsg = (t2.match(/📊 Evaluation:[^\n]*/) ?? [''])[0];
  check('Professor Pin states the evaluation before → after and explains why', /→/.test(evalMsg) && /Why\?/.test(t2), evalMsg);
  const t0 = Date.now();
  st = await until((s) => s.interactive && s.fen === st.fen, 8000);
  check('board resets by itself after a wrong move (no button needed)', !!st, `${Date.now() - t0} ms`);
  await page.waitForTimeout(300);
  check('evaluation bar returns after the reset', (await page.$eval('.evalbar i', (e) => e.style.height)) === barBefore);

  // Multitasking: wrong move, then tap the board during the replay and move again right away.
  await move(gameMove, color);
  await page.waitForSelector('.msg.bad:not(.old)', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(700);
  const box = await page.$eval('#board', (e) => e.getBoundingClientRect().toJSON());
  await page.mouse.click(box.x + 4, box.y + 4); // a tap while the punishment is shown
  const quick = await until((s) => s.interactive, 1500);
  check('tapping the board during the replay returns to the puzzle at once', !!quick);
  await move(gameMove, color);
  await page.waitForTimeout(300);
  const current = await page.$$eval('.feed .msg:not(.old)', (els) => els.map((e) => e.className));
  const old = await page.$$eval('.feed .msg.old', (els) => els.length);
  check('a new move fades the previous explanation', old > 0 && current.length <= 2, `${old} faded, ${current.length} current`);
  st = await until((s) => s.interactive, 15000);

  // c) all hints, then the solution
  for (let i = 0; i < 4; i++) await page.click('[data-act=hint]').catch(() => {});
  check('hint button runs out after 4 hints', await page.$eval('[data-act=hint]', (b) => b.disabled));
  await page.click('[data-act=solution]');
  await page.waitForSelector('.stamp', { timeout: 60000 }).catch(() => {});
  const stamp = await page.$eval('.stamp', (e) => e.textContent).catch(() => '');
  check('showing the solution marks the case to come back soon', /REOPENS/.test(stamp), stamp);
  check('both tags revealed after the case', (await page.$$('.chip-reveal.shown')).length === 2);

  // d) the failed case is due again in about 10 minutes
  const due = await page.evaluate(async (id) => {
    const db = await new Promise((r) => {
      const q = indexedDB.open('chess-detectives');
      q.onsuccess = () => r(q.result);
    });
    const get = (k) =>
      new Promise((r) => {
        const q = db.transaction('kv').objectStore('kv').get(k);
        q.onsuccess = () => r(q.result);
      });
    const keys = await new Promise((r) => {
      const q = db.transaction('kv').objectStore('kv').getAllKeys();
      q.onsuccess = () => r(q.result);
    });
    const p = await get(keys.find((x) => String(x).startsWith('progress:')));
    return p.cards[id] ? Math.round((p.cards[id].due - Date.now()) / 60000) : null;
  }, caseId);
  check('failed case is scheduled again in about 10 minutes', due !== null && due >= 8 && due <= 10, `${due} min`);

  // e) leave and come back
  await page.goto(`http://localhost:${port}/#/play`);
  await page.waitForTimeout(500);
  await page.goto(`http://localhost:${port}/#/train`);
  st = await until((s) => s.interactive, 60000);
  const why = st ? '' : JSON.stringify({ step: await step().catch((e) => e.message.slice(0, 80)), feed: (await page.$eval('.feed', (e) => e.innerText).catch(() => 'no feed')).slice(-200) });
  check('trainer recovers after navigating away and back', !!st, why);
  check('no page errors during puzzle flows', page.errors.length === 0, page.errors.join(' | '));

  // f) phone layout with the voice controls
  await page.setViewportSize({ width: 360, height: 760 });
  await page.waitForTimeout(400);
  check('no sideways scrolling at 360px wide', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
  await page.screenshot({ path: 'tests/screens/edge-mobile.png', fullPage: true });
  await ctx.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
try {
  process.kill(-server.pid);
} catch {}
process.exit(failed.length ? 1 : 0);
