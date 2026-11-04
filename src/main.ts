import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';
import './styles.css';
import { app } from './lib/app';
import { rankOf } from './lib/training';
import { esc } from './ui/dom';
import { accountChip, bindGoogle } from './ui/account';
import { renderWelcome } from './views/welcome';
import { renderDashboard } from './views/dashboard';
import { renderTrain } from './views/train';
import { renderCases } from './views/cases';
import { renderPlay } from './views/play';
import { renderProgress } from './views/progress';
import { renderChapters } from './views/chapters';

export type Cleanup = (() => void) | void;
const root = document.getElementById('app')!;
let cleanup: Cleanup;

function shell(active: string) {
  const p = app.progress;
  const rank = p ? rankOf(p.xp) : null;
  const link = (href: string, label: string, icon: string) =>
    `<a href="#/${href}" class="${active === href ? 'active' : ''}"><span class="ico">${icon}</span><span>${label}</span></a>`;
  root.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#/dashboard"><span class="logo">🔍</span><span>Chess<b>Detectives</b></span></a>
      <nav>
        ${link('dashboard', 'Dashboard', '📊')}
        ${link('chapters', 'Chapters', '📺')}
        ${link('train', 'Train', '🧩')}
        ${link('cases', 'Case files', '🗂️')}
        ${link('play', 'Spar', '♟️')}
        ${link('progress', 'Progress', '🏆')}
      </nav>
      <div class="who">
        ${p ? `<span class="streak" title="Daily streak">🔥 ${p.streak}</span><span class="xp" title="${esc(rank!.title)}">${rank!.icon} ${p.xp} XP</span>` : ''}
        ${app.profile?.avatar ? `<img src="${esc(app.profile.avatar)}" alt="" class="avatar" onerror="this.remove()" />` : ''}
        <span class="uname">${esc(app.profile?.username ?? app.username)}</span>
        <span class="acct-slot">${accountChip()}</span>
      </div>
    </header>
    <main id="view"></main>
    <footer class="foot">Analysis by Stockfish 19 running in your browser · Games from the public chess.com API · Your data stays on this device.</footer>`;
  return document.getElementById('view')!;
}

async function route() {
  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;
  const hash = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = hash.split('?');
  const params = new URLSearchParams(query);
  const [page, ...rest] = path.split('/');

  if (!app.username || page === '' || page === 'welcome') {
    if (app.username && page === '') {
      location.hash = '#/dashboard';
      return;
    }
    root.innerHTML = '';
    cleanup = renderWelcome(root);
    return;
  }
  const view = shell(page);
  window.scrollTo(0, 0);
  switch (page) {
    case 'train':
      cleanup = renderTrain(view, rest.join('/') ? decodeURIComponent(rest.join('/')) : undefined, params);
      break;
    case 'cases':
      cleanup = renderCases(view, params);
      break;
    case 'play':
      cleanup = renderPlay(view, params);
      break;
    case 'chapters':
      cleanup = renderChapters(view, rest[0] ? Number(rest[0]) : undefined);
      break;
    case 'progress':
      cleanup = renderProgress(view);
      break;
    default:
      cleanup = renderDashboard(view, params);
  }
}

// Keep the XP/streak chip and the account chip in the header fresh.
let lastAcct = '';
app.on(() => {
  const slot = document.querySelector('.acct-slot');
  const acct = accountChip();
  if (slot && acct !== lastAcct) {
    lastAcct = acct;
    slot.innerHTML = acct;
    bindGoogle(slot);
  }
  const chip = document.querySelector('.topbar .who');
  if (chip && app.progress) {
    const r = rankOf(app.progress.xp);
    const s = chip.querySelector('.streak');
    const x = chip.querySelector('.xp');
    if (s) s.textContent = `🔥 ${app.progress.streak}`;
    if (x) x.textContent = `${r.icon} ${app.progress.xp} XP`;
  }
});

window.addEventListener('hashchange', route);
app.restore().then(() => {
  route();
  app.initCloud();
});
// Offline support (built site only; the dev server always serves fresh files).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
      const reg = await navigator.serviceWorker.ready;
      const base = new URL(import.meta.env.BASE_URL, location.href).href;
      const loaded = performance.getEntriesByType('resource').map((e) => e.name);
      const extra = ['engine/stockfish-19-lite-single.js', 'engine/stockfish-19-lite-single.wasm', 'voice/pin/manifest.json', 'icon-180.png'].map((f) => base + f);
      reg.active?.postMessage({ type: 'precache', urls: [location.href.split('#')[0], ...loaded, ...extra] });
    } catch {
      /* offline support is a bonus; never block the app */
    }
  });
}
// Google buttons can appear on any page.
new MutationObserver(() => bindGoogle(document)).observe(document.body, { childList: true, subtree: true });
