// Chapters: the Chess Detectives video course, each followed by practice
// positions taken from YOUR games.

import { app } from '../lib/app';
import { CHANNEL_URL, CHAPTERS, PARTS, PLAYLIST_ID, PLAYLIST_TITLE, PLAYLIST_URL, chapterByEp, practiceFor, recommendChapter, thumb, type Chapter } from '../lib/chapters';
import { THEMES } from '../lib/themes';
import { BADGES, checkBadges } from '../lib/training';
import { miniBoard } from '../ui/board';
import { esc, timeAgo, toast } from '../ui/dom';

const watchedList = () => app.progress?.chapters ?? [];

function practiceLabel(c: Chapter, n: number) {
  if (!app.analyses.size) return 'Analyze games to unlock practice';
  if (!n) return 'No matching positions yet';
  return `${n} practice position${n === 1 ? '' : 's'} from your games`;
}

export function renderChapters(view: HTMLElement, ep?: number) {
  return ep ? renderChapter(view, ep) : renderList(view);
}

function renderList(view: HTMLElement) {
  const mistakes = app.mistakes();
  const watched = watchedList();
  const rec = recommendChapter(mistakes, watched);
  const card = (c: Chapter) => {
    const n = practiceFor(c, mistakes).length;
    const done = watched.includes(c.ep);
    return `<a class="card chapter" href="#/chapters/${c.ep}">
      <div class="ch-thumb"><img src="${thumb(c.videoId)}" alt="" loading="lazy" /><span class="ep">Ep ${c.ep}</span>${done ? '<span class="watched">✓ Watched</span>' : ''}</div>
      <div class="ch-body">
        <strong>${esc(c.title)}</strong>
        <span class="sub">${esc(c.hook)}</span>
        <span class="ch-practice ${n ? 'has' : ''}">🧩 ${esc(practiceLabel(c, n))}</span>
      </div>
    </a>`;
  };
  view.innerHTML = `
    <section class="dash-head">
      <div>
        <h1>Chapters 📺</h1>
        <p class="headline">The Chess Detectives video course — ${esc(PLAYLIST_TITLE)}. Watch a chapter, then practise it on positions from <b>your own games</b>.</p>
      </div>
      <div class="row">
        <span class="sub">${watched.length}/${CHAPTERS.length} watched</span>
        <a class="btn small" href="${PLAYLIST_URL}" target="_blank" rel="noopener">▶ Full playlist on YouTube ↗</a>
      </div>
    </section>
    <div class="bar wide ch-progress" role="progressbar" aria-label="Chapters watched" aria-valuemin="0" aria-valuemax="${CHAPTERS.length}" aria-valuenow="${watched.length}"><i style="width:${(watched.length / CHAPTERS.length) * 100}%"></i></div>
    ${
      rec
        ? `<a class="card rec" href="#/chapters/${rec.ep}">
            <img src="${thumb(rec.videoId)}" alt="" loading="lazy" />
            <div><span class="k-label">🕵️ Professor Pin recommends</span><h2>Ep ${rec.ep}: ${esc(rec.title)}</h2>
            <p class="sub">${mistakes.length ? `It targets the mistakes that show up most in your games.` : 'A great place to start.'} ${esc(rec.learn)}</p></div>
            <span class="btn primary">Start chapter →</span>
          </a>`
        : ''
    }
    ${PARTS.map(
      (p, i) => `<section class="part">
        <h2>${p.icon} Part ${i + 1}: ${esc(p.title)}</h2>
        <div class="chapter-grid">${p.chapters.map((ep) => card(chapterByEp(ep)!)).join('')}</div>
      </section>`,
    ).join('')}
    <p class="sub center">Videos by the <a href="${CHANNEL_URL}" target="_blank" rel="noopener">Chess Detectives YouTube channel</a>.</p>`;
}

