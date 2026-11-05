// The iOS app's web part, checked in a browser that pretends to be the app
// (the Capacitor bridge is faked). The real app runs the same self-test on
// the iPhone/iPad simulators in .github/workflows/ios.yml.
//   npm run build:selftest && FIXTURES=/path FIXTURE_USER=name node tests/app-mode.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const FIX = process.env.FIXTURES;
const USER = process.env.FIXTURE_USER ?? 'erik';
const port = 4194;
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-selftest', '--port', String(port), '--strictPort'], { stdio: 'pipe', detached: true });
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

const ctx = await browser.newContext({ ...devices['iPhone 15 Pro'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const log = [];
page.on('console', (m) => log.push(m.text()));
await page.addInitScript((user) => {
  // Pretend to be the iOS app: the Capacitor bridge exists.
  window.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
  window.__opened = [];
  localStorage.setItem('voice-settings', JSON.stringify({ engine: 'device' }));
}, USER);
await page.route('https://images.chesscomfiles.com/**', (r) => r.fulfill({ status: 404 }));
await page.route('https://www.youtube-nocookie.com/**', (r) => r.fulfill({ contentType: 'text/html', body: 'player' }));
await page.route('https://api.chess.com/**', (route) => {
  const url = route.request().url();
  let file;
  if (/\/player\/[^/]+$/.test(url)) file = 'profile.json';
  else if (url.endsWith('/games/archives')) file = 'archives.json';
  else {
    const m = url.match(/games\/(\d{4})\/(\d{2})$/);
    if (m) file = `${m[1]}-${m[2]}.json`;
  }
  if (file && existsSync(join(FIX, file))) return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: readFileSync(join(FIX, file)) });
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{"games":[]}' });
});

// The self-test drives the whole journey by itself (as on the simulator).
await page.goto(`http://localhost:${port}/`);
const end = Date.now() + 600000;
while (Date.now() < end && !log.some((l) => l.startsWith('CD-SELFTEST'))) await page.waitForTimeout(500);
for (const l of log.filter((l) => l.startsWith('CD-CHECK'))) {
  const [, name, status, ...rest] = l.split(' ');
  if (name !== 'chess.com' && name !== 'runs-as-app') check(`self-test: ${name}`, status === 'ok', rest.join(' '));
}
check('self-test finished', log.some((l) => l.startsWith('CD-SELFTEST')), log.find((l) => l.startsWith('CD-SELFTEST')) ?? 'no result');
check('self-test asked for screenshots of the main screens', ['welcome', 'dashboard', 'puzzle', 'repertoire', 'chapters'].every((s) => log.includes(`CD-SHOT ${s}`)));

// App-only behaviour
check('no web offline helper inside the app (files are on the device)', !(await page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations?.())?.length)));
check('Google sign-in is hidden in the app', !(await page.$('[data-google], .google-btn, .g-signin')));
await page.evaluate(() => (location.hash = '#/chapters/1'));
await page.waitForSelector('.video-poster');
await page.click('.video-poster');
await page.waitForTimeout(500);
const opened = await page.evaluate(() => window.__opened);
check('videos open in the in-app browser (YouTube blocks players inside apps)', opened.some((u) => /youtube\.com\/watch\?v=/.test(u)) && !(await page.$('.video iframe')), opened.join(' '));
await page.evaluate(() => (location.hash = '#/train'));
await page.waitForSelector('[data-act=game]');
await page.click('[data-act=game]');
await page.waitForTimeout(300);
const opened2 = await page.evaluate(() => window.__opened);
check('chess.com game links open in the in-app browser', opened2.some((u) => /chess\.com\/game/.test(u)), opened2.slice(-1)[0]);
check('the app stays on its own page', /localhost/.test(page.url()));
check('safe areas: content respects the notch', await page.evaluate(() => /safe-area-inset/.test([...document.styleSheets].flatMap((s) => { try { return [...s.cssRules].map((r) => r.cssText); } catch { return []; } }).join(' '))));
check('no page errors', errors.length === 0, errors.join(' | '));

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
