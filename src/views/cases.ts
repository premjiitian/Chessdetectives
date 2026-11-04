// Case files: every mistake we found, as a browsable gallery of mini boards.

import { app } from '../lib/app';
import { THEMES } from '../lib/themes';
import type { ThemeId } from '../lib/types';
import { miniBoard } from '../ui/board';
import { esc, timeAgo } from '../ui/dom';

export function renderCases(view: HTMLElement, params: URLSearchParams) {
  let theme = (params.get('theme') as ThemeId | null) ?? '';
  let status = params.get('status') ?? '';
  let severity = params.get('severity') ?? '';
  const boards: { destroy(): void }[] = [];
  let shown = 30;

  const render = () => {
    boards.splice(0).forEach((b) => b.destroy());
    const p = app.progress!;
    const all = app.mistakes();
    const list = all.filter((m) => {
      if (theme && m.theme !== theme) return false;
      if (severity && m.severity !== severity) return false;
      const c = p.cards[m.id];
      if (status === 'new' && c) return false;
      if (status === 'solved' && !(c && c.solved)) return false;
      if (status === 'due' && !(c && c.due <= Date.now())) return false;
      return true;
    });
    const themesPresent = [...new Set(all.map((m) => m.theme))];
    view.innerHTML = `
      <section class="dash-head">
        <div><h1>Case files 🗂️</h1><p class="headline">${all.length} moments from your games where a better move was waiting. Pick any case to solve it.</p></div>
      </section>
      <div class="filters card">
        <select data-f="theme"><option value="">All themes</option>${themesPresent
          .map((t) => `<option value="${t}" ${t === theme ? 'selected' : ''}>${THEMES[t].icon} ${esc(THEMES[t].title)}</option>`)
          .join('')}</select>
        <select data-f="severity"><option value="">Mistakes & blunders</option><option value="blunder" ${severity === 'blunder' ? 'selected' : ''}>Blunders only</option><option value="mistake" ${severity === 'mistake' ? 'selected' : ''}>Mistakes only</option></select>
        <select data-f="status"><option value="">Any status</option>${['new', 'due', 'solved'].map((s) => `<option value="${s}" ${s === status ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select>
        <span class="count">${list.length} case${list.length === 1 ? '' : 's'}</span>
      </div>
      ${list.length ? `<div class="case-grid">${list
        .slice(0, shown)
        .map((m) => {
          const c = p.cards[m.id];
          const badge = !c ? '<span class="new">new</span>' : c.solved ? `<span class="solved">✓ solved ×${c.solved}</span>` : '<span class="review">↻ retry</span>';
          return `<a class="case card" href="#/train/${encodeURIComponent(m.id)}">
            <div class="mini-host" data-fen="${esc(m.fenBefore)}" data-or="${m.userColor}"></div>
            <div class="case-info">
              <div class="case-top"><span class="sev ${m.severity}">${m.severity}</span>${badge}</div>
              <strong>${THEMES[m.theme].icon} ${esc(THEMES[m.theme].title)}</strong>
              <span class="meta">Move ${m.moveNumber} · you played ${esc(m.played)} · −${m.winLoss}%</span>
              <span class="meta">${esc(m.timeClass)} · ${timeAgo(m.endTime)}</span>
            </div>
          </a>`;
        })
        .join('')}</div>${list.length > shown ? '<div class="row center"><button class="btn" data-more>Show more</button></div>' : ''}` : '<div class="card empty">No cases match these filters.</div>'}`;

    view.querySelectorAll<HTMLElement>('.mini-host').forEach((h) => boards.push(miniBoard(h, h.dataset.fen!, h.dataset.or as 'white' | 'black')));
    view.querySelectorAll<HTMLSelectElement>('[data-f]').forEach((s) =>
      s.addEventListener('change', () => {
        if (s.dataset.f === 'theme') theme = s.value as ThemeId;
        if (s.dataset.f === 'status') status = s.value;
        if (s.dataset.f === 'severity') severity = s.value;
        shown = 30;
        render();
      }),
    );
    view.querySelector('[data-more]')?.addEventListener('click', () => {
      shown += 30;
      render();
    });
  };
  render();
  let size = app.analyses.size;
  const off = app.on(() => {
    if (app.analyses.size !== size) {
      size = app.analyses.size;
      render();
    }
  });
  return () => {
    off();
    boards.forEach((b) => b.destroy());
  };
}