function renderChapter(view: HTMLElement, ep: number) {
  const c = chapterByEp(ep);
  if (!c) {
    location.hash = '#/chapters';
    return;
  }
  const boards: { destroy(): void }[] = [];
  const render = () => {
    boards.splice(0).forEach((b) => b.destroy());
    const p = app.progress!;
    const practice = practiceFor(c, app.mistakes());
    const watched = watchedList().includes(c.ep);
    const prev = chapterByEp(c.ep - 1);
    const next = chapterByEp(c.ep + 1);
    const solved = practice.filter((m) => (p.cards[m.id]?.solved ?? 0) > 0).length;
    const themeNames = c.themes.length > 6 ? 'all themes' : c.themes.map((t) => `${THEMES[t].icon} ${THEMES[t].title}`).join(' · ');
    view.innerHTML = `
      <nav class="crumbs"><a href="#/chapters">← All chapters</a></nav>
      <section class="chapter-page">
        <div class="video-col">
          <div class="video" data-video>
            <button class="video-poster" aria-label="Play episode ${c.ep}: ${esc(c.title)}">
              <img src="https://i.ytimg.com/vi/${c.videoId}/hqdefault.jpg" alt="" />
              <span class="play">▶</span>
            </button>
          </div>
          <div class="row ch-actions">
            <button class="btn ${watched ? '' : 'primary'}" data-watched ${watched ? 'disabled' : ''}>${watched ? '✓ Watched' : 'Mark as watched (+20 XP)'}</button>
            <a class="btn ghost small" href="https://www.youtube.com/watch?v=${c.videoId}&list=${PLAYLIST_ID}" target="_blank" rel="noopener">Open on YouTube ↗</a>
          </div>
        </div>
        <div class="ch-info card">
          <span class="k-label">Chapter ${c.ep} of ${CHAPTERS.length}</span>
          <h1>${esc(c.title)}</h1>
          <p class="hook">“${esc(c.hook)}”</p>
          <p>${esc(c.learn)}</p>
          <p class="sub">Practice themes: ${esc(themeNames)}</p>
        </div>
      </section>

      <section class="card practice">
        <div class="practice-head">
          <div>
            <h2>🧩 Practise it on your own games</h2>
            <p class="sub">${
              practice.length
                ? `${practice.length} position${practice.length === 1 ? '' : 's'} from ${c.pickLabel ?? 'your games'} where this chapter’s idea was the key. ${solved ? `You’ve solved ${solved}.` : ''}`
                : app.analyses.size
                  ? '🎉 None of your analyzed games has this kind of mistake. Analyze more games, or move on to the next chapter.'
                  : 'Analyze some games on the dashboard first — then your practice positions appear here.'
            }</p>
          </div>
          ${practice.length ? `<a class="btn primary" href="#/train?chapter=${c.ep}">Start practice (${Math.min(6, practice.length)}) →</a>` : `<a class="btn" href="#/dashboard">Go to dashboard</a>`}
        </div>
        ${
          practice.length
            ? `<div class="case-grid">${practice
                .slice(0, 8)
                .map((m) => {
                  const done = (p.cards[m.id]?.solved ?? 0) > 0;
                  return `<a class="case card" href="#/train/${encodeURIComponent(m.id)}">
                    <div class="mini-host" data-fen="${esc(m.fenBefore)}" data-or="${m.userColor}"></div>
                    <div class="case-info">
                      <div class="case-top"><span class="sev ${m.severity}">${m.severity}</span>${done ? '<span class="solved">✓ solved</span>' : '<span class="new">practice</span>'}</div>
                      <span class="meta">📅 ${timeAgo(m.endTime)} vs ${esc(app.gameOf(m)?.opponent ?? 'opponent')}</span>
                      <span class="meta">Move ${m.moveNumber} · ${esc(m.timeClass)}</span>
                    </div>
                  </a>`;
                })
                .join('')}</div>`
            : ''
        }
      </section>

      <nav class="ch-nav">
        ${prev ? `<a class="btn ghost" href="#/chapters/${prev.ep}">← Ep ${prev.ep}: ${esc(prev.title)}</a>` : '<span></span>'}
        ${next ? `<a class="btn ghost" href="#/chapters/${next.ep}">Ep ${next.ep}: ${esc(next.title)} →</a>` : ''}
      </nav>`;

    view.querySelectorAll<HTMLElement>('.mini-host').forEach((h) => boards.push(miniBoard(h, h.dataset.fen!, h.dataset.or as 'white' | 'black')));
    // Load the YouTube player only when asked (faster, and no tracking before you press play).
    view.querySelector('.video-poster')!.addEventListener('click', () => {
      const host = view.querySelector('[data-video]')!;
      host.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${c.videoId}?autoplay=1&rel=0&list=${PLAYLIST_ID}" title="${esc(c.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
    });
    view.querySelector('[data-watched]')!.addEventListener('click', async () => {
      const list = new Set(p.chapters ?? []);
      if (list.has(c.ep)) return;
      list.add(c.ep);
      p.xp += 20;
      toast(`📺 Chapter ${c.ep} done · +20 XP${practice.length ? ' — now practise it on your own games!' : ''}`, 'win');
      p.chapters = [...list].sort((a, b) => a - b);
      for (const b of checkBadges(p)) toast(`${BADGES[b].icon} <b>Badge unlocked:</b> ${esc(BADGES[b].title)}`, 'win', 5000);
      await app.saveProgress();
      render();
    });
  };
  render();
  return () => boards.forEach((b) => b.destroy());
}
