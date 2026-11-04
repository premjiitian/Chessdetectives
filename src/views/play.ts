// Sparring: play any position (or a full game) against Stockfish 19,
// with a coach grading each of your moves as you go.

import { getEngine } from '../lib/engine';
import { flip, shortEval, winPercent } from '../lib/evaluation';
import { describeMove } from '../lib/coach';
import type { EngineLine } from '../lib/types';
import { Board } from '../ui/board';
import { $, esc, md } from '../ui/dom';
import { speak, stop as stopVoice, voiceControl } from '../lib/voice';
import { speechText } from './train';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const LEVELS = [
  { elo: 1350, label: 'Club player · 1350' },
  { elo: 1600, label: 'Strong club · 1600' },
  { elo: 1900, label: 'Expert · 1900' },
  { elo: 2200, label: 'Master · 2200' },
  { elo: 2600, label: 'Grandmaster · 2600' },
  { elo: 0, label: 'Full Stockfish 19 💀' },
];

const GRADES = [
  { max: 2, name: 'Best', cls: 'best', say: ['Perfect — that is the engine move!', 'Top move!', 'Exactly what Stockfish wanted.'] },
  { max: 5, name: 'Excellent', cls: 'good', say: ['Excellent move.', 'Very strong.', 'Great choice.'] },
  { max: 10, name: 'Good', cls: 'ok', say: ['Good, solid move.', 'Fine move.', 'That works.'] },
  { max: 15, name: 'Inaccuracy', cls: 'inacc', say: ['A small slip.', 'Not quite the best.'] },
  { max: 25, name: 'Mistake', cls: 'mist', say: ['That is a mistake.', 'Careful — that lets things slip.'] },
  { max: 101, name: 'Blunder', cls: 'blun', say: ['Ouch — a blunder.', 'That one hurts.'] },
];

