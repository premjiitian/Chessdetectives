// Repertoire: your openings for White and Black, upgraded with engine-best
// moves, explained by Professor Pin, and practised move by move.

import { app } from '../lib/app';
import { describeMove, evalWords } from '../lib/coach';
import { getEngine } from '../lib/engine';
import { winPercent } from '../lib/evaluation';
import { allLines, buildRepertoire, countMoves, type RepMove, type Repertoire } from '../lib/repertoire';
import * as store from '../lib/store';
import { shuffle } from '../lib/training';
import type { Color } from '../lib/types';
import { Board } from '../ui/board';
import { $, esc, md, toast } from '../ui/dom';
import { speak, stop as stopVoice, voiceControl } from '../lib/voice';

const KIND: Record<RepMove['kind'], { badge: string; cls: string }> = {
  yours: { badge: '✓ your move', cls: 'yours' },
  upgrade: { badge: '⬆ upgrade', cls: 'upgrade' },
  engine: { badge: '★ Stockfish', cls: 'engine' },
  reply: { badge: 'opponent', cls: 'reply' },
  'engine-reply': { badge: 'opponent (Stockfish)', cls: 'reply' },
};

const repKey = (color: Color) => `repertoire:${app.username}:${color}`;
const pct = (x: number | null) => (x === null ? '' : `${Math.round(x * 100)}%`);
const moveNo = (m: RepMove) => (m.ply % 2 ? `${Math.ceil(m.ply / 2)}.` : `${Math.ceil(m.ply / 2)}...`);

