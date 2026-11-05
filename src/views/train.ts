// The puzzle trainer: your own mistakes, replayed. Find the best move,
// hear why it works, and let Stockfish answer like a real opponent.

import { app } from '../lib/app';
import { parsePgn } from '../lib/analyzer';
import { evalChange, evalWords, explainAlternative, explainBest, explainFailure, hints, moveBrief, numberedLine, QUOTES, type HintStep } from '../lib/coach';
import { getEngine } from '../lib/engine';
import { flip, shortEval, winPercent } from '../lib/evaluation';
import { THEMES } from '../lib/themes';
import { sanOf } from '../lib/tactics';
import { difficultyOf } from '../lib/difficulty';
import { CHAPTERS, chapterByEp, practiceFor, thumb } from '../lib/chapters';
import { buildSession, shuffle, xpFor, countBlunderSolves, recordResult, BADGES, rankOf } from '../lib/training';
import type { EngineLine, MistakeRecord, ThemeId } from '../lib/types';
import { Board } from '../ui/board';
import { $, confetti, esc, longDate, md, timeAgo, timeControlLabel, toast } from '../ui/dom';
import { listenButton, stop as stopVoice, voiceControl } from '../lib/voice';

const ACCEPT = 3; // a move within 3% win chance of the best counts as best
const ALTERNATIVE = 10; // within 10% is a "good alternative"

