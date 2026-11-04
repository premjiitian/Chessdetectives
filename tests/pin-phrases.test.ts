// Exports Professor Pin's fixed sentences for scripts/make-pin-voice.py:
//   PIN_OUT=phrases.json npx vitest run tests/pin-phrases.test.ts
import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { pinKey, pinLines } from '../src/lib/pin';
import { sentences, toSpeech } from '../src/lib/voice';

it('every Professor Pin line splits into speakable sentences', () => {
  const out = new Map<string, string>();
  for (const line of pinLines()) for (const s of sentences(toSpeech(line))) if (pinKey(s)) out.set(pinKey(s), s);
  expect(out.size).toBeGreaterThan(60);
  if (process.env.PIN_OUT) writeFileSync(process.env.PIN_OUT, JSON.stringify([...out].map(([key, text]) => ({ key, text })), null, 1));
});

it('real coach messages find their Professor Pin recordings', () => {
  const keys = new Set(pinLines().flatMap((l) => sentences(toSpeech(l)).map(pinKey)));
  const spoken = (msg: string) => sentences(toSpeech(msg)).map(pinKey);
  // As the trainer renders them (after speechText):
  for (const msg of [
    "Excellent! That's the best move. ",
    "That's the move you played in the game! Let's see what your opponent could do: ",
    'CASE CLOSED. ',
    '🧭 Key lesson: Planning slip. When there is no tactic, improve your worst piece and ask what your opponent wants to do. ',
    "💡 The hero of this position is your knight — it's glowing on the board. ",
  ]) {
    for (const k of spoken(msg)) expect(keys.has(k), k).toBe(true);
  }
});
