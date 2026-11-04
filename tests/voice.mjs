// Professor Pin's voice: his recorded lines play; other sentences fall back to a voice.
//   FIXTURES=/path FIXTURE_USER=name node tests/voice.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');

const FIX = process.env.FIXTURES;
const USER = process.env.FIXTURE_USER ?? 'erik';
const port = 4186;
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('Local') && r()));
const browser = await chromium.launch();
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => {
  localStorage.setItem('voice-settings', JSON.stringify({ enabled: true, engine: 'pin' }));
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
});
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

const manifest = await (await fetch(`http://localhost:${port}/voice/pin/manifest.json`)).json();
check('Professor Pin clips are published with the site', Object.keys(manifest).length >= 100, `${Object.keys(manifest).length} clips`);
const sample = Object.values(manifest)[0];
const clipRes = await fetch(`http://localhost:${port}/voice/pin/${sample}`);
check('clips are served as audio', clipRes.ok && /audio/.test(clipRes.headers.get('content-type') ?? ''), clipRes.headers.get('content-type'));

await page.goto(`http://localhost:${port}/`);
await page.fill('#uname', USER);
await page.click('.connect button');
await page.waitForSelector('.dash-head');
await page.waitForFunction(() => /games analyzed/.test(document.querySelector('.status')?.textContent ?? '') && !document.querySelector('.status .spin'), null, { timeout: 600000 });
await page.goto(`http://localhost:${port}/#/train`);
await page.waitForSelector('.trainer .case-head h2');
await page.mouse.click(5, 5); // a first tap (unlocks audio on iPad)
await page.waitForTimeout(6000);
await page.click('[data-act=hint]');
await page.waitForTimeout(4000);
const played = await page.evaluate(() => window.__played);
const spoken = await page.evaluate(() => window.__spoken);
check("Professor Pin's recorded lines play during a puzzle", played.some((u) => /\/voice\/pin\/[0-9a-f]{12}\.mp3$/.test(u)), `${played.length} clips, e.g. ${played[0]?.split('/').pop()}`);
check('sentences without a recording are still spoken', spoken.length > 0, `${spoken.length} sentences, e.g. "${spoken[0]?.slice(0, 50)}"`);
check('no page errors', errors.length === 0, errors.join(' | '));

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
try {
  process.kill(-server.pid);
} catch {}
process.exit(results.every(Boolean) ? 0 : 1);
