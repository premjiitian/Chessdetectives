// iPad Safari check: the real journey in WebKit (Safari's engine) on an iPad,
// with a REAL chess.com account. Runs on a Mac in CI (.github/workflows/safari.yml).
//   SITE=https://… CHESS_USER=name node tests/safari.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { webkit, devices } = createRequire(import.meta.url)('playwright');

const SITE = process.env.SITE ?? 'https://premjiitian.github.io/Chessdetectives/';
const USERS = (process.env.CHESS_USER ?? 'erik').split(',');
const OUT = process.env.OUT ?? 'out/safari';
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await webkit.launch();
for (const [label, device] of [['iPad portrait', devices['iPad (gen 7)']], ['iPad landscape', devices['iPad Pro 11 landscape']]]) {
  for (const user of USERS) {
    console.log(`\n== ${label} · ${user} · ${SITE}`);
    const ctx = await browser.newContext({ ...device });
    const page = await ctx.newPage();
    const errors = [];
    const failed = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !/404|firebase-config/.test(m.text()) && errors.push('console: ' + m.text().slice(0, 200)));
    page.on('requestfailed', (r) => !/firebase-config|ytimg|chesscomfiles/.test(r.url()) && failed.push(`${r.url().slice(0, 80)} ${r.failure()?.errorText}`));
    const slug = `${label.replace(/\W+/g, '-')}-${user}`;
    try {
      await page.goto(SITE + (SITE.includes('?') ? '&' : '?') + 'v=' + Date.now(), { waitUntil: 'load' });
      const hero = await page.waitForSelector('.hero', { timeout: 30000 }).then(() => true).catch(() => false);
      check(`${label}: the site opens (JavaScript runs)`, hero, hero ? '' : (await page.content()).slice(0, 120));
      if (!hero) {
        await page.screenshot({ path: `${OUT}/${slug}-start.png` });
        continue;
      }
      await page.tap('#uname');
      await page.fill('#uname', user);
      const t0 = Date.now();
      await page.tap('.connect button');
      const dash = await page.waitForSelector('.dash-head', { timeout: 30000 }).then(() => true).catch(() => false);
      check(`${label}: connecting opens the dashboard`, dash, dash ? '' : (await page.$eval('main, body', (e) => e.innerText).catch(() => '')).slice(0, 160));
      let status = '';
      for (let i = 0; i < 90 && dash; i++) {
        await page.waitForTimeout(2000);
        status = await page.$eval('.status', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
        if (/(\d+) of \1 games analyzed|investigating game [2-9]|No games found|more than 3 years/.test(status)) break;
      }
      const n = Number(status.match(/of (\d+) games|game \d+ of (\d+)/)?.slice(1).find(Boolean) ?? 0);
      check(`${label}: games imported from chess.com`, n > 0, `${status.slice(0, 110)} (${Math.round((Date.now() - t0) / 1000)} s)`);
      await page.screenshot({ path: `${OUT}/${slug}-dashboard.png` });
      if (n > 0) {
        await page.goto(SITE.replace(/[?#].*$/, '') + '#/train');
        const puzzle = await page.waitForSelector('.trainer .case-head h2', { timeout: 60000 }).then(() => true).catch(() => false);
        const board = puzzle && (await page.$eval('#board cg-board', (e) => e.getBoundingClientRect().width).catch(() => 0)) > 200;
        check(`${label}: a puzzle opens with the board`, !!board);
        await page.waitForTimeout(4000);
        await page.screenshot({ path: `${OUT}/${slug}-puzzle.png` });
      }
    } catch (e) {
      check(`${label}: no crash in the test`, false, e.message.split('\n')[0]);
      await page.screenshot({ path: `${OUT}/${slug}-crash.png` }).catch(() => {});
    }
    check(`${label}: no JavaScript errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    if (failed.length) console.log('   failed requests:', failed.slice(0, 5).join(' | '));
    await ctx.close();
  }
}
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
