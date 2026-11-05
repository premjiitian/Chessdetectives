// Makes the iOS app icon (1024×1024, square, no transparency — iOS rounds
// the corners itself) and the launch screen image from public/icon.svg.
//   node scripts/make-ios-assets.mjs
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const { chromium } = createRequire(import.meta.url)('playwright');

const ICONSET = 'ios/App/App/Assets.xcassets/AppIcon.appiconset';
const SPLASH = 'ios/App/App/Assets.xcassets/Splash.imageset';
// Full-bleed square for the App Store (no rounded corners, no see-through parts).
const svg = readFileSync('public/icon.svg', 'utf8').replace('rx="112"', 'rx="0"');

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function render(html, w, h, out) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;width:${w}px;height:${h}px;overflow:hidden">${html}</body></html>`);
  await page.screenshot({ path: out, omitBackground: false });
  // Apple rejects icons with an alpha channel: flatten to plain RGB.
  execFileSync('python3', ['-c', `from PIL import Image; im=Image.open('${out}').convert('RGB'); im.save('${out}')`]);
}
await render(svg.replace('<svg ', '<svg width="1024" height="1024" '), 1024, 1024, `${ICONSET}/AppIcon-512@2x.png`);

// Launch screen: the logo on the app's background colour, centred.
const splash = `<div style="width:2732px;height:2732px;background:#f5f7fb;display:grid;place-items:center">
  <div style="text-align:center;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
    ${readFileSync('public/icon.svg', 'utf8').replace('<svg ', '<svg width="520" height="520" ')}
    <div style="margin-top:56px;font-size:120px;color:#1b2333;font-weight:600">Chess<b style="color:#2f62cf">Detectives</b></div>
  </div></div>`;
for (const f of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) await render(splash, 2732, 2732, `${SPLASH}/${f}`);
await browser.close();
writeFileSync(`${ICONSET}/Contents.json`, JSON.stringify({ images: [{ filename: 'AppIcon-512@2x.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }], info: { author: 'xcode', version: 1 } }, null, 2) + '\n');
console.log('iOS icon and launch screen updated.');
