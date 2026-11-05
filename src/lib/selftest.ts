// Self-test for the iOS app, run on the iPhone/iPad simulators in CI
// (.github/workflows/ios.yml). Only included in builds made with
// VITE_SELFTEST=1 — never in the App Store build.
//
// It prints lines the CI job reads from the app's console:
//   CD-CHECK <name> ok|FAIL <detail>
//   CD-SHOT <name>           (CI takes a screenshot now)
//   CD-SELFTEST PASS|FAIL <passed>/<total>

import { Chess } from 'chess.js';
import { getEngine } from './engine';
import { isNativeApp } from './native';
import { pinManifest, pinUrl } from './pin';
import * as store from './store';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await sleep(250);
  }
  return false;
};
const timeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, sleep(ms).then(() => Promise.reject(new Error(`timeout ${ms} ms`)))]);

export async function runSelfTest() {
  const results: boolean[] = [];
  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(e.message));
  window.addEventListener('unhandledrejection', (e) => errors.push(String((e as PromiseRejectionEvent).reason)));
  const check = async (name: string, fn: () => Promise<string>) => {
    try {
      const detail = await fn();
      results.push(true);
      console.log(`CD-CHECK ${name} ok ${detail}`);
    } catch (e) {
      results.push(false);
      console.log(`CD-CHECK ${name} FAIL ${(e as Error).message}`);
    }
  };
  // Screenshot handshake: announce, then wait until the CI script has taken
  // it (it writes the name into shot-ack.txt inside the app). Screenshots on
  // CI Macs take 1–30 s, so a fixed wait would capture the wrong screen.
  const shot = async (name: string) => {
    await sleep(1500);
    console.log(`CD-SHOT ${name}`);
    const end = Date.now() + 90000;
    while (Date.now() < end) {
      const ack = await fetch(`shot-ack.txt?t=${Date.now()}`, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : '')).catch(() => '');
      if (ack.split(/\s+/).includes(name)) return;
      await sleep(500);
    }
    results.push(false); // a missing screenshot fails the run
    console.log(`CD-CHECK screenshot-${name} FAIL no screenshot taken within 90 s`);
  };
  const user = import.meta.env.VITE_SELFTEST_USER || 'erik';
  await sleep(1500);

  await check('runs-as-app', async () => {
    if (!isNativeApp()) throw new Error('not running inside the iOS app');
    return `${location.protocol}//${location.host}`;
  });
  await check('welcome-screen', async () => {
    if (!(await until(() => !!document.querySelector('.hero, .topbar'), 10000))) throw new Error('no welcome screen');
    return 'shown';
  });
  await check('notch-safe-area', async () => {
    // Measure the device's real notch area, then check the header keeps clear of it.
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;height:0;padding-top:env(safe-area-inset-top)';
    document.body.append(probe);
    const inset = parseFloat(getComputedStyle(probe).paddingTop) || 0;
    probe.remove();
    const pad = parseFloat(getComputedStyle(document.querySelector('.topbar') ?? document.body).paddingTop) || 0;
    const hero = document.querySelector('.hero')?.getBoundingClientRect().top ?? inset;
    if (document.querySelector('.topbar') ? pad < inset : hero < inset) throw new Error(`notch ${inset}px but content starts at ${document.querySelector('.topbar') ? pad : hero}px`);
    return `notch ${inset}px, clear`;
  });
  await shot('welcome');
  await check('stockfish', async () => {
    const t = Date.now();
    const r = await timeout(getEngine().search(new Chess().fen(), { depth: 12, multipv: 1 }), 60000);
    const mv = r.lines[0]?.uci[0];
    if (!mv || !new Chess().moves({ verbose: true }).some((m) => m.lan === mv)) throw new Error(`bad best move ${mv}`);
    return `best ${mv} in ${Date.now() - t} ms`;
  });
  await check('storage', async () => {
    await store.set('selftest', { n: 42 });
    const v = await store.get<{ n: number }>('selftest');
    if (v?.n !== 42) throw new Error('IndexedDB did not keep the value');
    await store.del('selftest');
    return 'IndexedDB ok';
  });
  await check('pin-voice', async () => {
    const m = await pinManifest();
    const files = Object.values(m);
    if (files.length < 100) throw new Error(`only ${files.length} clips`);
    const b = await (await fetch(pinUrl(files[0]))).blob();
    if (b.size < 1000) throw new Error('clip is empty');
    return `${files.length} clips, ${b.size} bytes`;
  });
  await check('speech', async () => {
    if (!('speechSynthesis' in window)) throw new Error('no speechSynthesis');
    return `${speechSynthesis.getVoices().length} voices`;
  });
  await check('chess.com', async () => {
    const r = await timeout(fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}`), 20000);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()).username ?? 'ok';
  });

  // The real journey: connect, analyse, then visit the main screens.
  await check('analyse-games', async () => {
    const input = document.querySelector<HTMLInputElement>('#uname');
    if (!input) throw new Error('no username box');
    input.value = user;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('.connect button')?.click();
    const done = await until(() => /games analyzed/.test(document.querySelector('.status')?.textContent ?? '') && !document.querySelector('.status .spin'), 420000);
    if (!done) throw new Error(`still: ${document.querySelector('.status')?.textContent?.slice(0, 80)}`);
    return document.querySelector('.status')?.textContent?.trim().slice(0, 60) ?? '';
  });
  await check('header-below-notch', async () => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;height:0;padding-top:env(safe-area-inset-top)';
    document.body.append(probe);
    const inset = parseFloat(getComputedStyle(probe).paddingTop) || 0;
    probe.remove();
    const brand = document.querySelector('.topbar .brand, .topbar nav')?.getBoundingClientRect().top ?? 0;
    if (brand < inset) throw new Error(`header at ${Math.round(brand)}px is under the notch (${inset}px)`);
    return `header at ${Math.round(brand)}px, notch ${inset}px`;
  });
  await shot('dashboard');
  const visit = async (route: string, sel: string, wait = 30000) => {
    location.hash = route;
    if (!(await until(() => !!document.querySelector(sel), wait))) throw new Error(`${sel} not shown`);
  };
  await check('puzzle', async () => {
    await visit('#/train', '.trainer .case-head h2');
    await until(() => !!(window as any).__cdStep, 5000);
    const s = (await timeout((window as any).__cdStep(), 60000)) as { best: string | null };
    if (!s.best) throw new Error('Stockfish gave no move for the puzzle');
    return s.best;
  });
  await shot('puzzle');
  await check('repertoire', async () => {
    await visit('#/repertoire?color=white', '.rep-line', 300000);
    return `${document.querySelectorAll('.rep-line').length} lines`;
  });
  await shot('repertoire');
  await check('chapters', async () => {
    await visit('#/chapters', '.chapter-grid');
    return `${document.querySelectorAll('a.chapter').length} chapters`;
  });
  await shot('chapters');
  await check('no-sideways-scroll', async () => {
    if (document.documentElement.scrollWidth > innerWidth + 1) throw new Error(`${document.documentElement.scrollWidth} > ${innerWidth}`);
    return `${innerWidth}×${innerHeight}`;
  });

  await check('no-page-errors', async () => {
    if (errors.length) throw new Error(errors.slice(0, 3).join(' | '));
    return 'none';
  });
  const ok = results.filter(Boolean).length;
  console.log(`CD-SELFTEST ${ok === results.length ? 'PASS' : 'FAIL'} ${ok}/${results.length}`);
}