export function renderPlay(view: HTMLElement, params: URLSearchParams) {
  const startFen = params.get('fen') || START;
  const color = (params.get('color') as 'white' | 'black') || (startFen.split(' ')[1] === 'b' ? 'black' : 'white');
  let level = 1600;
  try {
    level = Number(localStorage.getItem('spar-level') ?? 1600);
  } catch {}

  view.innerHTML = `
  <div class="trainer">
    <div class="board-col">
      <div class="board-wrap">
        <div class="evalbar"><i></i><span></span></div>
        <div id="board"></div>
      </div>
      <div class="board-actions">
        <button class="btn ghost small" data-act="undo">↶ Take back</button>
        <button class="btn ghost small" data-act="hint">💡 Best move?</button>
        <button class="btn ghost small" data-act="flip">⇅ Flip</button>
        <button class="btn ghost small" data-act="new">⟳ Restart</button>
      </div>
    </div>
    <aside class="coach-col">
      <div class="card case-head">
        <h2>♟️ Spar with Stockfish</h2>
        <p class="meta">${startFen === START ? 'A full game from the start.' : 'Play out a position from your own game. Can you convert it?'}</p>
        <label class="lvl">Opponent strength
          <select data-level>${LEVELS.map((l) => `<option value="${l.elo}" ${l.elo === level ? 'selected' : ''}>${l.label}</option>`).join('')}</select>
        </label>
      </div>
      <div class="voice-slot"></div>
      <div class="feed card" aria-live="polite"></div>
      <div class="card moves"><h4>Moves</h4><div class="movelist"></div></div>
    </aside>
  </div>`;

  const engine = getEngine();
  $(view, '.voice-slot').append(voiceControl());
  const feed = $(view, '.feed');
  const evalbar = $(view, '.evalbar');
  const moveList = $(view, '.movelist');
  const userTurn = color === 'white' ? 'w' : 'b';
  let destroyed = false;
  let thinking = false;
  let lastEval: EngineLine | undefined; // from side to move
  const sans: string[] = [];

  const say = (html: string, cls = 'coach') => {
    const d = document.createElement('div');
    d.className = `msg ${cls}`;
    d.innerHTML = html;
    feed.append(d);
    feed.scrollTop = feed.scrollHeight;
    speak(speechText(d));
  };

  const board = new Board($(view, '#board'), { fen: startFen, orientation: color, onMove: userMove });

  function setEval(line: EngineLine | undefined, sideToMoveIsUser: boolean) {
    if (!line) return;
    const u = sideToMoveIsUser ? line : flip(line);
    (evalbar.querySelector('i') as HTMLElement).style.height = `${winPercent(u)}%`;
    evalbar.querySelector('span')!.textContent = shortEval(u);
    evalbar.classList.toggle('black', color === 'black');
  }

  function renderMoves() {
    const startNo = Number(startFen.split(' ')[5] ?? 1);
    const blackFirst = startFen.split(' ')[1] === 'b';
    let html = '';
    let n = startNo;
    let i = 0;
    if (blackFirst && sans.length) {
      html += `<span class="no">${n}...</span><span>${esc(sans[0])}</span>`;
      i = 1;
      n++;
    }
    for (; i < sans.length; i += 2) {
      html += `<span class="no">${n}.</span><span>${esc(sans[i])}</span>${sans[i + 1] ? `<span>${esc(sans[i + 1])}</span>` : ''}`;
      n++;
    }
    moveList.innerHTML = html || '<span class="sub">Your move!</span>';
  }

  async function evaluate(fen: string, depth = 13) {
    const r = await engine.search(fen, { depth, multipv: 1 }).catch(() => null);
    return r?.lines[0];
  }

  function gameOver(): boolean {
    const c = board.chess;
    if (!c.isGameOver()) return false;
    let msg = 'Draw.';
    if (c.isCheckmate()) msg = c.turn() === userTurn ? 'Checkmate — Stockfish wins this time. Take back and find the improvement!' : '🏆 Checkmate! You beat Stockfish!';
    else if (c.isStalemate()) msg = 'Stalemate — a draw.';
    else if (c.isThreefoldRepetition()) msg = 'Draw by repetition.';
    say(`<p><b>${msg}</b></p>`, c.isCheckmate() && c.turn() !== userTurn ? 'good' : 'lesson');
    board.setInteractive(false);
    return true;
  }

  async function userMove(uci: string) {
    if (thinking) return;
    const fenBefore = board.chess.fen();
    const before = lastEval ?? (await evaluate(fenBefore));
    const san = board.play(uci);
    if (!san) return;
    sans.push(san);
    renderMoves();
    thinking = true;
    board.setInteractive(false);
    board.shapes([]);

    const after = await evaluate(board.chess.fen());
    if (destroyed) return;
    if (before && after) {
      const loss = Math.max(0, winPercent(before) - (100 - winPercent(after)));
      const g = GRADES.find((x) => loss <= x.max)!;
      const phrase = g.say[sans.length % g.say.length];
      let extra = '';
      if (g.max > 10 && before.uci[0]) {
        const d = describeMove(fenBefore, before.uci[0]);
        extra = ` Better was <b>${esc(d.san)}</b> — ${md(d.facts[0] ?? '')}`;
      } else if (g.max <= 5) {
        const d = describeMove(fenBefore, uci);
        extra = d.facts[0] && !d.facts[0].startsWith("It's a quiet") ? ` ${md(d.facts[0])}` : '';
      }
      say(`<p><span class="grade ${g.cls}">${g.name}</span> <b>${esc(san)}</b>: ${phrase}${extra}</p>`, g.max > 10 ? 'bad' : 'good');
      setEval(after, false);
    }
    if (gameOver()) {
      thinking = false;
      return;
    }
    // Stockfish's turn.
    const r = await engine.search(board.chess.fen(), level ? { movetime: 700, elo: level } : { movetime: 900 }).catch(() => null);
    if (destroyed || !r?.bestmove) return;
    const reply = board.play(r.bestmove);
    if (reply) {
      sans.push(reply);
      renderMoves();
    }
    thinking = false;
    if (gameOver()) return;
    board.setInteractive(true);
    lastEval = await evaluate(board.chess.fen());
    if (!destroyed) setEval(lastEval, true);
  }

  async function start() {
    board.setPosition(startFen);
    sans.length = 0;
    renderMoves();
    feed.innerHTML = '';
    say(`<p>You play <b>${color}</b>. I'll grade each move you make — best, good, or “let's look again”. Good luck, detective! 🕵️</p>`);
    lastEval = await evaluate(startFen);
    setEval(lastEval, startFen.split(' ')[1] === userTurn);
    if (board.chess.turn() !== userTurn) {
      board.setInteractive(false);
      thinking = true;
      const r = await engine.search(startFen, level ? { movetime: 700, elo: level } : { movetime: 900 }).catch(() => null);
      if (r?.bestmove) {
        const s = board.play(r.bestmove);
        if (s) sans.push(s);
        renderMoves();
      }
      thinking = false;
      board.setInteractive(true);
      lastEval = await evaluate(board.chess.fen());
    }
  }

  view.querySelector('[data-level]')!.addEventListener('change', (e) => {
    level = Number((e.target as HTMLSelectElement).value);
    try {
      localStorage.setItem('spar-level', String(level));
    } catch {}
  });
  view.querySelector('[data-act=flip]')!.addEventListener('click', () => board.cg.toggleOrientation());
  view.querySelector('[data-act=new]')!.addEventListener('click', () => !thinking && start());
  view.querySelector('[data-act=undo]')!.addEventListener('click', async () => {
    if (thinking) return;
    // Take back your move and Stockfish's reply.
    const h = board.chess.history();
    if (!h.length) return;
    board.undo();
    sans.pop();
    if (board.chess.turn() !== userTurn && board.chess.history().length) {
      board.undo();
      sans.pop();
    }
    board.setInteractive(true);
    board.shapes([]);
    renderMoves();
    lastEval = await evaluate(board.chess.fen());
    setEval(lastEval, true);
  });
  view.querySelector('[data-act=hint]')!.addEventListener('click', async () => {
    if (thinking || board.chess.turn() !== userTurn) return;
    const l = lastEval ?? (await evaluate(board.chess.fen()));
    const mv = l?.uci[0];
    if (!mv) return;
    board.shapes([board.arrow(mv.slice(0, 2), mv.slice(2, 4), 'blue')]);
    const d = describeMove(board.chess.fen(), mv);
    say(`<p>💡 Stockfish suggests <b>${esc(d.san)}</b>. ${md(d.facts.join(' '))}</p>`);
  });

  start();
  return () => {
    destroyed = true;
    stopVoice();
    engine.clearQueue();
    board.destroy();
  };
}
