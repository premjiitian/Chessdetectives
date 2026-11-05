// The spoken summary must be short and only say: what went well or wrong,
// the opponent's best answer, and the plan for both sides.
import { describe, expect, it } from 'vitest';
import { moveBrief } from '../src/lib/coach';
import { toSpeech } from '../src/lib/voice';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_NF3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe('spoken summary (moveBrief)', () => {
  it('a good move: why it works, their best answer, your plan, their plan', () => {
    const b = moveBrief(START, { uci: ['e2e4', 'e7e5', 'g1f3', 'b8c6'], cp: 30, mate: null }, 'good');
    expect(b).toMatch(/^e4 works: /);
    expect(b).toMatch(/Their best answer is e5/);
    expect(b).toMatch(/Your plan: Nf3 next\. It develops your knight\./);
    expect(b).toMatch(/Their plan: Nc6\. It deals with your threat Nxe5, which would win their pawn\./);
    expect(words(b)).toBeLessThanOrEqual(60);
  });

  it('a wrong move: says it is a mistake, the punishment and its cost, but not the best move', () => {
    const hint = 'find a safe square for your queen.';
    const b = moveBrief(AFTER_NF3, { uci: ['d8g5', 'f3g5', 'f8e7', 'g5f3'], cp: -900, mate: null }, 'wrong', hint);
    expect(b).toMatch(/^Qg5 is a mistake\./);
    expect(b).toMatch(/Their best answer is Nxg5: it wins the queen on g5/);
    expect(b).toMatch(/You lose about 9 points/);
    expect(b).toContain(`Your plan: ${hint}`);
    expect(b).not.toMatch(/Nc6|Nf6/); // never gives the answer away
    expect(words(b)).toBeLessThanOrEqual(60);
  });

  it('no filler: a calm move gets no empty reason', () => {
    // 1.Nf3 Nf6 2.g3: quiet moves; their reasons are generic and must not be read out.
    const b = moveBrief(START, { uci: ['g1f3', 'g8f6', 'g2g3', 'g7g6'], cp: 20, mate: null }, 'good');
    expect(b).not.toMatch(/calm, useful move|quiet move that keeps/);
  });

  it('an okay move says there is something stronger', () => {
    const b = moveBrief(START, { uci: ['a2a3', 'e7e5'], cp: 0, mate: null }, 'okay');
    expect(b).toMatch(/^a3 is playable, but there is a stronger move\./);
    expect(b).toMatch(/Their best answer is e5/);
  });

  it('reads naturally aloud (moves in words, no symbols)', () => {
    const b = toSpeech(moveBrief(AFTER_NF3, { uci: ['d8g5', 'f3g5'], cp: -900, mate: null }, 'wrong'));
    expect(b).toMatch(/Queen g5 is a mistake/);
    expect(b).toMatch(/Knight takes g5/);
    expect(b).not.toMatch(/[*📊→]/u);
  });
});
