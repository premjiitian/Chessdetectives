// Your detective career: rank, streak, badges and which themes you've mastered.

import { app } from '../lib/app';
import { THEMES } from '../lib/themes';
import { BADGES, RANKS, rankOf, today } from '../lib/training';
import type { ThemeId } from '../lib/types';
import { esc } from '../ui/dom';
import * as store from '../lib/store';

export function renderProgress(view: HTMLElement) {
  const p = app.progress!;
  const r = rankOf(p.xp);
  const mistakes = app.mistakes();
  const cards = Object.values(p.cards);
  const solved = cards.filter((c) => c.solved).length;
  const mastered = cards.filter((c) => c.box >= 3).length;

  // Last 12 weeks of training, GitHub style.
  const days: { d: string; n: number }[] = [];
  for (let i = 83; i >= 0; i--) {
    const d = today(new Date(Date.now() - i * 86400000));
    days.push({ d, n: p.daily[d] ?? 0 });
  }

  const themeIds = [...new Set([...mistakes.map((m) => m.theme), ...(Object.keys(p.themes) as ThemeId[])])];
  const themeRows = themeIds
    .map((t) => {
      const total = mistakes.filter((m) => m.theme === t).length;
      const done = mistakes.filter((m) => m.theme === t && (p.cards[m.id]?.box ?? 0) >= 2).length;
      return { t, total, done, mastery: total ? done / total : 0 };
    })
    .sort((a, b) => b.total - a.total);

  view.innerHTML = `
  <section class="dash-head"><div><h1>Your detective career 🏆</h1><p class="headline">Small daily sessions beat long rare ones. Keep the streak alive!</p></div></section>
  <section class="grid-2">
    <div class="card rank-card">
      <div class="rank-ico">${r.icon}</div>
      <div class="rank-body">
        <span class="k-label">Current rank</span>
        <h2>${esc(r.title)}</h2>
        <div class="bar xp"><i style="width:${r.progress * 100}%"></i></div>
        <span class="sub">${p.xp} XP${r.next ? ` · ${r.next.xp - p.xp} XP to ${esc(r.next.title)}` : ' · maximum rank!'}</span>
      </div>
    </div>
    <div class="card kpis-mini">
      <div><span class="k-value">🔥 ${p.streak}</span><span class="k-label">day streak (best ${p.bestStreak})</span></div>
      <div><span class="k-value">${solved}</span><span class="k-label">cases solved</span></div>
      <div><span class="k-value">${mastered}</span><span class="k-label">cases mastered</span></div>
      <div><span class="k-value">${mistakes.length - solved}</span><span class="k-label">still open</span></div>
    </div>
  </section>
  <section class="card">
    <h2>Training calendar</h2>
    <div class="heat">${days.map((d) => `<i title="${d.d}: ${d.n} solved" class="l${d.n === 0 ? 0 : d.n < 3 ? 1 : d.n < 6 ? 2 : 3}"></i>`).join('')}</div>
  </section>
  <section class="grid-main">
    <div class="card">
      <h2>Theme mastery</h2>
      <p class="sub">A case counts as mastered once you've solved it cleanly at least twice in a row.</p>
      ${themeRows.length ? `<ol class="themes">${themeRows
        .map(
          (x) => `<li><span class="t-ico">${THEMES[x.t].icon}</span><div class="t-body"><div class="t-row"><strong>${esc(THEMES[x.t].title)}</strong><span class="trend">${x.done}/${x.total}</span></div><div class="bar green"><i style="width:${x.mastery * 100}%"></i></div></div><a class="btn small" href="#/train?theme=${x.t}">Train</a></li>`,
        )
        .join('')}</ol>` : '<div class="empty">Solve your first case to start tracking mastery.</div>'}
    </div>
    <div class="side">
      <div class="card">
        <h2>Badges</h2>
        <div class="badges">${Object.entries(BADGES)
          .map(([id, b]) => `<div class="badge ${p.badges.includes(id) ? 'got' : ''}" title="${esc(b.desc)}"><span>${b.icon}</span><b>${esc(b.title)}</b><small>${esc(b.desc)}</small></div>`)
          .join('')}</div>
      </div>
      <div class="card">
        <h2>Ranks</h2>
        <ol class="ranks">${RANKS.map((x, i) => `<li class="${i <= r.index ? 'got' : ''}">${x.icon} ${esc(x.title)} <small>${x.xp} XP</small></li>`).join('')}</ol>
      </div>
      <div class="card settings">
        <h2>Account</h2>
        <p class="sub">Signed in as <b>${esc(app.username)}</b>. Data is stored only in this browser.</p>
        <div class="row">
          <button class="btn small" data-act="reanalyze">Re-analyze games</button>
          <button class="btn small ghost" data-act="switch">Switch player</button>
          <button class="btn small danger" data-act="wipe">Delete all data</button>
        </div>
      </div>
    </div>
  </section>`;

  view.querySelector('[data-act=switch]')!.addEventListener('click', async () => {
    await app.logout();
    location.hash = '#/';
  });
  view.querySelector('[data-act=reanalyze]')!.addEventListener('click', async () => {
    if (!confirm('Throw away the current analysis and investigate your games again? (Your XP and puzzle history stay.)')) return;
    await app.resetAnalysis();
    location.hash = '#/dashboard';
    app.analyze(30, 20);
  });
  view.querySelector('[data-act=wipe]')!.addEventListener('click', async () => {
    if (!confirm('Delete every game, analysis and progress stored on this device?')) return;
    await app.logout();
    await store.clearAll();
    location.hash = '#/';
  });
}
