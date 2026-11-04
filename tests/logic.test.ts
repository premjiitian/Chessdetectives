import { describe, it, expect } from 'vitest';
import { forkAfter, pinAfter, materialSwing, wasThreatBefore, phaseOf } from '../src/lib/tactics';
import { classify } from '../src/lib/themes';
import { describeMove, explainFailure, hints, numberedLine } from '../src/lib/coach';
import { winPercent, severityOf, moveAccuracy } from '../src/lib/evaluation';
import { emptyProgress, recordResult, buildSession, rankOf } from '../src/lib/training';
import { periodStats } from '../src/lib/stats';
import { openingName } from '../src/lib/chesscom';
import { parsePgn } from '../src/lib/analyzer';

describe('tactics', () => {
  it('spots a knight fork of king and rook', () => {
    // White knight on d5 jumps to c7+, forking king e8 and rook a8.
    const fen = 'r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1';
    const f = forkAfter(fen, 'd5c7');
    expect(f?.targets.map((t) => t.type).sort()).toEqual(['k', 'r']);
  });
  it('spots a pin on the king', () => {
    // Bb5 pins the c6 knight to the e8 king.
    const fen = '4k3/8/2n5/8/8/8/8/3BK3 w - - 0 1';
    const p = pinAfter(fen, 'd1b3') ?? pinAfter('4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1', 'f1b5');
    expect(p?.frontType).toBe('n');
    expect(p?.backType).toBe('k');
  });
  it('measures material won along a line', () => {
    const fen = 'r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1';
    expect(materialSwing(fen, ['d5c7', 'e8d7', 'c7a8'], 'w')).toBe(5);
  });
  it('knows a threat that existed before our move', () => {
    // Black's bishop on b4 already attacks the e1 king's knight? Use a simple capture threat.
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';
    expect(wasThreatBefore(fen, 'f3e5')).toBe(true);
  });
  it('detects game phase', () => {
    expect(phaseOf('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 1)).toBe('opening');
    expect(phaseOf('4k3/pp6/8/8/8/8/PP6/R3K3 w - - 0 40', 40)).toBe('endgame');
  });
});

describe('themes', () => {
  it('labels a missed mate', () => {
    expect(
      classify({ fenBefore: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', playedUci: 'g1f1', bestPv: ['a1a8'], refutation: [], bestMate: 1, afterMate: null, phase: 'endgame' }),
    ).toBe('missed-mate');
  });
  it('labels a hanging piece', () => {
    // White moves the queen to h5?? where the g6 pawn... simpler: queen to a square attacked by a pawn.
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    expect(classify({ fenBefore: fen, playedUci: 'd1g4', bestPv: ['g1f3'], refutation: ['d7d5', 'g4h5', 'c8g4'], bestMate: null, afterMate: null, phase: 'opening' })).not.toBe('missed-mate');
    // Qd1-a4?? no; use Bc4-?: put bishop where pawn takes it.
    const t = classify({ fenBefore: fen, playedUci: 'f1a6', bestPv: ['g1f3'], refutation: ['b7a6'], bestMate: null, afterMate: null, phase: 'opening' });
    expect(t).toBe('hung-piece');
  });
});

describe('coach', () => {
  it('explains a fork in plain words', () => {
    const d = describeMove('r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1', 'd5c7');
    expect(d.facts.join(' ')).toMatch(/fork/);
    expect(d.facts.join(' ')).toMatch(/check/);
  });
  it('talks about the opponent in the third person', () => {
    const lines = explainFailure('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 'f1a6', { uci: ['b7a6'], cp: 300, mate: null, depth: 10 });
    expect(lines.join(' ')).toMatch(/bishop/);
    expect(lines.join(' ')).not.toMatch(/your opponent answers \*\*bxa6\*\*\. .*for you/);
  });
  it('numbers lines correctly from black', () => {
    expect(numberedLine('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', ['e7e5', 'g1f3'])).toBe('1...e5 2.Nf3');
  });
  it('gives four escalating hints', () => {
    const h = hints('r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1', 'd5c7', 'theme hint');
    expect(h).toHaveLength(4);
    expect(h[2].square).toBe('d5');
    expect(h[3].arrow).toEqual(['d5', 'c7']);
  });
});

describe('evaluation', () => {
  it('maps evals to win chances', () => {
    expect(winPercent({ cp: 0, mate: null })).toBeCloseTo(50);
    expect(winPercent({ cp: null, mate: 3 })).toBe(100);
    expect(winPercent({ cp: 300, mate: null })).toBeGreaterThan(75);
    expect(severityOf(25)).toBe('blunder');
    expect(severityOf(12)).toBe('mistake');
    expect(severityOf(2)).toBeNull();
    expect(moveAccuracy(0)).toBeCloseTo(100, 0);
  });
});

describe('training loop', () => {
  const m = { id: 'g#1', theme: 'missed-fork', severity: 'blunder', endTime: 1 } as any;
  it('moves a clean solve up a box and schedules it later', () => {
    const p = emptyProgress('x');
    const r = recordResult(p, m, 'clean', 0);
    expect(r.xp).toBeGreaterThan(30);
    expect(p.cards['g#1'].box).toBe(1);
    expect(p.cards['g#1'].due).toBe(86400000);
    expect(p.badges).toContain('first-case');
  });
  it('brings a failed case back soon', () => {
    const p = emptyProgress('x');
    recordResult(p, m, 'failed', 1000);
    expect(p.cards['g#1'].due).toBe(1000 + 600000);
  });
  it('counts streaks across days', () => {
    const p = emptyProgress('x');
    const day = 86400000;
    recordResult(p, m, 'clean', Date.UTC(2026, 0, 1, 12));
    recordResult(p, { ...m, id: 'b' }, 'clean', Date.UTC(2026, 0, 2, 12));
    recordResult(p, { ...m, id: 'c' }, 'clean', Date.UTC(2026, 0, 3, 12));
    expect(p.streak).toBe(3);
    expect(p.badges).toContain('streak-3');
    recordResult(p, { ...m, id: 'd' }, 'clean', Date.UTC(2026, 0, 3, 12) + 3 * day);
    expect(p.streak).toBe(1);
  });
  it('builds a session with due reviews and fresh cases', () => {
    const p = emptyProgress('x');
    const ms = Array.from({ length: 10 }, (_, i) => ({ ...m, id: 'm' + i, endTime: i }));
    recordResult(p, ms[0], 'failed', 0);
    const s = buildSession(p, ms, 6, 10 ** 9);
    expect(s).toHaveLength(6);
    expect(s[0].id).toBe('m0');
  });
  it('ranks go up with XP', () => {
    expect(rankOf(0).title).toBe('Rookie Sleuth');
    expect(rankOf(500).title).toBe('Detective');
  });
});

describe('stats & parsing', () => {
  it('summarises a period and trend', () => {
    const g = (id: string, result: any) => ({ id, result, opening: 'Italian Game', timeClass: 'blitz', userRating: 1000 }) as any;
    const analyses = new Map<string, any>([
      ['a', { gameId: 'a', accuracy: 80, mistakes: [{ theme: 'hung-piece', severity: 'blunder', phase: 'middlegame', timePressure: true }] }],
      ['b', { gameId: 'b', accuracy: 90, mistakes: [] }],
    ]);
    const s = periodStats([g('a', 'loss'), g('b', 'win')], null, analyses);
    expect(s.analyzed).toBe(2);
    expect(s.accuracy).toBe(85);
    expect(s.themes[0].id).toBe('hung-piece');
    expect(s.timePressure).toBe(1);
  });
  it('reads opening names from chess.com urls', () => {
    expect(openingName('https://www.chess.com/openings/Reti-Opening-Kings-Indian-Attack-2...d6-3.Bg2')).toBe('Reti Opening Kings Indian Attack');
  });
  it('parses pgn with clocks', () => {
    const p = parsePgn('[Event "x"]\n\n1. e4 {[%clk 0:02:59.9]} 1... e5 {[%clk 0:02:58]} 2. Nf3 {[%clk 0:02:50]} *');
    expect(p.uci).toEqual(['e2e4', 'e7e5', 'g1f3']);
    expect(p.clocks[0]).toBeCloseTo(179.9);
    expect(p.fens).toHaveLength(4);
  });
});

import { difficultyOf } from '../src/lib/difficulty';
describe('difficulty', () => {
  it('rates a free capture as easy and a quiet defensive move as harder', () => {
    // Free rook on a8 for the white bishop.
    const easy = difficultyOf({ fenBefore: 'r3k3/8/8/8/8/8/6B1/4K3 w - - 0 1', pv: ['g2a8'], theme: 'missed-win' });
    // Quiet move that stops a threat.
    const hard = difficultyOf({ fenBefore: 'r1b1k1nr/p2pppbp/1qp3p1/8/2B1P3/2N2Q2/PPP2PPP/R1B1K2R b KQkq - 3 8', pv: ['e7e6', 'e1g1'], theme: 'ignored-threat' });
    expect(easy.level).toBeLessThan(hard.level);
    expect(easy.label).toBe('Beginner');
    expect(hard.reasons.join(' ')).toMatch(/quiet/);
  });
});
