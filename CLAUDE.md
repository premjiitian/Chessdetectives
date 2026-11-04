# Chess Detectives — guide for Claude (and humans)

A browser-only app that turns a player's own chess.com mistakes into puzzles,
coached by **Professor Pin**, with Stockfish 19 as referee and sparring partner,
and the Chess Detectives YouTube course as chapters.

## Commands
- `npm run dev` — run locally · `npm run build` — production build (also copies Stockfish)
- `npm test` — unit tests (vitest) · `npx tsc --noEmit` — type check
- `npm run loop` — **the improvement loop**: every check + a scorecard
  (browser suites need `FIXTURES=/folder FIXTURE_USER=name`, saved chess.com JSON)

## The improvement loop (how we work)
1. **State the goal and how we'll know it's done** before changing code.
2. **Verify, don't assume**: add or extend a check that fails without the fix
   (unit test, `tests/*.mjs` browser check, or a screenshot you actually look at).
3. **Small steps**: one change → `npm run loop` → read the scorecard and screenshots.
4. **Fix root causes**, never weaken a check to get green. If a test is wrong, say so and fix the test.
5. **Write down what the loop found** in the commit message (found → fixed → measured).
6. Ask the owner when a choice is about taste, cost, privacy or someone's voice/likeness.

## Quality bar (a change is done when)
- Type check, unit tests and build pass; `npm run loop` has no ❌.
- Robot student: 0 stuck cases, 0 console errors; dismissed (false-alarm) cases ≤ 5 %.
- Accessibility: 0 axe WCAG 2.1 AA issues on every screen, light **and** dark.
- No sideways scrolling at 360 px; key buttons reachable next to the board on phones.
- Safety: data from chess.com is always escaped (`esc()`); `tests/safety.mjs` attacks with hostile names.
- Coaching is truthful (labels match the position), kind, plain-English, and says *why*:
  ≥ 90 % of best-move explanations concrete (`tests/concrete.test.ts`), reading level ≤ grade 6.
- Mistake labels agree with a deeper independent check ≥ 90 % (`tests/labels.test.ts`).

## Conventions
- Coach voice: encouraging, never mocking; explain the idea first, then moves.
  Mention the evaluation in plain words (`evalWords`) when a move changes it.
- Colours: use the `--*-ink` tokens for text (contrast-safe), `--accent-btn` for filled buttons.
- Board colours come from the reference snapshot: `--sq-light #f3f6fb`, `--sq-dark #6595ea`.
- All user data stays in the browser (IndexedDB via `src/lib/store.ts`). No servers, no keys.
- chess.com API: be polite — cache past months, one request at a time.
- Professor Pin's fixed lines live in `src/lib/pin.ts`; re-record with
  `scripts/make-pin-voice.py` (only with the voice owner's permission).

## Map
`src/lib` logic (analyzer, tactics, themes, coach, training, stats, chapters, voice, pin) ·
`src/views` screens · `src/ui` board + DOM helpers · `tests/` unit + browser suites · `scripts/` tooling.
