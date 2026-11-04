# 🔍 Chess Detectives

**Every mistake is a clue.** Chess Detectives connects to your chess.com account, investigates your own games with **Stockfish 19**, finds the mistakes you keep repeating, and turns them into puzzles — with a friendly coach who explains *why* the best move works.

> “You may learn much more from a game you lose than from a game you win.” — Capablanca

## What it does

| Screen | What you get |
| --- | --- |
| **Dashboard** | Pick which game types count — ⚡ Bullet, 🔥 Blitz, ⏱️ Rapid, 📅 Daily — or tap **Live games only** (also offered when you first connect). The choice applies everywhere: stats, analysis, puzzles and case files. Your most frequent mistake types for the last **7 days, 30 days, 90 days, 120 days, 1 year or 3 years**, compared with the period before (“▼ improving”). Accuracy, blunders per game, when mistakes happen (opening / middlegame / endgame), time-pressure share and your openings. |
| **Train** | Puzzles made from *your own* blunders. Find the best move. If you pick a decent alternative, the coach explains why it's reasonable — but pushes you to find the best one. If you pick a bad move, Stockfish shows you the punishment on the board. After the right move, Stockfish replies like a real opponent and the puzzle continues while precision is needed. Progressive hints (idea → theme → piece → move). Each puzzle has a **Difficulty** (★ Beginner → ★★★★★ Expert, with a rough rating) and a **Topic**, both hidden until you tap to reveal them, so they never spoil the search. An “Always show” switch is there if you prefer, and both are revealed automatically once the case is solved. A **“Remember this game?”** card shows when you played it, against whom (with ratings), the result and the time control. Turn on the **🔊 voice coach** to hear the coaching read aloud in a free **natural neural voice** (Piper, runs inside your browser: Hannah or Ryan from the US, Alba or Arthur from the UK; ≈60 MB downloaded once, then works offline) or your device's own voice (moves are spoken naturally, e.g. “Knight takes e5, check”); every message also has a 🔈 replay button. |
| **Case files** | A gallery of every mistake found, filterable by theme, severity and status. |
| **Spar** | Play any position from your games (or a full game) against Stockfish at 1350 – 2600 Elo or full strength, with every move graded (Best / Excellent / Good / Inaccuracy / Mistake / Blunder). |
| **Progress** | XP, detective ranks, daily streak, training calendar, badges and theme mastery. |

### Mistake themes it detects
Left a piece hanging · Missed the opponent's threat · Missed a winning tactic · Missed a checkmate · Walked into checkmate · Missed a fork · Allowed a fork · Missed a pin or skewer · Opening slip · Endgame technique · Planning slip.

## The learning loop

```
 play on chess.com ──► import games ──► Stockfish finds mistakes ──► group into themes
        ▲                                                                  │
        │                                                                  ▼
 dashboard shows the trend ◄── spaced repetition ◄── solve puzzles + coach explanation
 (fewer repeats = progress)    (missed cases return                and play it out
                                in 10 min; solved ones                vs Stockfish
                                in 1, 3, 7, 14, 30 days)
```

## Run it on your computer

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install      # download the building blocks (one time)
npm run dev      # start the app, then open the link it prints (http://localhost:5173)
```

Type your chess.com username and press **Start investigating**.

## Put it online (free, GitHub Pages)

1. In this repository on GitHub, open **Settings → Pages**.
2. Under **Source**, choose **GitHub Actions**.
3. Push to `main` (or run the “Deploy to GitHub Pages” workflow by hand). Your app appears at `https://<your-name>.github.io/<repo-name>/`.

## Checks

```bash
npm test                               # 20+ unit tests for tactics, coach, training loop, stats
FIXTURES=/path/to/saved-json npm run e2e   # full browser walkthrough with screenshots (Playwright)
```

## How it works (for the curious)

- **No server, no login.** Everything runs in your browser. Games come from the public [chess.com API](https://www.chess.com/news/view/published-data-api); past months are cached forever so we stay polite to chess.com. Your data is saved in your browser (IndexedDB) and never leaves your device.
- **Stockfish 19** (the WebAssembly build from [stockfish.js](https://github.com/nmrugg/stockfish.js)) runs in a background worker. A quick scan (depth 8–13) finds mistakes; each puzzle is re-checked with a deeper search before you solve it.
- **Win chance, not centipawns.** A move is a *mistake* when it drops your winning chances by 10 % or more, a *blunder* at 20 % (the same curve lichess uses).
- **The coach** reads the engine lines with chess rules (via [chess.js](https://github.com/jhlywa/chess.js)) to spot forks, pins, skewers, threats, hanging pieces, development and passed pawns, and explains them in plain English.
- **The board** is [Chessground](https://github.com/lichess-org/chessground) styled with the soft-white and cornflower-blue colours of the reference snapshot.

```
src/
  lib/chesscom.ts   download + cache games          lib/analyzer.ts  find mistakes in a game
  lib/engine.ts     Stockfish (UCI) wrapper         lib/themes.ts    mistake categories
  lib/tactics.ts    forks, pins, threats, material  lib/coach.ts     explanations + hints
  lib/training.ts   spaced repetition, XP, badges   lib/stats.ts     dashboard numbers
  views/            welcome, dashboard, train, cases, play, progress
```

## Ideas for next steps

- An optional AI coach (e.g. Claude) for richer, conversational explanations.
- Your own cloned voice for the coach (needs a paid voice-cloning service).
- Lichess account support.
- Opening repertoire drills built from your most-played openings.

## License

GPL-3.0-or-later (Stockfish and Chessground are GPL-licensed). Not affiliated with chess.com.
