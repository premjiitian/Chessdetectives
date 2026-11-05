import { app, LIVE_TIME_CLASSES, PERIODS, TIME_CLASSES, type PeriodId } from '../lib/app';
import { headline, periodStats, weeklyTrend, type WeekPoint } from '../lib/stats';
import { THEMES } from '../lib/themes';
import { recommendChapter, thumb } from '../lib/chapters';
import { buildSession } from '../lib/training';
import { esc, toast } from '../ui/dom';

let period: PeriodId = '30d';
try {
  period = (localStorage.getItem('period') as PeriodId) || '30d';
} catch {}

export function renderDashboard(view: HTMLElement, params: URLSearchParams) {
  let sig = '';
  const days = () => PERIODS.find((p) => p.id === period)!.days;

  const render = () => {
    const d = days();
    const games = app.gamesIn(d);
    const prev = period === '3y' ? null : app.gamesIn(d, d);
    const s = periodStats(games, prev, app.analyses);
    const allMistakes = app.mistakes();
    const session = app.progress ? buildSession(app.progress, allMistakes) : [];
    const due = app.progress ? allMistakes.filter((m) => app.progress!.cards[m.id] && app.progress!.cards[m.id].due <= Date.now()).length : 0;
    const pending = games.filter((g) => !app.analyses.has(g.id)).length;
    const maxTheme = Math.max(1, ...s.themes.map((t) => t.count));
    const totalPhase = Math.max(1, s.phases.opening + s.phases.middlegame + s.phases.endgame);
    const name = app.profile?.name?.split(' ')[0] || app.profile?.username || app.username;
    const pct = (n: number) => Math.round(n * 100);
    const liveOnly = app.timeClasses.length === 3 && LIVE_TIME_CLASSES.every((t) => app.timeClasses.includes(t));

    view.innerHTML = `
    <section class="dash-head">
      <div>
        <h1>${(app.progress?.xp ?? 0) > 0 || app.analyses.size > 25 ? 'Welcome back' : 'Welcome'}, ${esc(name)} 👋</h1>
        <p class="headline">${esc(app.job && s.analyzed < 5 ? `Professor Pin is studying your games (${s.analyzed} of ${s.games} done) — your patterns appear here as clues come in.` : !games.length ? 'First, let’s find your games — see the box below.' : headline(s))}</p>
      </div>
      <div class="tabs" role="tablist">
        ${PERIODS.map((p) => `<button role="tab" data-period="${p.id}" class="${p.id === period ? 'on' : ''}">${p.label}</button>`).join('')}
      </div>
    </section>

    <section class="speeds" aria-label="Game types">
      <span class="sp-label">Game types:</span>
      ${TIME_CLASSES.map((t) => {
        const on = app.timeClasses.includes(t.id);
        const n = app.games.filter((g) => (g.timeClass === t.id || (t.id === 'daily' && !['bullet', 'blitz', 'rapid'].includes(g.timeClass))) && g.endTime > Date.now() / 1000 - d * 86400).length;
        return `<button class="sp ${on ? 'on' : ''}" data-tc="${t.id}" aria-pressed="${on}">${t.icon} ${t.label} <small>${n}</small></button>`;
      }).join('')}
      <button class="btn small ghost" data-live ${liveOnly ? 'disabled' : ''}>Live games only</button>
      ${app.timeClasses.length < TIME_CLASSES.length ? '<button class="btn small ghost" data-all>Show all</button>' : ''}
    </section>

    <section class="status card">
      ${statusHtml(games.length, s.analyzed, pending)}
    </section>

    ${
      (app.progress?.xp ?? 0) < 150
        ? `<section class="path card" aria-label="How to use Chess Detectives">
            <span class="k-label">Your detective path</span>
            <ol>
              <li class="${(app.progress?.chapters?.length ?? 0) > 0 ? 'done' : ''}"><a href="#/chapters"><span>📺</span><b>Watch a chapter</b><small>Professor Pin explains one idea</small></a></li>
              <li class="${Object.keys(app.progress?.cards ?? {}).length > 0 ? 'done' : ''}"><a href="#/train"><span>🧩</span><b>Solve your own cases</b><small>Puzzles from your games</small></a></li>
              <li><a href="#/play"><span>♟️</span><b>Prove it vs Stockfish</b><small>Play the position out</small></a></li>
            </ol>
          </section>`
        : ''
    }

    <section class="grid-2">
      <a class="card cta" href="#/train">
        <div class="cta-ico">🧩</div>
        <div>
          <h2>Today's case files</h2>
          <p>${session.length ? `${session.length} puzzles from your own games are waiting${due ? ` · ${due} review${due > 1 ? 's' : ''} due` : ''}.` : 'Analyze a few games to unlock your personal puzzles.'}</p>
        </div>
        ${session.length ? '<span class="btn primary">Start training →</span>' : `<span class="sub">${app.job ? '⏳ Puzzles appear as games are analyzed' : games.length ? 'Press “Analyze” above to find your puzzles' : 'Your puzzles appear once your games are in (see above)'}</span>`}
      </a>
      ${(() => {
        const rec = recommendChapter(app.mistakes(d), app.progress?.chapters ?? []);
        return rec
          ? `<a class="card coach-note rec-mini" href="#/chapters/${rec.ep}"><img src="${thumb(rec.videoId)}" alt="" loading="lazy" /><div><h3>🕵️ Professor Pin's note</h3><p>${s.themes[0] ? esc(THEMES[s.themes[0].id].lesson) : 'The fastest way to improve is to stop repeating the same mistake.'}</p><p class="rec-line">📺 Watch <b>Ep ${rec.ep}: ${esc(rec.title)}</b>, then practise it on your games →</p></div></a>`
          : '';
      })()}
      <div class="card coach-note" hidden>
        <div class="coach-face">🕵️</div>
        <div>
          <h3>Professor Pin's note</h3>
          <p>${s.themes[0] ? esc(THEMES[s.themes[0].id].lesson) : 'Play, then let us investigate. The fastest way to improve is to stop repeating the same mistake — and you can only fix what you can see.'}</p>
        </div>
      </div>
    </section>

    <section class="kpis">
      ${kpi('Games', String(s.games), `${s.wins}W · ${s.draws}D · ${s.losses}L`)}
      ${kpi('Accuracy', s.accuracy === null ? '—' : `${s.accuracy}%`, s.analyzed ? `${s.analyzed} games analyzed` : 'not analyzed yet')}
      ${kpi('Mistakes / game', s.mistakesPerGame === null ? '—' : s.mistakesPerGame.toFixed(1), 'mistakes + blunders')}
      ${kpi('Blunders / game', s.blundersPerGame === null ? '—' : s.blundersPerGame.toFixed(1), 'big swings (≥20%)')}
      ${kpi('Rating', s.ratingNow === null ? '—' : String(s.ratingNow), s.ratingChange === null ? '' : `${s.ratingChange >= 0 ? '▲' : '▼'} ${Math.abs(s.ratingChange)} this period`, s.ratingChange !== null && s.ratingChange < 0 ? 'down' : 'up')}
    </section>

    ${trendCard(weeklyTrend(app.gamesIn(Math.max(d, 84)), app.analyses, Math.min(26, Math.max(6, Math.round(Math.max(d, 84) / 7)))))}

    <section class="grid-main">
      <div class="card">
        <h2>Your most frequent mistakes</h2>
        <p class="sub">What keeps coming back in the last ${esc(PERIODS.find((p) => p.id === period)!.label)}${prev ? ', compared with the period before' : ''}.</p>
        ${
          s.themes.length
            ? `<ol class="themes">${s.themes
                .map((t) => {
                  const info = THEMES[t.id];
                  const trend =
                    t.prevPerGame === null
                      ? ''
                      : t.perGame < t.prevPerGame * 0.9
                        ? `<span class="trend good" title="per game, vs previous period">▼ improving</span>`
                        : t.perGame > t.prevPerGame * 1.1
                          ? `<span class="trend bad" title="per game, vs previous period">▲ more often</span>`
                          : `<span class="trend">● steady</span>`;
                  return `<li>
                    <span class="t-ico">${info.icon}</span>
                    <div class="t-body">
                      <div class="t-row"><strong>${esc(info.title)}</strong> ${trend}</div>
                      <div class="bar"><i style="width:${(t.count / maxTheme) * 100}%"></i></div>
                      <div class="t-meta">${t.count}× · ${t.perGame.toFixed(2)} per game${t.blunders ? ` · ${t.blunders} blunder${t.blunders > 1 ? 's' : ''}` : ''}</div>
                    </div>
                    <a class="btn small" href="#/train?theme=${t.id}">Train</a>
                  </li>`;
                })
                .join('')}</ol>`
            : `<div class="empty">${s.analyzed ? '🎉 No real mistakes found in this period.' : 'Analyze games to reveal your patterns.'}</div>`
        }
      </div>
      <div class="side">
        <div class="card">
          <h2>When do mistakes happen?</h2>
          ${(['opening', 'middlegame', 'endgame'] as const)
            .map(
              (ph) => `<div class="phase"><span>${ph[0].toUpperCase() + ph.slice(1)}</span><div class="bar"><i style="width:${(s.phases[ph] / totalPhase) * 100}%"></i></div><b>${s.phases[ph]}</b></div>`,
            )
            .join('')}
          ${s.analyzed ? `<p class="sub clock">⏱ ${pct(s.timePressure)}% of your mistakes came with less than 10% of your clock left.${s.timePressure > 0.3 ? ' Try a slower time control or move faster in the opening.' : ''}</p>` : ''}
        </div>
        <div class="card">
          <h2>Openings</h2>
          ${
            s.openings.length
              ? `<table class="openings"><thead><tr><th>Opening</th><th>Games</th><th>Score</th></tr></thead><tbody>${s.openings
                  .map((o) => `<tr><td>${esc(o.name)}</td><td>${o.games}</td><td><span class="score ${o.score >= 0.5 ? 'good' : 'bad'}">${pct(o.score)}%</span></td></tr>`)
                  .join('')}</tbody></table>`
              : '<div class="empty">No games yet.</div>'
          }
        </div>
      </div>
    </section>`;

    view.querySelectorAll<HTMLButtonElement>('[data-period]').forEach((b) => b.addEventListener('click', () => setPeriod(b.dataset.period as PeriodId)));
    view.querySelectorAll<HTMLButtonElement>('[data-tc]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.tc!;
        const next = app.timeClasses.includes(id) ? app.timeClasses.filter((t) => t !== id) : [...app.timeClasses, id];
        if (!next.length) return toast('Keep at least one game type switched on.', 'info');
        app.setTimeClasses(next);
      }),
    );
    view.querySelector('[data-live]')?.addEventListener('click', () => app.setTimeClasses(LIVE_TIME_CLASSES));
    view.querySelectorAll('[data-all]').forEach((b) =>
      b.addEventListener('click', () => {
        app.setTimeClasses([]);
        if (!app.job && app.gamesIn(days()).some((g) => !app.analyses.has(g.id))) app.analyze(days(), 20);
      }),
    );
    view.querySelector<HTMLButtonElement>('[data-period-go]')?.addEventListener('click', (e) => setPeriod((e.currentTarget as HTMLElement).dataset.periodGo as PeriodId));
    view.querySelector('[data-analyze]')?.addEventListener('click', (e) => {
      const n = Number((e.currentTarget as HTMLElement).dataset.analyze);
      app.analyze(days(), n);
    });
    view.querySelector('[data-stop]')?.addEventListener('click', () => app.stopAnalysis());
    view.querySelector('[data-sync]')?.addEventListener('click', () => app.ensureGames(days(), true).catch((e) => toast(esc(e.message), 'warn')));
    view.querySelector<HTMLSelectElement>('[data-depth]')?.addEventListener('change', (e) => app.setDepth(Number((e.target as HTMLSelectElement).value)));
    sig = signature();
  };

  async function setPeriod(id: PeriodId) {
    period = id;
    try {
      localStorage.setItem('period', period);
    } catch {}
    render();
    try {
      await app.ensureGames(days());
      if (!app.job && app.analyses.size === 0 && app.gamesIn(days()).length) app.analyze(days(), 20);
    } catch (e) {
      toast(esc((e as Error).message), 'warn');
    }
  }

  const signature = () => `${app.timeClasses.join(',')}|${app.games.length}|${app.analyses.size}|${app.job?.done ?? '-'}|${app.job ? 1 : 0}|${app.fetching ? 1 : 0}|${period}|${app.progress?.xp}`;

  const statusHtml = (games: number, analyzed: number, pending: number) => {
    if (app.fetching) {
      const f = app.fetching;
      return `<div class="st-row"><span class="spin"></span><div class="st-text"><b>Collecting evidence from chess.com…</b><span>Month ${f.done} of ${f.total}</span></div><div class="bar wide"><i style="width:${(f.done / Math.max(1, f.total)) * 100}%"></i></div></div>`;
    }
    if (app.job) {
      const j = app.job;
      const frac = (j.done + (j.plyDone && j.plyTotal ? j.plyDone / j.plyTotal : 0)) / j.total;
      return `<div class="st-row"><span class="spin"></span><div class="st-text"><b>Stockfish is investigating game ${j.done + 1} of ${j.total}</b><span>${esc(j.current ?? '')} · you can start training already</span></div><div class="bar wide"><i id="job-bar" style="width:${frac * 100}%"></i></div><button class="btn small ghost" data-stop>Pause</button></div>`;
    }
    if (!games) return emptyHtml();
    const newest = app.games[0]?.endTime;
    const lastGame = newest && newest < Date.now() / 1000 - 30 * 86400 ? ` · last game ${new Date(newest * 1000).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}` : '';
    const sync = (app.lastSync() ? `Synced ${new Date(app.lastSync()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Not synced yet') + lastGame;
    return `<div class="st-row">
      <span class="st-ico">${pending ? '🔎' : '✅'}</span>
      <div class="st-text"><b>${analyzed} of ${games} games analyzed</b><span>${sync} · <a href="javascript:void 0" data-sync>refresh</a></span></div>
      <label class="depth">Depth <select data-depth>
        ${[[8, 'Fast'], [10, 'Balanced'], [13, 'Deep']].map(([v, l]) => `<option value="${v}" ${app.depth === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select></label>
      ${pending ? `<button class="btn primary small" data-analyze="${Math.min(pending, 25)}">Analyze ${Math.min(pending, 25)} more</button>` : ''}
    </div>`;
  };

  /** Why there is nothing to analyze, and the one tap that fixes it — never a bare "0 of 0". */
  const emptyHtml = () => {
    const d = days();
    const label = PERIODS.find((p) => p.id === period)!.label;
    const inWindow = app.games.filter((g) => g.endTime > Date.now() / 1000 - d * 86400);
    const last = app.games[0]?.endTime ?? app.lastPlayed ?? null;
    const when = last ? new Date(last * 1000).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    const sync = `<a href="javascript:void 0" data-sync>refresh</a>`;
    let msg: string;
    let action = '';
    if (inWindow.length) {
      // Games exist, but the game-type filter hides them all.
      const types = [...new Set(inWindow.map((g) => (['bullet', 'blitz', 'rapid'].includes(g.timeClass) ? g.timeClass : 'daily')))];
      msg = `<b>Your ${inWindow.length} game${inWindow.length === 1 ? '' : 's'} in the last ${esc(label)} ${inWindow.length === 1 ? 'is' : 'are'} ${esc(types.join(' / '))}, which ${types.length === 1 ? 'is' : 'are'} switched off.</b><span>Switch the game type on to analyze ${inWindow.length === 1 ? 'it' : 'them'}.</span>`;
      action = `<button class="btn primary small" data-all>Show all game types</button>`;
    } else if (last && Date.now() / 1000 - last <= 1095 * 86400) {
      const fit = PERIODS.find((p) => app.games.some((g) => g.endTime > Date.now() / 1000 - p.days * 86400 && app.includes(g.timeClass)));
      msg = `<b>No games in the last ${esc(label)}.</b><span>Your last game was on ${esc(when)} · ${sync}</span>`;
      if (fit) action = `<button class="btn primary small" data-period-go="${fit.id}">Look back ${esc(fit.label)}</button>`;
    } else if (last) {
      msg = `<b>Your last chess.com game was on ${esc(when)} — more than 3 years ago.</b><span>Play a few games on chess.com, then come back and ${sync}.</span>`;
    } else {
      msg = `<b>No games found on chess.com for ${esc(app.profile?.username ?? app.username)} yet.</b><span>Play a few games on chess.com, then come back and ${sync}.</span>`;
    }
    return `<div class="st-row"><span class="st-ico">🔍</span><div class="st-text">${msg}</div>${action}</div>`;
  };

  const off = app.on(() => {
    if (signature() !== sig) render();
    else {
      const bar = document.getElementById('job-bar');
      const j = app.job;
      if (bar && j) bar.style.width = `${((j.done + (j.plyDone && j.plyTotal ? j.plyDone / j.plyTotal : 0)) / j.total) * 100}%`;
    }
  });
  render();

  // First visit (or stale data): download games, then analyze the newest ones.
  (async () => {
    try {
      await app.ensureGames(Math.max(120, days()), params.has('first'));
      if (params.has('first') || app.analyses.size === 0) {
        // Plays rarely? Show the shortest period that has games (and say why).
        if (!app.gamesIn(days()).length) {
          const fit = PERIODS.find((p) => app.gamesIn(p.days).length);
          if (fit && fit.id !== period) {
            const from = PERIODS.find((p) => p.id === period)!.label;
            period = fit.id;
            render();
            toast(`No games in the last ${esc(from)}, so here is the last ${esc(fit.label)}.`, 'info', 6000);
          }
        }
        if (app.gamesIn(days()).length) app.analyze(days(), 20);
      }
    } catch (e) {
      toast(esc((e as Error).message), 'warn', 6000);
    }
  })();

  return () => {
    off();
  };
}

function kpi(label: string, value: string, sub: string, cls = '') {
  return `<div class="card kpi"><span class="k-label">${esc(label)}</span><span class="k-value">${esc(value)}</span><span class="k-sub ${cls}">${esc(sub)}</span></div>`;
}

/** Two small charts: accuracy (higher is better) and blunders per game (lower is better). */
function trendCard(points: WeekPoint[]): string {
  const withData = points.filter((p) => p.games > 0);
  if (withData.length < 3) return '';
  const W = 560, H = 120, pad = 22;
  const x = (i: number) => pad + (i * (W - pad * 2)) / Math.max(1, points.length - 1);
  const chart = (key: 'accuracy' | 'blundersPerGame', label: string, better: string, fmt: (v: number) => string) => {
    const vals = points.map((p) => p[key]);
    const real = vals.filter((v): v is number => v !== null);
    const lo = key === 'accuracy' ? Math.max(0, Math.min(...real) - 5) : 0;
    const hi = key === 'accuracy' ? Math.min(100, Math.max(...real) + 5) : Math.max(1, ...real);
    const y = (v: number) => H - pad - ((v - lo) / Math.max(0.0001, hi - lo)) * (H - pad * 2);
    const pts = vals.map((v, i) => (v === null ? null : [x(i), y(v)] as const)).filter((p): p is readonly [number, number] => !!p);
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const first = real.slice(0, Math.ceil(real.length / 2));
    const last = real.slice(Math.floor(real.length / 2));
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const change = avg(last) - avg(first);
    const good = key === 'accuracy' ? change > 0.5 : change < -0.05;
    const bad = key === 'accuracy' ? change < -0.5 : change > 0.05;
    const verdict = good ? `<span class="trend good">✓ improving</span>` : bad ? `<span class="trend bad">⚠ needs attention</span>` : `<span class="trend">● steady</span>`;
    const lastV = real[real.length - 1];
    return `<figure class="spark">
      <figcaption><b>${label}</b> <span class="sub">(${better})</span> ${verdict}</figcaption>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label} by week: latest ${fmt(lastV)}">
        <line x1="${pad}" x2="${W - pad}" y1="${H - pad}" y2="${H - pad}" class="axis" />
        <path d="${path}" class="line ${key}" fill="none" />
        ${pts.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${i === pts.length - 1 ? 4.5 : 3}" class="dot ${key}" />`).join('')}
        <text x="${(pts[pts.length - 1]?.[0] ?? 0) - 4}" y="${(pts[pts.length - 1]?.[1] ?? 0) - 9}" text-anchor="end" class="val">${fmt(lastV)}</text>
      </svg>
    </figure>`;
  };
  return `<section class="card trend-card">
    <h2>Your trend, week by week</h2>
    <p class="sub">${withData.length} weeks with analyzed games. Fixing your own mistakes should push accuracy up and blunders down.</p>
    <div class="sparks">
      ${chart('accuracy', 'Accuracy', 'higher is better', (v) => `${Math.round(v)}%`)}
      ${chart('blundersPerGame', 'Blunders per game', 'lower is better', (v) => v.toFixed(1))}
    </div>
  </section>`;
}