export function renderRepertoire(view: HTMLElement, params: URLSearchParams) {
  const color: Color = params.get('color') === 'black' ? 'black' : 'white';
  const practice = params.has('practice');
  let board: Board | null = null;
  let destroyed = false;
  let rep: Repertoire | undefined;

  const header = (extra = '') => `
    <section class="dash-head">
      <div>
        <h1>Repertoire 📚</h1>
        <p class="headline">Your openings, upgraded. Professor Pin keeps your favourite moves when they're good and suggests stronger ones (chosen by Stockfish 19) when they're not.</p>
      </div>
      <div class="tabs" role="tablist">
        <a role="tab" class="${color === 'white' ? 'on' : ''}" href="#/repertoire?color=white">♔ As White</a>
        <a role="tab" class="${color === 'black' ? 'on' : ''}" href="#/repertoire?color=black">♚ As Black</a>
      </div>
    </section>${extra}`;

  async function start() {
    rep = await store.get<Repertoire>(repKey(color));
    if (destroyed) return;
    if (!rep) return renderEmpty();
    if (practice) return renderPractice(rep);
    renderBrowse(rep);
  }

  function renderEmpty() {
    const n = app.games.filter((g) => g.userColor === color).length;
    view.innerHTML = header(`
      <section class="card empty-state rep-empty">
        <div class="big-ico">${color === 'white' ? '♔' : '♚'}</div>
        <h2>Build your ${color === 'white' ? 'White' : 'Black'} repertoire</h2>
        <p>Professor Pin looks at the <b>${n} games</b> you played as ${color} to find your usual openings. Then Stockfish checks every one of your moves:
        good ones stay (that's your style), weak ones get an upgrade. It takes about half a minute.</p>
        <button class="btn primary big" data-build ${n ? '' : 'disabled'}>Build my ${color} repertoire</button>
        ${n ? '' : '<p class="sub">No games as ' + color + ' yet — play a few or pick a longer period on the dashboard.</p>'}
        <div class="bar wide" hidden><i style="width:0%"></i></div>
        <p class="sub build-status" aria-live="polite"></p>
      </section>`);
    view.querySelector('[data-build]')?.addEventListener('click', build);
  }

  async function build() {
    const btn = view.querySelector<HTMLButtonElement>('[data-build]');
    const bar = view.querySelector<HTMLElement>('.bar');
    const status = view.querySelector<HTMLElement>('.build-status');
    if (btn) btn.disabled = true;
    if (bar) bar.hidden = false;
    const engine = getEngine();
    try {
      const built = await buildRepertoire(app.games, color, async (fen, depth, multipv) => (await engine.search(fen, { depth, multipv })).lines, {
        depth: 13,
        maxNodes: 36,
        onProgress: (d, b) => {
          if (bar) (bar.firstElementChild as HTMLElement).style.width = `${Math.min(100, (d / b) * 100)}%`;
          if (status) status.textContent = `Checking your moves… ${d} positions`;
        },
      });
      if (destroyed) return;
      await store.set(repKey(color), built);
      toast(`📚 Your ${color} repertoire is ready: ${countMoves(built).lines} lines.`, 'win');
      rep = built;
      renderBrowse(built);
    } catch (e) {
      if (status) status.textContent = `Something went wrong: ${(e as Error).message}`;
      if (btn) btn.disabled = false;
    }
  }

  function renderBrowse(r: Repertoire) {
    const c = countMoves(r);
    const lines = allLines(r);
    view.innerHTML = header(`
      <div class="trainer rep">
        <div class="board-col">
          <div class="board-wrap"><div class="evalbar" aria-hidden="true"><i></i><span></span></div><div id="board"></div></div>
          <div class="board-actions">
            <a class="btn primary" href="#/repertoire?color=${color}&practice=1">🎯 Practise this repertoire</a>
            <a class="btn ghost small" data-play href="#/play">♟️ Play from here vs Stockfish</a>
          </div>
        </div>
        <aside class="coach-col">
          <div class="card rep-summary">
            <p><b>${c.lines} lines</b> from <b>${r.games} of your games</b> as ${color}: ${c.yours} of your moves kept <span class="rk yours">✓ your style</span>, ${c.upgrades} upgrade${c.upgrades === 1 ? '' : 's'} <span class="rk upgrade">⬆</span>, Stockfish fills the gaps <span class="rk engine">★</span>.</p>
            <button class="btn small ghost" data-rebuild>↻ Rebuild with my latest games</button>
          </div>
          <div class="card rep-note" aria-live="polite"><p class="sub">Tap any move to see the position and why it's in your repertoire.</p></div>
          <div class="rep-lines">${lines
            .map((line, i) => {
              const prev = lines[i - 1] ?? [];
              const shared = line.findIndex((m, k) => prev[k] !== m);
              const name = [...line].reverse().find((m) => m.opening)?.opening ?? 'Your line';
              return `<div class="card rep-line"><div class="rep-title">${esc(name)}</div><div class="rep-moves">${line
                .map((m, k) => `<button class="mv ${KIND[m.kind].cls} ${k < shared ? 'shared' : ''}" data-line="${i}" data-k="${k}" title="${esc(KIND[m.kind].badge)}">${k === 0 || m.ply % 2 ? `<span class="no">${moveNo(m)}</span>` : ''}${esc(m.san)}</button>`)
                .join('')}</div></div>`;
            })
            .join('')}</div>
          <p class="sub">Moves marked ⬆ and ★ are Stockfish 19's choice (far stronger than any grandmaster) — not a database of master games.</p>
        </aside>
      </div>`);
    board = new Board($(view, '#board'), { fen: r.root.fen, orientation: color, interactive: false });
    const note = $(view, '.rep-note');
    const evalbar = $(view, '.evalbar');
    const show = (line: RepMove[], k: number) => {
      const m = line[k];
      const before = k ? line[k - 1].fen : r.root.fen;
      board!.setPosition(m.fen, [m.uci.slice(0, 2), m.uci.slice(2, 4)]);
      view.querySelectorAll('.mv.on').forEach((b) => b.classList.remove('on'));
      view.querySelector(`.mv[data-line="${lines.indexOf(line)}"][data-k="${k}"]`)?.classList.add('on');
      (view.querySelector('[data-play]') as HTMLAnchorElement).href = `#/play?fen=${encodeURIComponent(m.fen)}&color=${color}`;
      const mine = m.kind === 'yours' || m.kind === 'upgrade' || m.kind === 'engine';
      const facts = mine ? describeMove(before, m.uci, 'you', m.evalLine?.uci ?? []).facts : describeMove(before, m.uci, 'opponent').facts;
      let html = `<div class="case-top"><span class="rk ${KIND[m.kind].cls}">${KIND[m.kind].badge}</span><b>${moveNo(m)} ${esc(m.san)}</b>${m.opening && m.ply >= 4 ? ` <span class="sub">· ${esc(m.opening)}</span>` : ''}</div>`;
      if (m.kind === 'yours') html += `<p>You played this <b>${m.count}×</b>${m.score !== null ? ` and scored <b>${pct(m.score)}</b>` : ''}. Stockfish agrees it's a good move — keep it!</p>`;
      if (m.kind === 'upgrade' && m.usual)
        html += `<p>You usually play <b>${esc(m.usual.san)}</b> here (${m.usual.count}×${m.usual.score !== null ? `, scoring ${pct(m.usual.score)}` : ''}). <b>${esc(m.san)}</b> is stronger: about ${m.bestWin}% winning chances instead of ${m.usual.win}%.</p>`;
      if (m.kind === 'engine') html += `<p>Your games don't reach this position yet, so here is Stockfish's choice to be ready.</p>`;
      if (m.kind === 'reply') html += `<p>Your opponents played this <b>${m.count}×</b>${m.score !== null ? ` — you scored ${pct(m.score)} in those games` : ''}. Be ready for it.</p>`;
      if (m.kind === 'engine-reply') html += `<p>Stockfish's most testing reply — prepare for it even if you haven't met it yet.</p>`;
      if (facts.length) html += `<p>${md(`**Why:** ${facts.join(' ')}`)}</p>`;
      if (mine && m.evalLine) {
        html += `<p class="eval-line">📊 After this move: ${esc(evalWords(m.evalLine))}.</p>`;
        (evalbar.querySelector('i') as HTMLElement).style.height = `${winPercent(m.evalLine)}%`;
      }
      note.innerHTML = html;
    };
    view.querySelectorAll<HTMLButtonElement>('.mv').forEach((b) => b.addEventListener('click', () => show(lines[+b.dataset.line!], +b.dataset.k!)));
    view.querySelector('[data-rebuild]')!.addEventListener('click', async () => {
      await store.del(repKey(color));
      board?.destroy();
      board = null;
      renderEmpty();
      build();
    });
    evalbar.classList.toggle('black', color === 'black');
  }

  function renderPractice(r: Repertoire) {
    const lines = shuffle(allLines(r));
    let li = 0;
    let k = 0;
    let firstTry = true;
    let correct = 0;
    let total = 0;
    view.innerHTML = header(`
      <div class="trainer rep">
        <div class="board-col">
          <div class="board-wrap"><div class="evalbar" aria-hidden="true"><i></i><span></span></div><div id="board"></div></div>
          <div class="board-actions"><a class="btn ghost small" href="#/repertoire?color=${color}">← Back to my repertoire</a></div>
        </div>
        <aside class="coach-col">
          <div class="card case-head"><h2>🎯 Practise your ${color} repertoire</h2><p class="meta rep-progress"></p></div>
          <div class="voice-slot"></div>
          <div class="feed card" aria-live="polite"></div>
          <div class="controls"><button class="btn" data-show>💡 Show my move</button><button class="btn primary" data-next hidden>Next line →</button></div>
        </aside>
      </div>`);
    $(view, '.voice-slot').append(voiceControl());
    const feed = $(view, '.feed');
    const say = (html: string, cls = 'coach') => {
      const d = document.createElement('div');
      d.className = `msg ${cls}`;
      d.innerHTML = html;
      feed.append(d);
      feed.scrollTop = feed.scrollHeight;
      speak(d.textContent ?? '');
    };
    board = new Board($(view, '#board'), { fen: r.root.fen, orientation: color, onMove: onMove });
    const progress = () => ($(view, '.rep-progress').textContent = `Line ${li + 1} of ${lines.length} · ${correct}/${total} first-try moves`);

    // Hook for the automated browser test (tests/repertoire.mjs).
    (window as any).__rep = () => ({ expected: lines[li]?.[k]?.uci ?? null, interactive: !!lines[li]?.[k] && !['reply', 'engine-reply'].includes(lines[li][k].kind), li, k });
    function step() {
      if (destroyed || !board) return;
      const line = lines[li];
      const m = line[k];
      progress();
      if (!m) return lineDone();
      const theirs = m.kind === 'reply' || m.kind === 'engine-reply';
      if (theirs) {
        board.setInteractive(false);
        setTimeout(() => {
          if (destroyed || !board) return;
          board.play(m.uci);
          k++;
          step();
        }, 450);
      } else {
        firstTry = true;
        board.setInteractive(true);
      }
    }

    function onMove(uci: string) {
      const m = lines[li][k];
      if (!board || !m) return;
      stopVoice();
      const same = uci.slice(0, 4) === m.uci.slice(0, 4);
      if (same) {
        board.shapes([]);
        board.play(m.uci);
        total++;
        if (firstTry) correct++;
        say(`<p>✅ <b>${esc(m.san)}</b> — ${m.kind === 'yours' ? 'your move, well remembered!' : m.kind === 'upgrade' ? 'the upgrade — great!' : 'right, the prepared move.'}</p>`, 'good');
        k++;
        step();
      } else {
        firstTry = false;
        board.sync();
        const before = k ? lines[li][k - 1].fen : r.root.fen;
        const why = describeMove(before, m.uci, 'you', m.evalLine?.uci ?? []).facts[0] ?? '';
        board.shapes([board.arrow(m.uci.slice(0, 2), m.uci.slice(2, 4), 'green')]);
        say(`<p>Not this one. In your repertoire the move is <b>${esc(m.san)}</b>. ${md(why)}</p><p class="sub">Play it on the board to continue.</p>`, 'alt');
      }
    }

    async function lineDone() {
      board!.setInteractive(false);
      const p = app.progress;
      const xp = Math.max(2, correct * 2 - (total - correct));
      if (p) {
        p.xp += Math.max(0, xp);
        await app.saveProgress();
      }
      say(`<p>🏁 Line complete! ${correct}/${total} moves on the first try · <b>+${Math.max(0, xp)} XP</b></p>`, 'lesson');
      $(view, '[data-next]').hidden = li + 1 >= lines.length;
      if (li + 1 >= lines.length) say('<p>🎉 You went through your whole repertoire. Come back tomorrow to keep it fresh!</p>', 'lesson');
    }

    $(view, '[data-show]').addEventListener('click', () => {
      const m = lines[li][k];
      if (!m || !board) return;
      firstTry = false;
      board.shapes([board.arrow(m.uci.slice(0, 2), m.uci.slice(2, 4), 'blue')]);
    });
    $(view, '[data-next]').addEventListener('click', () => {
      li++;
      k = 0;
      correct = 0;
      total = 0;
      feed.innerHTML = '';
      $(view, '[data-next]').hidden = true;
      board!.setPosition(r.root.fen);
      board!.shapes([]);
      step();
    });
    say(`<p>I'll play your opponents' moves. You play <b>your repertoire</b> as ${color}. Let's go!</p>`);
    step();
  }

  start();
  return () => {
    destroyed = true;
    stopVoice();
    board?.destroy();
  };
}
