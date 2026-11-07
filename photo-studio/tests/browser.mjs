/**
 * Browser checks — a robot uses the built app like a person would.
 * Privacy (no request leaves the device), saving, accessibility (axe, light + dark),
 * phone layout at 360 px, offline, hostile file names. Writes screenshots to scripts/out/.
 * Prints one JSON line of results for scripts/loop.mjs.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const OUT = new URL('../scripts/out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const PORT = 4321 + Math.floor(Math.random() * 500);
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
const ORIGIN = `http://localhost:${PORT}`;
for (let i = 0; i < 50; i++) { try { await fetch(ORIGIN); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }

const results = {};
const fail = [];
const check = (name, ok, detail = '') => { results[name] = ok ? 'pass' : `FAIL ${detail}`; if (!ok) fail.push(`${name}: ${detail}`); };

// A JPEG "photo" with a problem (dark + blue cast) and EXIF with orientation + GPS.
function exifSegment() {
  const t = [0x49, 0x49, 42, 0, 8, 0, 0, 0, 2, 0,
    0x12, 0x01, 3, 0, 1, 0, 0, 0, 1, 0, 0, 0,          // orientation 1
    0x25, 0x88, 4, 0, 1, 0, 0, 0, 38, 0, 0, 0,         // GPS IFD at 38
    0, 0, 0, 0,
    1, 0, 0x02, 0, 5, 0, 1, 0, 0, 0, 56, 0, 0, 0, 0, 0, 0, 0,
    0x39, 0x30, 0x00, 0x00, 1, 0, 0, 0];               // latitude 12345/1 at 56
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...t];
  const len = payload.length + 2;
  return Buffer.from([0xff, 0xe1, len >> 8, len & 255, ...payload]);
}
async function makePhoto(page) {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 800;
    const g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, 300); sky.addColorStop(0, '#2b3d66'); sky.addColorStop(1, '#3d5583');
    g.fillStyle = sky; g.fillRect(0, 0, 1200, 300);
    const ramp = g.createLinearGradient(0, 0, 1200, 0); ramp.addColorStop(0, '#05070c'); ramp.addColorStop(1, '#8a96b4');
    g.fillStyle = ramp; g.fillRect(0, 300, 1200, 120);
    g.fillStyle = '#5a4a52'; g.fillRect(0, 420, 400, 380);
    g.fillStyle = '#1c3324'; g.fillRect(400, 420, 400, 380);
    g.fillStyle = '#3f4552'; g.fillRect(800, 420, 400, 380);
    g.fillStyle = '#6a1c26'; g.beginPath(); g.arc(1000, 600, 80, 0, 7); g.fill();
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (const b of buf) s += String.fromCharCode(b); return btoa(s);
  });
  const jpeg = Buffer.from(b64, 'base64');
  return Buffer.concat([jpeg.subarray(0, 2), exifSegment(), jpeg.subarray(2)]);
}
const meanOfCanvas = (page) => page.evaluate(() => {
  const c = document.getElementById('view'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let s = 0, rb = 0; for (let i = 0; i < d.length; i += 16) { s += d[i] + d[i + 1] + d[i + 2]; rb += d[i] - d[i + 2]; }
  return { mean: s / (d.length / 16) / 3, redMinusBlue: rb / (d.length / 16) };
});
async function axe(page, label) {
  await page.evaluate(axeSource); // via the debugger channel — the app's CSP (correctly) blocks injected scripts
  const r = await page.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }));
  check(`a11y ${label}`, r.violations.length === 0, r.violations.map((v) => `${v.id}(${v.nodes.length})`).join(' '));
}

const browser = await chromium.launch();
try {
  // ---------- desktop, light ----------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const consoleErrors = [];
  const offsite = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  ctx.on('request', (r) => { const u = r.url(); if (!u.startsWith(ORIGIN) && !u.startsWith('blob:') && !u.startsWith('data:')) offsite.push(u); });
  let uploads = 0; ctx.on('request', (r) => { if (['POST', 'PUT'].includes(r.method())) uploads++; });

  await page.goto(ORIGIN);
  await axe(page, 'start screen (light)');
  await page.screenshot({ path: OUT + 'desktop-start.png' });

  const photo = await makePhoto(page);
  const t0 = Date.now();
  await page.setInputFiles('input[type=file]', { name: 'evening.jpg', mimeType: 'image/jpeg', buffer: photo });
  await page.waitForSelector('#view[data-state=edited]', { timeout: 20000 });
  results.autoEditMs = Date.now() - t0;
  const edited = await meanOfCanvas(page);
  const reasons = await page.$$eval('.why li', (els) => els.map((e) => e.textContent));
  check('auto edit brightens a dark photo', edited.mean > 75, `mean ${edited.mean.toFixed(0)}`);
  check('auto edit explains itself', reasons.length >= 2, JSON.stringify(reasons));
  await page.screenshot({ path: OUT + 'desktop-editor.png' });

  // hold to compare
  const box = await page.locator('#view').boundingBox();
  await page.mouse.move(box.x + 50, box.y + 50); await page.mouse.down();
  await page.waitForSelector('#view[data-state=original]');
  const orig = await meanOfCanvas(page);
  await page.mouse.up();
  await page.waitForSelector('#view[data-state=edited]');
  check('hold shows the original', orig.mean < edited.mean - 15, `orig ${orig.mean.toFixed(0)} edited ${edited.mean.toFixed(0)}`);

  // looks
  await page.getByRole('radio', { name: 'B&W' }).click();
  await page.waitForFunction(() => { const c = document.getElementById('view'); const d = c.getContext('2d').getImageData(600, 600, 1, 1).data; return Math.abs(d[0] - d[2]) <= 2; });
  check('B&W look makes it grey', true);
  await page.getByRole('radio', { name: 'Natural' }).click();
  await axe(page, 'editor (light)');

  // save at full size, with EXIF kept, orientation normal, GPS removed
  const t1 = Date.now();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save photo' }).click()]);
  results.saveMs = Date.now() - t1;
  const saved = readFileSync(await dl.path());
  const hasExif = saved.includes(Buffer.from('Exif\0\0'));
  const gpsGone = !saved.includes(Buffer.from([0x39, 0x30, 0x00, 0x00, 1, 0, 0, 0]));
  check('saves a JPEG', saved[0] === 0xff && saved[1] === 0xd8 && dl.suggestedFilename() === 'evening-edited.jpg', dl.suggestedFilename());
  check('keeps camera details (EXIF)', hasExif);
  check('removes location by default', gpsGone);
  const dims = await page.evaluate(async (b64) => {
    const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([u], { type: 'image/jpeg' })); return [bmp.width, bmp.height];
  }, saved.toString('base64'));
  check('saves at full resolution', dims[0] === 1200 && dims[1] === 800, dims.join('x'));

  // hostile file name is shown as text, never run
  let dialog = false; page.on('dialog', (d) => { dialog = true; d.dismiss(); });
  await page.setInputFiles('input[type=file]', { name: '<img src=x onerror=alert(1)>.jpg', mimeType: 'image/jpeg', buffer: photo });
  await page.waitForSelector('.strip img');
  await page.waitForTimeout(300);
  check('hostile file names are harmless', !dialog && (await page.$$('img[src="x"]')).length === 0);

  // 12-megapixel save timing (typical iPhone photo)
  const big = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 4032; c.height = 3024; const g = c.getContext('2d');
    g.fillStyle = '#334'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#a86'; g.fillRect(500, 500, 2000, 1500);
    const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9)); const u = new Uint8Array(await b.arrayBuffer());
    let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s);
  });
  await page.setInputFiles('input[type=file]', { name: 'iphone-12mp.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(big, 'base64') });
  await page.waitForFunction(() => document.querySelectorAll('.strip li').length === 3, null, { timeout: 30000 });
  await page.locator('.thumb').nth(2).click();
  await page.waitForSelector('#view[data-state=edited]');
  const t2 = Date.now();
  await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByRole('button', { name: 'Save photo' }).click()]);
  results.save12mpMs = Date.now() - t2;

  check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
  check('privacy: nothing sent off the device', offsite.length === 0 && uploads === 0, `${offsite.join(' ')} uploads=${uploads}`);

  // ---------- dark mode ----------
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark' });
  const dpage = await dctx.newPage();
  await dpage.goto(ORIGIN);
  await axe(dpage, 'start screen (dark)');
  await dpage.setInputFiles('input[type=file]', { name: 'evening.jpg', mimeType: 'image/jpeg', buffer: photo });
  await dpage.waitForSelector('#view[data-state=edited]');
  await axe(dpage, 'editor (dark)');
  await dpage.screenshot({ path: OUT + 'desktop-editor-dark.png' });

  // ---------- phone (360 px) ----------
  for (const scheme of ['light', 'dark']) {
    const pctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, colorScheme: scheme });
    const ppage = await pctx.newPage();
    await ppage.goto(ORIGIN);
    await ppage.setInputFiles('input[type=file]', { name: 'evening.jpg', mimeType: 'image/jpeg', buffer: photo });
    await ppage.waitForSelector('#view[data-state=edited]');
    const sideways = await ppage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`phone ${scheme}: no sideways scrolling`, sideways <= 0, `${sideways}px`);
    const save = await ppage.getByRole('button', { name: 'Save photo' }).boundingBox();
    check(`phone ${scheme}: Save is on screen without scrolling`, save && save.y + save.height <= 740, JSON.stringify(save));
    await axe(ppage, `phone (${scheme})`);
    await ppage.screenshot({ path: OUT + `phone-${scheme}.png`, fullPage: true });
    await pctx.close();
  }

  // ---------- offline ----------
  const octx = await browser.newContext();
  const opage = await octx.newPage();
  await opage.goto(ORIGIN);
  await opage.evaluate(() => navigator.serviceWorker.ready);
  await opage.reload(); // let the service worker cache the app files
  await opage.waitForTimeout(500);
  await octx.setOffline(true);
  await opage.reload();
  check('works offline (Airplane Mode)', (await opage.locator('h1').textContent()).includes('Photo Studio'));
} catch (e) {
  check('browser run finished', false, String(e).slice(0, 300));
} finally {
  await browser.close();
  server.kill();
}
console.log('RESULTS ' + JSON.stringify(results));
process.exit(fail.length ? 1 : 0);
