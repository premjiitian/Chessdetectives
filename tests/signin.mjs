// Sign-in UI: hidden until set up, visible (and error-free) once configured.
//   FIXTURES=/path FIXTURE_USER=name node tests/signin.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');

const FIX = process.env.FIXTURES;
const USER = process.env.FIXTURE_USER ?? 'erik';
mkdirSync('tests/screens', { recursive: true });
const port = 4189;
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

async function run(configured) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 850 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://images.chesscomfiles.com/**', (r) => r.fulfill({ status: 404 }));
  await page.route('**/firebase-config.json', (r) =>
    configured
      ? r.fulfill({ contentType: 'application/json', body: JSON.stringify({ apiKey: 'AIzaTestKey', authDomain: 'test.firebaseapp.com', projectId: 'test', appId: '1:1:web:1' }) })
      : r.fulfill({ status: 404, body: '' }),
  );
  // No real Google traffic in tests.
  await page.route(/googleapis\.com|firebaseapp\.com|gstatic\.com/, (r) => r.fulfill({ status: 200, body: '{}' }));
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
  const label = configured ? 'set up' : 'not set up';
  const firebaseLoads = [];
  page.on('request', (r) => /firebase|auth-|firestore/i.test(r.url()) && r.url().includes('/assets/') && firebaseLoads.push(r.url()));
  await page.goto(`http://localhost:${port}/`);
  await page.waitForSelector('.hero');
  await page.waitForTimeout(1500);
  const visible = await page.isVisible('.gsi-row .gsi');
  check(`welcome: Google button ${configured ? 'shown' : 'hidden'} when sign-in is ${label}`, visible === configured);
  if (configured) await page.screenshot({ path: 'tests/screens/signin-welcome.png' });
  await page.fill('#uname', USER);
  await page.click('.connect button');
  await page.waitForSelector('.dash-head');
  await page.waitForTimeout(1500);
  const chip = await page.isVisible('.acct-slot .gsi');
  check(`header: "Sign in" ${configured ? 'shown' : 'hidden'} when sign-in is ${label}`, chip === configured);
  if (!configured) check('Firebase code is not downloaded when sign-in is not set up', firebaseLoads.length === 0, firebaseLoads.join(', '));
  await page.goto(`http://localhost:${port}/#/progress`);
  await page.waitForTimeout(600);
  const box = await page.textContent('.settings');
  check(`Progress → Account explains sign-in (${label})`, configured ? /Sign in to keep your XP/.test(box) : /only in this browser/.test(box));
  check(`no page errors (${label})`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await run(false);
await run(true);
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
try {
  process.kill(-server.pid);
} catch {}
process.exit(results.every(Boolean) ? 0 : 1);
