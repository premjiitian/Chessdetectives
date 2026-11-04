import { app } from '../lib/app';
import { QUOTES } from '../lib/coach';
import { Board } from '../ui/board';
import { $, esc } from '../ui/dom';

export function renderWelcome(root: HTMLElement) {
  const [q, who] = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  root.innerHTML = `
  <div class="welcome">
    <section class="hero">
      <div class="hero-text">
        <div class="kicker">🔍 Chess Detectives</div>
        <h1>Every mistake is a <span class="hl">clue</span>.</h1>
        <p class="lead">Connect your chess.com account. We investigate your own games with Stockfish 19, find the mistakes you keep repeating, and turn them into puzzles — with a coach who explains <em>why</em>.</p>
        <form class="connect" autocomplete="off">
          <label for="uname" class="sr">chess.com username</label>
          <input id="uname" name="uname" placeholder="Your chess.com username" required spellcheck="false" />
          <button class="btn primary big" type="submit">Start investigating →</button>
        </form>
        <p class="err" hidden></p>
        <p class="fine">No password needed — we only read your public games. Everything is stored on this device.</p>
        <blockquote>“${esc(q)}” <cite>— ${esc(who)}</cite></blockquote>
      </div>
      <div class="hero-board"><div id="hero-board"></div></div>
    </section>
    <section class="how">
      <div class="step"><span>1</span><h3>Collect the evidence</h3><p>We pull your games from the last 7 days up to 3 years.</p></div>
      <div class="step"><span>2</span><h3>Find the pattern</h3><p>Stockfish marks every blunder. We sort them: hanging pieces, missed forks, opening slips…</p></div>
      <div class="step"><span>3</span><h3>Solve your own cases</h3><p>Replay those moments as puzzles. Find the best move, hear why it works, and play it out against Stockfish.</p></div>
      <div class="step"><span>4</span><h3>Close the loop</h3><p>Missed cases come back until they stick. Watch your recurring mistakes shrink over time.</p></div>
    </section>
  </div>`;

  const board = new Board($(root, '#hero-board'), { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', orientation: 'white', interactive: false });
  // A tiny looping demo: the famous four-move trap and its punishment.
  const demo = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'];
  let i = 0;
  const timer = setInterval(() => {
    if (i >= demo.length) {
      board.setPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
      board.shapes([]);
      i = 0;
      return;
    }
    board.play(demo[i]);
    board.shapes(i === 5 ? [board.arrow('h5', 'f7', 'red')] : i === 6 ? [board.circle('e8', 'red')] : []);
    i++;
  }, 1300);

  const form = root.querySelector('form')!;
  const err = $(root, '.err');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = (form.elements.namedItem('uname') as HTMLInputElement).value.trim();
    if (!name) return;
    const btn = form.querySelector('button')!;
    btn.disabled = true;
    btn.textContent = 'Looking you up…';
    err.hidden = true;
    try {
      await app.connect(name);
      location.hash = '#/dashboard?first=1';
    } catch (ex) {
      err.textContent = (ex as Error).message || 'Something went wrong. Please try again.';
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Start investigating →';
    }
  });
  return () => {
    clearInterval(timer);
    board.destroy();
  };
}
