// Your detective career: rank, streak, badges and which themes you've mastered.

import { app } from '../lib/app';
import { THEMES } from '../lib/themes';
import { BADGES, RANKS, XP_TABLE, rankOf, today } from '../lib/training';
import { LEVELS } from '../lib/difficulty';
import type { ThemeId } from '../lib/types';
import { esc } from '../ui/dom';
import { accountBox, bindSignOut } from '../ui/account';
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
  ${xpHistory(p)}
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
        <p class="sub">chess.com player: <b>${esc(app.username)}</b>.</p>
        ${accountBox()}
        <div class="row">
          <button class="btn small" data-act="reanalyze">Re-analyze games</button>
          <button class="btn small ghost" data-act="switch">Switch player</button>
          <button class="btn small danger" data-act="wipe">Delete all data</button>
        </div>
      </div>
    </div>
  </section>`;

  bindSignOut(view, () => renderProgress(view));
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

function xpHistory(p: import('../lib/training').Progress): string {
  const log = [...(p.log ?? [])].reverse();
  const byLevel = [1, 2, 3, 4, 5].map((lv) => {
    const e = log.filter((x) => x.level === lv);
    return { lv, n: e.length, xp: e.reduce((a, x) => a + x.xp + x.bonus, 0), clean: e.filter((x) => x.result === 'clean').length };
  });
  const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
  const res = { clean: '✅ clean', hinted: '💡 with help', failed: '↻ shown' } as const;
  return `<section class="card xp-card">
    <h2>XP by difficulty</h2>
    <p class="sub">Harder puzzles are worth more. Solve without hints for full XP; with help you get half.</p>
    <div class="xp-levels">${byLevel
      .map(
        (b) => `<div class="xp-level"><span class="stars" aria-label="${b.lv} stars">${stars(b.lv)}</span><b>${esc(LEVELS[b.lv - 1].label)}</b>
        <span class="sub">${XP_TABLE[b.lv][0]} XP each</span><span>${b.n} solved · ${b.clean} clean</span><strong>${b.xp} XP</strong></div>`,
      )
      .join('')}</div>
    ${
      log.length
        ? `<details class="xp-log" ${log.length <= 10 ? 'open' : ''}><summary>XP history (${log.length} puzzle${log.length === 1 ? '' : 's'})</summary>
          <table><thead><tr><th>When</th><th>Puzzle</th><th>Difficulty</th><th>Result</th><th>XP</th></tr></thead><tbody>${log
            .slice(0, 50)
            .map((x) => {
              const m = app.findMistake(x.id);
              const g = m ? app.gameOf(m) : undefined;
              const when = new Date(x.t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
              return `<tr><td>${esc(when)}</td><td>${m ? `<a href="#/train/${encodeURIComponent(x.id)}">Move ${m.moveNumber} vs ${esc(g?.opponent ?? 'opponent')}</a>` : 'Puzzle'}</td><td><span class="stars">${stars(x.level)}</span></td><td>${res[x.result]}${x.replay ? ' · replay' : ''}</td><td><b>+${x.xp}</b>${x.bonus ? ` <span class="bonus">+${x.bonus}🔥</span>` : ''}</td></tr>`;
            })
            .join('')}</tbody></table></details>`
        : '<p class="empty">Solve a puzzle to start your XP history.</p>'
    }
  </section>`;
}