export function renderTrain(view: HTMLElement, id: string | undefined, params: URLSearchParams) {
  const p = app.progress!;
  const theme = params.get('theme') as ThemeId | null;
  const all = app.mistakes();
  let queue: MistakeRecord[];
  if (id) {
    const m = app.findMistake(id);
    queue = m ? [m] : [];
  } else {
    const chapter = params.get('chapter') ? chapterByEp(Number(params.get('chapter'))) : undefined;
    queue = chapter
      ? (() => {
          const pool = practiceFor(chapter, all);
          const due = pool.filter((m) => !p.cards[m.id] || p.cards[m.id].due <= Date.now());
          return shuffle(due.length ? due : pool).slice(0, 6);
        })()
      : buildSession(p, all, 6, Date.now(), theme ?? undefined);
  }

  if (!queue.length) {
    view.innerHTML = `<div class="card empty-state">
      <div class="big-ico">🕵️</div>
      <h2>${all.length ? 'All cases closed for now!' : 'No cases yet'}</h2>
      <p>${
        all.length
          ? 'You have solved every case that is due. Come back tomorrow for reviews, analyze more games, or spar with Stockfish.'
          : app.job
            ? 'Stockfish is still investigating your games. Your first puzzles will appear here in a moment.'
            : 'Analyze some games on the dashboard and your personal puzzles will appear here.'
      }</p>
      <div class="row"><a class="btn primary" href="#/dashboard">Go to dashboard</a> <a class="btn" href="#/play">Spar with Stockfish</a></div>
    </div>`;
    if (app.job) {
      const off = app.on(() => {
        if (app.mistakes().length) {
          off();
          renderTrain(view, id, params);
        }
      });
      return () => off();
    }
    return;
  }

  view.innerHTML = `
  <div class="trainer">
    <div class="board-col">
      <div class="session-dots">${queue.map((_, i) => `<i data-dot="${i}"></i>`).join('')}</div>
      <div class="board-wrap">
        <div class="evalbar" title="Stockfish evaluation"><i></i><span></span></div>
        <div id="board"></div>
      </div>
      <div class="board-actions">
        <button class="btn ghost small" data-act="flip" title="Flip board">⇅ Flip</button>
        <button class="btn ghost small" data-act="retry">↺ Restart case</button>
        <a class="btn ghost small" data-act="game" target="_blank" rel="noopener">Open game ↗</a>
      </div>
    </div>
    <aside class="coach-col">
      <div class="case-head card"></div>
      <div class="feed card" aria-live="polite"></div>
      <div class="voice-slot"></div>
      <div class="controls">
        <button class="btn" data-act="hint">💡 Hint</button>
        <button class="btn ghost" data-act="solution">Show solution</button>
        <button class="btn primary" data-act="next" hidden>Next case →</button>
      </div>
    </aside>
  </div>`;

  const engine = getEngine();
  $(view, '.voice-slot').append(voiceControl());
  const feed = $(view, '.feed');
  const head = $(view, '.case-head');
  const evalbar = $(view, '.evalbar');
  const btnHint = view.querySelector<HTMLButtonElement>('[data-act=hint]')!;
  const btnSol = view.querySelector<HTMLButtonElement>('[data-act=solution]')!;
  const btnNext = view.querySelector<HTMLButtonElement>('[data-act=next]')!;
  const gameLink = view.querySelector<HTMLAnchorElement>('[data-act=game]')!;

  let index = 0;
  let m: MistakeRecord = queue[0];
  let board: Board | null = null;
  let destroyed = false;
  let busy = false;
  let steps = 0; // correct moves made in this case
  let fails = 0;
  let hintsUsed = 0;
  let revealed = false;
  let solved = false;
  let hintSteps: HintStep[] = [];
  let stepFen = '';
  let top: Promise<EngineLine[]> = Promise.resolve([]);
  let lastMove: [string, string] | undefined;
  let hintsLeft = 0;
  let attempt = 0; // bumps on every move you make; stale work is dropped
  let reviewing = false; // showing what went wrong; any tap returns to the puzzle
  let revealAll = () => {};
  let alwaysShow = false;
  try {
    alwaysShow = localStorage.getItem('always-show-tags') === '1';
  } catch {}
  let firstTop: Promise<EngineLine[]> = Promise.resolve([]);

  /**
   * Adds a coach message. `brief` is the short spoken summary (what went well
   * or wrong, their best answer, both plans): only those messages get a
   * ▶ Listen button, and only they are read when auto-read is on.
   */
  const say = (html: string, kind: 'coach' | 'you' | 'good' | 'bad' | 'alt' | 'lesson' = 'coach', brief = '') => {
    const div = document.createElement('div');
    div.className = `msg ${kind}`;
    div.innerHTML = html;
    const b = brief ? listenButton(brief) : null;
    if (b) div.append(b);
    feed.append(div);
    feed.scrollTop = feed.scrollHeight;
    return div;
  };
  /** Your plan after a wrong move: the theme hint (e.g. "Look at what your opponent could capture next"), so the answer stays hidden. */
  const planHint = () => (hintSteps[1]?.text ?? info().hint).replace(/\*\*/g, '').replace(/^\w/, (x) => x.toLowerCase());
  const info = () => THEMES[m.theme];
  const paras = (lines: string[]) => lines.map((l) => `<p>${md(l)}</p>`).join('');

  const setEval = (line: EngineLine | undefined, sideToMoveIsUser: boolean) => {
    if (!line) return;
    const userLine = sideToMoveIsUser ? line : flip(line);
    const w = winPercent(userLine);
    (evalbar.querySelector('i') as HTMLElement).style.height = `${w}%`;
    evalbar.querySelector('span')!.textContent = shortEval(userLine);
    evalbar.classList.toggle('black', m.userColor === 'black');
  };

  const analyse = (fen: string, depth = 16, multipv = 3) =>
    engine.search(fen, { depth, multipv }).then((r) => r.lines, () => [] as EngineLine[]);

  function load(i: number) {
    index = i;
    m = queue[i];
    steps = fails = hintsUsed = hintsLeft = 0;
    revealed = solved = false;
    busy = false;
    feed.innerHTML = '';
    btnNext.hidden = true;
    btnHint.hidden = btnSol.hidden = false;
    btnHint.disabled = false;
    view.querySelectorAll<HTMLElement>('[data-dot]').forEach((d, k) => {
      d.className = k < i ? 'done' : k === i ? 'now' : '';
    });

    const game = app.gameOf(m);
    gameLink.href = game?.url ?? '#';
    lastMove = undefined;
    if (game) {
      const parsed = parsePgn(game.pgn);
      const prev = parsed.uci[m.ply - 1];
      if (prev) lastMove = [prev.slice(0, 2), prev.slice(2, 4)];
    }
    const info = THEMES[m.theme];
    const diff = difficultyOf(m);
    const card = p.cards[m.id];
    head.innerHTML = `
      <div class="case-top">
        <span class="case-no">${params.get('chapter') ? `📺 Chapter ${params.get('chapter')} practice · ` : ''}Case ${i + 1}/${queue.length}</span>
        <span class="sev ${m.severity}">${m.severity}</span>
        ${card?.attempts ? `<span class="review">↻ review</span>` : '<span class="new">new</span>'}
      </div>
      <h2>${m.userColor === 'white' ? 'White' : 'Black'} to move — find the best move</h2>
      <div class="flashback">
        <div class="fb-ico">📅</div>
        <div>
          <div class="fb-title">Remember this game?</div>
          <div class="fb-when">${esc(longDate(m.endTime))} <span class="sub">· ${timeAgo(m.endTime)}</span></div>
          <div class="fb-who">You (${m.userColor}${game ? `, ${game.userRating}` : ''}) vs <b>${esc(game?.opponent ?? 'opponent')}</b>${game ? ` (${game.opponentRating})` : ''}${game ? ` · <span class="res ${game.result}">${game.result === 'win' ? 'you won' : game.result === 'loss' ? 'you lost' : 'draw'}</span>` : ''}</div>
          <div class="sub">${esc(m.timeClass)}${game ? ` · ${esc(timeControlLabel(game.timeControl))}` : ''} · move ${m.moveNumber} · ${esc(m.opening)}</div>
        </div>
      </div>
      <div class="reveal-row">
        <button class="chip-reveal" data-reveal="difficulty">
          <span class="chip-k">Difficulty</span>
          <span class="chip-hidden">👁 Tap to reveal</span>
          <span class="chip-shown"><span class="stars" aria-hidden="true">${'★'.repeat(diff.level)}${'☆'.repeat(5 - diff.level)}</span> ${esc(diff.label)} · ≈${diff.rating} · up to ${xpFor(diff.level, 'clean')} XP</span>
        </button>
        <button class="chip-reveal" data-reveal="topic">
          <span class="chip-k">Topic</span>
          <span class="chip-hidden">👁 Tap to reveal</span>
          <span class="chip-shown">${info.icon} ${esc(info.title)}</span>
        </button>
        <label class="always"><input type="checkbox" data-always ${alwaysShow ? 'checked' : ''}/> Always show</label>
      </div>
      <p class="diff-why" hidden>Why ${esc(diff.label.toLowerCase())}: ${esc(diff.reasons.join('; '))}.</p>`;
    const reveal = (which: 'difficulty' | 'topic') => {
      head.querySelector(`[data-reveal=${which}]`)?.classList.add('shown');
      if (which === 'difficulty') (head.querySelector('.diff-why') as HTMLElement).hidden = false;
    };
    head.querySelectorAll<HTMLButtonElement>('[data-reveal]').forEach((b) =>
      b.addEventListener('click', () => reveal(b.dataset.reveal as 'difficulty' | 'topic')),
    );
    head.querySelector<HTMLInputElement>('[data-always]')!.addEventListener('change', (e) => {
      alwaysShow = (e.target as HTMLInputElement).checked;
      try {
        localStorage.setItem('always-show-tags', alwaysShow ? '1' : '');
      } catch {}
      if (alwaysShow) (['difficulty', 'topic'] as const).forEach(reveal);
    });
    if (alwaysShow) (['difficulty', 'topic'] as const).forEach(reveal);
    // Training a chosen theme? Then the topic is no secret.
    if (theme) reveal('topic');
    revealAll = () => (['difficulty', 'topic'] as const).forEach(reveal);

    board?.destroy();
    stepFen = m.fenBefore;
    board = new Board($(view, '#board'), { fen: m.fenBefore, orientation: m.userColor, onMove: onUserMove });
    const host = $(view, '#board');
    if (!host.dataset.tapReset) {
      host.dataset.tapReset = '1';
      host.addEventListener('pointerdown', () => reviewing && resetStep(), { capture: true });
    }
    board.sync(lastMove);
    hintSteps = hints(m.fenBefore, m.bestUci, info.hint);
    // Small hook used by the automated browser test (tests/e2e.mjs).
    (window as any).__cd = () => ({ played: m.playedUci, best: m.bestUci, color: m.userColor });
    (window as any).__cdStep = async () => {
      const lines = await top;
      return {
        id: m.id, fen: stepFen, solved, busy, interactive: !!board && !solved && !busy && !reviewing,
        best: lines[0]?.uci[0] ?? null,
        lines: lines.map((l) => ({ uci: l.uci[0], win: Math.round(winPercent(l)) })),
        legal: board ? board.chess.moves({ verbose: true }).map((x) => x.from + x.to + (x.promotion ?? '')) : [],
      };
    };

    const when = timeAgo(m.endTime);
    const flash = game
      ? `<p>Flashback to ${esc(when)}: you had ${m.userColor} against <b>${esc(game.opponent)}</b> (${game.opponentRating}), and ${game.result === 'win' ? 'you won that game' : game.result === 'loss' ? 'you lost that game' : 'it ended in a draw'}.</p>`
      : '';
    stopVoice();
    say(
      `${flash}<p>On move ${m.moveNumber} you played <b class="bad-move">${esc(m.played)}</b>${m.timePressure ? ' (with the clock running low ⏱)' : ''} and your winning chances went from <b>${m.winBefore}%</b> to <b>${m.winAfter}%</b>.</p><p>Let's investigate. Look for checks, captures and threats first — then find a better move.</p>`,
    );
    top = firstTop = analyse(m.fenBefore);
    const thisCase = m;
    top.then((lines) => {
      if (destroyed || thisCase !== m || !lines[0]) return;
      setEval(lines[0], true);
      if (!solved && !busy) say(`<p class="eval-line">${esc(`📊 Right now Stockfish rates this position ${evalWords(lines[0])}. Find the move that keeps it that way.`)}</p>`);
      // The deeper search is the referee: hints follow its best move.
      hintSteps = hints(m.fenBefore, lines[0].uci[0], info.hint);
      // Quality check: if your game move turns out to be fine, skip this case.
      const playedLine = lines.find((l) => l.uci[0] === m.playedUci);
      if (playedLine && winPercent(lines[0]) - winPercent(playedLine) <= ACCEPT) {
        solved = true;
        board?.setInteractive(false);
        app.dismissMistake(m.id);
        btnHint.hidden = btnSol.hidden = true;
        btnNext.hidden = false;
        if (index + 1 < queue.length) {
          // Not a real puzzle: go straight on to the next case.
          say('<p>🔎 On a deeper look, your game move was actually fine — case dismissed! On to the next one…</p>', 'good');
          setTimeout(() => !destroyed && thisCase === m && load(index + 1), 1500);
        } else {
          say('<p>🔎 On a deeper look, your game move was actually fine — the quick scan was too strict. Case dismissed!</p>', 'good');
        }
      }
    });
  }

  async function onUserMove(uci: string) {
    if (!board || busy || solved) return;
    const my = ++attempt;
    reviewing = false;
    // A new move replaces the previous explanation: stop talking, fade old messages.
    stopVoice();
    feed.querySelectorAll('.msg:not(.old)').forEach((el) => el.classList.add('old'));
    busy = true;
    board.setInteractive(false);
    board.shapes([]);
    const fen = stepFen;
    const lines = await top;
    if (destroyed || my !== attempt) return;
    const best = lines[0];
    if (!best) {
      busy = false;
      board.setInteractive(true);
      return;
    }
    // Use the engine's promotion piece if you pushed to the same square.
    const same = lines.find((l) => l.uci[0]?.slice(0, 4) === uci.slice(0, 4));
    if (same) uci = same.uci[0];
    const san = board.play(uci);
    if (!san) {
      busy = false;
      board.setInteractive(true);
      return;
    }
    say(`<p>${esc(san)}</p>`, 'you');

    let line = lines.find((l) => l.uci[0] === uci);
    let reply: EngineLine | undefined;
    if (!line) {
      const after = await analyse(board.chess.fen(), 14, 1);
      if (destroyed || my !== attempt) return;
      reply = after[0];
      line = reply ? { ...flip(reply), uci: [uci, ...reply.uci] } : undefined;
    }
    const bestWin = winPercent(best);
    const myWin = line ? winPercent(line) : 0;
    const gap = bestWin - myWin;
    // The bar follows the move you just tried (your point of view).
    setEval(line ?? best, true);
    const evalLine = line ? `<p class="eval-line">${esc(evalChange(best, line))}</p>` : '';

    if (gap <= ACCEPT || uci === best.uci[0]) {
      await correct(fen, line ?? best);
    } else if (uci === m.playedUci && steps === 0) {
      fails++;
      reviewing = true; // from now on, a tap on the board skips ahead
      const r = reply ?? (line ? { ...flip(line), uci: line.uci.slice(1) } : undefined);
      say(`<p><b>That's the move you played in the game!</b></p>${evalLine}<p>Why? Let's see what your opponent could do:</p>${paras(explainFailure(fen, uci, r))}`, 'bad', line ? `That's your game move. ${moveBrief(fen, line, 'wrong', planHint())}` : '');
      await punish(r, my);
    } else if (gap <= ALTERNATIVE || (myWin >= 55 && gap <= 15)) {
      reviewing = true;
      say(`${paras(explainAlternative(fen, uci, myWin, bestWin))}${line ? `<p class="eval-line">📊 Your move: ${esc(evalWords(line))}. The best move: ${esc(evalWords(best))}.</p>` : ''}`, 'alt', line ? moveBrief(fen, line, 'okay') : '');
      say('<p>↺ Good thinking — now find the even stronger move. The board resets in a moment (or tap it).</p>', 'coach');
      await review(my);
    } else {
      fails++;
      reviewing = true;
      const r = reply ?? (line ? { ...flip(line), uci: line.uci.slice(1) } : undefined);
      say(`<p><b>Not quite.</b> Winning chances would drop to about ${Math.round(myWin)}%.</p>${evalLine}<p>Why?</p>${paras(explainFailure(fen, uci, r))}`, 'bad', line ? `Not quite. ${moveBrief(fen, line, 'wrong', planHint())}` : '');
      await punish(r, my);
    }
  }

  async function punish(r: EngineLine | undefined, my: number) {
    if (!board || destroyed) return;
    const replyMove = r?.uci[0];
    if (replyMove) {
      await sleep(650);
      if (destroyed || my !== attempt || !reviewing) return; // skipped by a tap
      board.play(replyMove);
      board.shapes([board.arrow(replyMove.slice(0, 2), replyMove.slice(2, 4), 'red')]);
    }
    if (!reviewing) return;
    say(`<p>↺ Your turn again${fails >= 2 && hintsUsed < hintSteps.length ? ' — a 💡 hint might help' : ''}. The board resets in a moment (or tap it).</p>`, 'coach');
    await review(my);
  }

  /** Shows the punishment briefly, then puts the puzzle back so you can try again straight away. */
  async function review(my: number) {
    if (!reviewing) return;
    busy = false;
    await sleep(1600);
    if (!destroyed && my === attempt && reviewing) resetStep();
  }

  function resetStep() {
    if (!board) return;
    reviewing = false;
    top.then((l) => !destroyed && setEval(l[0], true));
    board.setPosition(stepFen, steps === 0 ? lastMove : undefined);
    board.shapes([]);
    board.setInteractive(true);
    busy = false;
  }

  async function correct(fen: string, line: EngineLine) {
    if (!board) return;
    steps++;
    const quality = line.uci[0] === (await top)[0]?.uci[0] ? 'the best move' : 'just as strong as the engine move';
    const praise = ['Excellent!', 'Brilliant detective work!', 'Spot on!', 'Yes — that\'s it!'][steps % 4];
    say(`<p><b>${praise}</b> That's ${quality}.</p>${paras(explainBest(fen, line))}<p class="eval-line">${esc(`📊 Evaluation: ${evalWords(line)}.`)}</p>`, 'good', `${praise} ${moveBrief(fen, line, 'good')}`);
    board.shapes([board.arrow(line.uci[0].slice(0, 2), line.uci[0].slice(2, 4), 'green')]);

    const after = board.chess;
    if (after.isGameOver()) return finish();
    // Stockfish answers like a real opponent.
    await sleep(700);
    if (destroyed) return;
    const oppLines = await analyse(after.fen(), 14, 1);
    const reply = oppLines[0]?.uci[0] ?? line.uci[1];
    if (!reply) return finish();
    const replySan = board.play(reply);
    if (!replySan) return finish();
    say(`<p>Stockfish replies <b>${esc(replySan)}</b>.</p>`, 'coach');
    stepFen = board.chess.fen();
    if (board.chess.isGameOver()) return finish();

    // Is there another precise move to find? (Only moves, or a mate to finish.)
    const next = await analyse(stepFen, 15, 2);
    if (destroyed) return;
    const w1 = next[0] ? winPercent(next[0]) : 0;
    const w2 = next[1] ? winPercent(next[1]) : 0;
    const mating = next[0]?.mate !== null && (next[0]?.mate ?? 0) > 0;
    setEval(next[0], true);
    if (steps < 4 && next[0] && (w1 - w2 >= 15 || mating) && w1 > 30) {
      top = Promise.resolve(next);
      hintSteps = hints(stepFen, next[0].uci[0], mating ? THEMES['missed-mate'].hint : 'Keep going: there is one move that keeps the advantage.');
      hintsLeft = 0;
      say(`<p>${mating ? 'Finish the job — there is a forced mate!' : 'Keep going: only one move keeps your advantage. What is it?'}</p>`);
      busy = false;
      board.setInteractive(true);
      return;
    }
    finish();
  }

  btnHint.addEventListener('click', () => {
    if (!board || solved) return;
    const step = hintSteps[Math.min(hintsLeft, hintSteps.length - 1)];
    if (!step) return;
    hintsLeft++;
    hintsUsed++;
    say(`<p>💡 ${md(step.text)}</p>`, 'coach');
    const shapes = [];
    if (step.square) shapes.push(board.circle(step.square, 'yellow'));
    if (step.arrow) {
      shapes.push(board.arrow(step.arrow[0], step.arrow[1], 'blue'));
      revealed = true;
    }
    board.shapes(shapes);
    if (hintsLeft >= hintSteps.length) btnHint.disabled = true;
  });

  btnSol.addEventListener('click', async () => {
    if (!board || solved || busy) return;
    revealed = true;
    resetStep();
    const lines = await top;
    if (!lines[0] || !board) return;
    say(`<p>Here is the solution. Watch the board 👀</p>${paras(explainBest(stepFen, lines[0]))}`, 'alt', moveBrief(stepFen, lines[0], 'good'));
    const mv = lines[0].uci[0];
    board.shapes([board.arrow(mv.slice(0, 2), mv.slice(2, 4), 'blue')]);
    await sleep(900);
    board.play(mv);
    finish();
  });

  async function finish() {
    if (solved || !board) return;
    solved = true;
    busy = false;
    board.setInteractive(false);
    const result = revealed || fails >= 2 ? 'failed' : fails === 1 || hintsUsed > 0 ? 'hinted' : 'clean';
    const rankBefore = rankOf(p.xp);
    const sum = recordResult(p, m, result, Date.now(), difficultyOf(m).level);
    if (countBlunderSolves(p, all) >= 10 && !p.badges.includes('blunder-buster')) {
      p.badges.push('blunder-buster');
      sum.newBadges.push('blunder-buster');
    }
    await app.saveProgress();
    const info = THEMES[m.theme];
    // Show the full story on the board: your game move vs the best move.
    board.setPosition(m.fenBefore, lastMove);
    const deep = (await firstTop)[0];
    const bestUci = deep?.uci[0] ?? m.bestUci;
    const bestSan = sanOf(m.fenBefore, bestUci);
    board.shapes([
      board.arrow(m.playedUci.slice(0, 2), m.playedUci.slice(2, 4), 'red'),
      board.arrow(bestUci.slice(0, 2), bestUci.slice(2, 4), 'green'),
    ]);
    const solvedLine = numberedLine(m.fenBefore, deep?.uci.length ? deep.uci : m.pv, 8);
    say(
      `<div class="stamp ${result}">${result === 'clean' ? 'CASE CLOSED' : result === 'hinted' ? 'CASE SOLVED' : 'CASE REOPENS SOON'}</div>
       <p class="xp-line">+${sum.base} XP <span class="sub">for a ${'★'.repeat(difficultyOf(m).level)} ${esc(difficultyOf(m).label)} puzzle, ${result === 'clean' ? 'solved cleanly' : result === 'hinted' ? 'solved with help' : 'shown the answer'}${sum.replay ? ' (a replay: ¼ XP)' : ''}</span>${sum.bonus ? ` <span class="bonus">+${sum.bonus} 🔥 streak bonus</span>` : ''}</p>
       <p class="sub">${result === 'failed' ? 'This case comes back in a few minutes.' : result === 'hinted' ? 'It will return for a review.' : 'See you in a few days for a check-up.'}</p>
       <p class="arrows-key"><span class="k red"></span> your game move ${esc(m.played)} &nbsp; <span class="k green"></span> best move ${esc(bestSan)}</p>
       <p>Best line: ${esc(solvedLine)}</p>`,
      'lesson',
    );
    const lesson = say(`<h4>${info.icon} Key lesson: ${esc(info.title)}</h4><p>${esc(info.lesson)}</p>`, 'lesson', `Key lesson: ${info.title}. ${info.lesson}`);
    const ch = CHAPTERS.find((c) => c.themes[0] === m.theme) ?? CHAPTERS.find((c) => c.themes.length < 6 && c.themes.includes(m.theme));
    if (ch) {
      const a = document.createElement('a');
      a.className = 'learn-more';
      a.href = `#/chapters/${ch.ep}`;
      a.innerHTML = `<img src="${thumb(ch.videoId)}" alt="" loading="lazy" /><span>📺 <b>Learn more:</b> Ep ${ch.ep} · ${esc(ch.title)}</span>`;
      lesson.append(a);
    }
    say(
      `<p>Want to prove it? Play this position out against Stockfish.</p><a class="btn small" href="#/play?fen=${encodeURIComponent(m.fenBefore)}&color=${m.userColor}">♟️ Play it out vs Stockfish</a>`,
      'coach',
    );
    revealAll();
    if (result === 'clean') confetti();
    for (const b of sum.newBadges) toast(`${BADGES[b].icon} <b>Badge unlocked:</b> ${esc(BADGES[b].title)}`, 'win', 5000);
    if (sum.rankUp) toast(`🎉 New rank: <b>${esc(rankOf(p.xp).title)}</b> (was ${esc(rankBefore.title)})`, 'win', 6000);
    btnHint.hidden = btnSol.hidden = true;
    btnNext.hidden = false;
    btnNext.textContent = index + 1 < queue.length ? 'Next case →' : 'Finish session ✓';
    btnNext.focus();
  }

  btnNext.addEventListener('click', () => {
    if (index + 1 < queue.length) load(index + 1);
    else sessionSummary();
  });

  function sessionSummary() {
    const [q, who] = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    board?.destroy();
    board = null;
    view.innerHTML = `<div class="card empty-state">
      <div class="big-ico">🏆</div>
      <h2>Session complete!</h2>
      <p>You've worked through ${queue.length} case${queue.length > 1 ? 's' : ''} from your own games. That is exactly how strong players get stronger.</p>
      <p class="streak-big">🔥 ${p.streak}-day streak · ${rankOf(p.xp).icon} ${esc(rankOf(p.xp).title)} · ${p.xp} XP</p>
      <blockquote>“${esc(q)}” <cite>— ${esc(who)}</cite></blockquote>
      <div class="row"><a class="btn primary" href="#/train?again=${Date.now()}">Another session</a> <a class="btn" href="#/progress">See my progress</a> <a class="btn" href="#/dashboard">Dashboard</a></div>
    </div>`;
  }

  view.querySelector('[data-act=flip]')!.addEventListener('click', () => board?.cg.toggleOrientation());
  view.querySelector('[data-act=retry]')!.addEventListener('click', () => {
    load(index);
  });

  load(0);
  return () => {
    destroyed = true;
    stopVoice();
    engine.clearQueue();
    board?.destroy();
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
