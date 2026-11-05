// Voice coach: quiet by default, ▶ Listen plays a short summary; auto-read is opt-in.
// Professor Pin's recorded lines play; other sentences fall back to a voice.
//   FIXTURES=/path FIXTURE_USER=name node tests/voice.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { waitStep } from './helpers.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');

const FIX = process.env.FIXTURES;
const USER = process.env.FIXTURE_USER ?? 'erik';
const port = 4186;
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

// A browser where audio and speech are recorded instead of played.
async function contextWith(voiceSettings) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.addInitScript((vs) => {
    localStorage.setItem('voice-settings', JSON.stringify(vs));
    window.__played = [];
    window.__spoken = [];
    // Record audio instead of making sound; finish each clip quickly.
    HTMLMediaElement.prototype.play = function () {
      if (this.src && !this.src.startsWith('data:')) window.__played.push(this.src);
      setTimeout(() => this.onended?.(), 30);
      return Promise.resolve();
    };
    Object.defineProperty(window, 'speechSynthesis', {
      value: { speak: (u) => { if (u.text) window.__spoken.push(u.text); setTimeout(() => u.onend?.(), 20); }, cancel() {}, getVoices: () => [], addEventListener() {} },
    });
    window.SpeechSynthesisUtterance = function (t) {
      this.text = t;
    };
  }, voiceSettings);
  // No 60 MB model download in tests: the natural voice is "unavailable", so the device voice reads the rest.
  await page.route(/huggingface\.co|jsdelivr\.net|cdnjs\.cloudflare\.com/, (r) => r.abort('internetdisconnected'));
  await page.route('https://images.chesscomfiles.com/**', (r) => r.fulfill({ status: 404 }));
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
  return { ctx, page };
}

/** Opens a puzzle and plays the move from the real game (always a wrong move). */
async function wrongMoveInPuzzle(page) {
  await page.goto(`http://localhost:${port}/`);
  await page.fill('#uname', USER);
  await page.click('.connect button');
  await page.waitForSelector('.dash-head');
  await page.waitForFunction(() => /games analyzed/.test(document.querySelector('.status')?.textContent ?? '') && !document.querySelector('.status .spin'), null, { timeout: 600000 });
  await page.goto(`http://localhost:${port}/#/train`);
  await page.waitForSelector('.trainer .case-head h2');
  await page.mouse.click(5, 5); // a first tap (unlocks audio on iPad)
  await waitStep(page, (s) => s.interactive, 60000);
  await page.waitForTimeout(1500);
  const { played, color } = await page.evaluate(() => window.__cd());
  const box = await page.$eval('#board cg-board', (e) => e.getBoundingClientRect().toJSON());
  const at = (sq) => {
    const f = sq.charCodeAt(0) - 97, r = +sq[1] - 1, z = box.width / 8;
    return { x: box.x + ((color === 'white' ? f : 7 - f) + 0.5) * z, y: box.y + ((color === 'white' ? 7 - r : r) + 0.5) * z };
  };
  const a = at(played.slice(0, 2)), b = at(played.slice(2, 4));
  await page.mouse.click(a.x, a.y);
  await page.waitForTimeout(80);
  await page.mouse.click(b.x, b.y);
  await page.waitForSelector('.msg.bad', { timeout: 60000 });
  await page.waitForTimeout(3000);
}
const heard = (page) => page.evaluate(() => ({ played: window.__played.length, spoken: window.__spoken.join(' ') }));
const words = (t) => t.split(/\s+/).filter(Boolean).length;

const manifest = await (await fetch(`http://localhost:${port}/voice/pin/manifest.json`)).json();
check('Professor Pin clips are published with the site', Object.keys(manifest).length >= 100, `${Object.keys(manifest).length} clips`);
const sample = Object.values(manifest)[0];
const clipRes = await fetch(`http://localhost:${port}/voice/pin/${sample}`);
check('clips are served as audio', clipRes.ok && /audio/.test(clipRes.headers.get('content-type') ?? ''), clipRes.headers.get('content-type'));

// 1) Quiet by default — also for players who had the old "read everything" setting on.
{
  const { ctx, page } = await contextWith({ enabled: true, engine: 'pin' });
  await wrongMoveInPuzzle(page);
  const h = await heard(page);
  check('quiet by default: nothing is said after a move', h.played === 0 && !h.spoken, `${h.played} clips, "${h.spoken.slice(0, 60)}"`);
  const listen = await page.$$eval('.feed .listen', (b) => b.map((x) => x.closest('.msg').className));
  check('the verdict has a ▶ Listen button', listen.some((c) => /\bbad\b/.test(c)), listen.join(', '));
  check('no ▶ Listen on small talk (intro, "your turn again")', !listen.some((c) => /\bcoach\b/.test(c)), listen.join(', '));
  await page.click('.msg.bad .listen');
  await page.waitForTimeout(4000);
  const h2 = await heard(page);
  check('tapping ▶ Listen plays the short summary', h2.played + words(h2.spoken) > 0, `"${h2.spoken.slice(0, 140)}"`);
  check('summary says what went wrong and their best answer', /mistake/i.test(h2.spoken) && /best answer/i.test(h2.spoken), h2.spoken.slice(0, 160));
  check("summary gives your plan (without giving the answer away)", /Your plan/.test(h2.spoken), h2.spoken.slice(h2.spoken.indexOf("Your plan")));
  check('summary is short (≤ 70 words, no long move lists)', words(h2.spoken) <= 70 && !/continuation|main line|Why\?/i.test(h2.spoken), `${words(h2.spoken)} words`);
  check('no page errors (quiet mode)', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}

// 2) Auto-read (opt-in): only the short summary is read, nothing else.
{
  const { ctx, page } = await contextWith({ auto: true, engine: 'pin' });
  await wrongMoveInPuzzle(page);
  const h = await heard(page);
  check('auto-read: the summary is read after a wrong move', /best answer/i.test(h.spoken), h.spoken.slice(0, 120));
  check('auto-read skips the long story (intro, evaluation, move lists)', !/Flashback|Right now Stockfish|continuation|main line/i.test(h.spoken) && words(h.spoken) <= 80, `${words(h.spoken)} words`);
  const pin = await page.evaluate(() => window.__played.filter((u) => /\/voice\/pin\/[0-9a-f]{12}\.mp3$/.test(u)).length);
  check("Professor Pin's recorded lines still play", pin > 0, `${pin} clips`);
  check('no page errors (auto-read)', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
try {
  process.kill(-server.pid);
} catch {}
process.exit(results.every(Boolean) ? 0 : 1);
