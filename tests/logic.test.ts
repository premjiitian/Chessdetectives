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
    const ms = Array.from({ length: 10 }, (_, i) => ({ ...m, id: 'm' + i, endTime: i, gameId: 'g' + (i % 3) }));
    recordResult(p, ms[0], 'failed', 0);
    const s = buildSession(p, ms, 6, 10 ** 9);
    expect(s).toHaveLength(6);
    expect(s.map((x) => x.id)).toContain('m0'); // the due review is always included
    expect(new Set(s.map((x) => x.id)).size).toBe(6); // no repeats
  });
  it('randomizes: sessions do not always start with the same puzzle', () => {
    const p = emptyProgress('x');
    const ms = Array.from({ length: 20 }, (_, i) => ({ ...m, id: 'm' + i, endTime: i, gameId: 'g' + i }));
    const firsts = new Set(Array.from({ length: 30 }, () => buildSession(p, ms, 6)[0].id));
    expect(firsts.size).toBeGreaterThan(5);
  });
  it('still favours your most common mistakes', () => {
    const p = emptyProgress('x');
    const ms = [
      ...Array.from({ length: 8 }, (_, i) => ({ ...m, id: 'fork' + i, theme: 'missed-fork', severity: 'blunder', gameId: 'f' + i })),
      ...Array.from({ length: 8 }, (_, i) => ({ ...m, id: 'rare' + i, theme: i ? 'opening-slip' + i : 'opening-slip', severity: 'mistake', gameId: 'r' + i })),
    ];
    let forks = 0;
    for (let t = 0; t < 200; t++) forks += buildSession(p, ms as any, 4).filter((x) => x.id.startsWith('fork')).length;
    expect(forks / 800).toBeGreaterThan(0.6);
  });
  it('avoids two cases from the same game in a row', () => {
    const p = emptyProgress('x');
    const ms = Array.from({ length: 6 }, (_, i) => ({ ...m, id: 'm' + i, gameId: i < 3 ? 'A' : 'B' }));
    for (let t = 0; t < 50; t++) {
      const s = buildSession(p, ms, 6);
      for (let i = 1; i < s.length; i++) expect(s[i].gameId === s[i - 1].gameId && s.slice(i).some((x) => x.gameId !== s[i].gameId)).toBe(false);
    }
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

import { sayMove, toSpeech } from '../src/lib/voice';
describe('voice coach wording', () => {
  it('says moves like a human', () => {
    expect(sayMove('Nxe5+')).toBe('Knight takes e5, check');
    expect(sayMove('exd5')).toBe('e pawn takes d5');
    expect(sayMove('e4')).toBe('e4');
    expect(sayMove('O-O')).toBe('castles kingside');
    expect(sayMove('e8=Q#')).toBe('e8 promotes to Queen, checkmate');
    expect(sayMove('Rae1')).toBe('Rook a e1');
  });
  it('cleans a coach line for speech', () => {
    expect(toSpeech("After 28...Rc8 you win — nice.")).toBe('After Rook c8 you win, nice.');
    expect(toSpeech('You lose 4 points (pawn = 1, queen = 9).')).toBe('You lose 4 points.');
    expect(toSpeech("Rc8 is good. Stockfish's main line: 28...Rc8 29.Nd5. Great.")).toBe('Rook c8 is good. Great.');
    expect(toSpeech('Chances fell from 82% to 46%')).toBe('Chances fell from 82 percent to 46 percent');
  });
});

import { app } from '../src/lib/app';
describe('game-type filter', () => {
  it('keeps only the chosen speeds in stats and puzzles', async () => {
    const now = Date.now() / 1000;
    const g = (id: string, timeClass: string) => ({ id, timeClass, endTime: now - 3600 }) as any;
    app.games = [g('a', 'bullet'), g('b', 'blitz'), g('c', 'rapid'), g('d', 'daily')];
    app.analyses = new Map([
      ['a', { gameId: 'a', mistakes: [{ id: 'a#1', timeClass: 'bullet', endTime: now }] } as any],
      ['d', { gameId: 'd', mistakes: [{ id: 'd#1', timeClass: 'daily', endTime: now }] } as any],
    ]);
    await app.setTimeClasses(['bullet', 'blitz', 'rapid']);
    expect(app.gamesIn(30).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(app.mistakes().map((m) => m.id)).toEqual(['a#1']);
    await app.setTimeClasses([]); // empty = everything again
    expect(app.gamesIn(30)).toHaveLength(4);
    expect(app.mistakes()).toHaveLength(2);
  });
});

import { CHAPTERS, PARTS, practiceFor, recommendChapter, chapterByEp } from '../src/lib/chapters';
describe('chapters', () => {
  const mk = (id: string, theme: any, extra: any = {}) => ({ id, theme, severity: 'mistake', endTime: 1, winBefore: 50, phase: 'middlegame', timePressure: false, ...extra }) as any;
  it('has all 20 episodes in 5 parts, each with a video', () => {
    expect(CHAPTERS.map((c) => c.ep)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(PARTS.flatMap((p) => p.chapters).sort((a, b) => a - b)).toEqual(CHAPTERS.map((c) => c.ep));
    for (const c of CHAPTERS) expect(c.videoId).toMatch(/^[\w-]{11}$/);
  });
  it('picks your own positions for a chapter', () => {
    const ms = [mk('a', 'missed-fork'), mk('b', 'hung-piece'), mk('c', 'endgame-technique', { phase: 'endgame' })];
    expect(practiceFor(chapterByEp(8)!, ms).map((m) => m.id).sort()).toEqual(['a', 'b']);
    expect(practiceFor(chapterByEp(18)!, ms).map((m) => m.id)).toEqual(['c']);
    expect(practiceFor(chapterByEp(16)!, [mk('w', 'hung-piece', { winBefore: 80 }), mk('l', 'hung-piece', { winBefore: 30 })]).map((m) => m.id)).toEqual(['w']);
  });
  it('recommends the chapter for your most common mistake, skipping watched ones', () => {
    const ms = [mk('1', 'missed-mate'), mk('2', 'missed-mate'), mk('3', 'hung-piece')];
    expect(recommendChapter(ms)?.ep).toBe(9);
    expect(recommendChapter(ms, [9])?.ep).not.toBe(9);
    expect(recommendChapter([])?.ep).toBe(1);
  });
});

import { evalWords, evalChange } from '../src/lib/coach';
describe('evaluation coaching', () => {
  it('explains evaluations in plain words from your side', () => {
    expect(evalWords({ cp: 20, mate: null })).toBe('+0.2 (about equal)');
    expect(evalWords({ cp: -240, mate: null })).toBe('-2.4 (clearly better for your opponent)');
    expect(evalWords({ cp: 420, mate: null })).toMatch(/winning for you/);
    expect(evalWords({ cp: null, mate: -2 })).toMatch(/checkmate for your opponent/);
    expect(evalChange({ cp: 30, mate: null }, { cp: -250, mate: null })).toBe('📊 Evaluation: +0.3 (about equal) → -2.5 (clearly better for your opponent).');
  });
  it('reads evaluations aloud correctly', () => {
    expect(toSpeech('📊 Evaluation: +0.3 (about equal) → -2.5 (clearly better for your opponent).')).toBe('Evaluation: plus 0 point 3 (about equal), now minus 2 point 5 (clearly better for your opponent).');
    expect(toSpeech('After 19.Qb3 it is -M2.')).toBe('After Queen b3 it is mate in 2 against you.');
  });
});

import { weeklyTrend } from '../src/lib/stats';
describe('weekly trend', () => {
  it('buckets analyzed games by week, oldest first', () => {
    const now = 100 * 7 * 86400;
    const g = (id: string, weeksAgo: number) => ({ id, endTime: now - weeksAgo * 7 * 86400 - 3600 }) as any;
    const games = [g('a', 0), g('b', 0), g('c', 2)];
    const an = new Map<string, any>([
      ['a', { accuracy: 90, mistakes: [] }],
      ['b', { accuracy: 70, mistakes: [{ severity: 'blunder' }] }],
      ['c', { accuracy: 60, mistakes: [{ severity: 'blunder' }, { severity: 'blunder' }] }],
    ]);
    const t = weeklyTrend(games, an, 3, now);
    expect(t.map((p) => p.games)).toEqual([1, 0, 2]);
    expect(t[2].accuracy).toBe(80);
    expect(t[2].blundersPerGame).toBe(0.5);
    expect(t[0].blundersPerGame).toBe(2);
  });
});

import { xpFor, XP_TABLE } from '../src/lib/training';
describe('XP by difficulty', () => {
  const mk = (id: string) => ({ id, theme: 'missed-fork', severity: 'mistake', endTime: 1 }) as any;
  it('harder puzzles give more XP; help halves it', () => {
    expect([1, 2, 3, 4, 5].map((l) => xpFor(l, 'clean'))).toEqual([10, 20, 30, 45, 60]);
    for (const l of [1, 2, 3, 4, 5]) {
      expect(XP_TABLE[l][1]).toBe(Math.floor(XP_TABLE[l][0] / 2));
      expect(xpFor(l, 'failed')).toBeLessThan(xpFor(l, 'hinted'));
    }
  });
  it('records every puzzle in the XP history with its difficulty', () => {
    const p = emptyProgress('x');
    const t = Date.UTC(2026, 0, 5, 12);
    const a = recordResult(p, mk('a'), 'clean', t, 5);
    expect(a.base).toBe(60);
    expect(a.bonus).toBe(5); // first day of a streak
    const b = recordResult(p, mk('b'), 'hinted', t + 1000, 2);
    expect(b.base).toBe(10);
    expect(b.bonus).toBe(0); // same day: no second bonus
    expect(p.log?.map((e) => [e.id, e.level, e.result, e.xp])).toEqual([['a', 5, 'clean', 60], ['b', 2, 'hinted', 10]]);
    expect(p.xp).toBe(75);
  });
  it('replaying a solved case before it is due gives a quarter XP (no farming)', () => {
    const p = emptyProgress('x');
    const t = Date.UTC(2026, 0, 5, 12);
    recordResult(p, mk('a'), 'clean', t, 4);
    const again = recordResult(p, mk('a'), 'clean', t + 60_000, 4);
    expect(again.replay).toBe(true);
    expect(again.base).toBe(11); // 45 / 4, rounded
  });
});

import { mergeProgress } from '../src/lib/cloud';
describe('progress sync between devices', () => {
  it('merges without losing anything', () => {
    const a = { ...emptyProgress('kid'), xp: 120, lastDay: '2026-11-03', streak: 2, bestStreak: 4, daily: { '2026-11-03': 3 }, badges: ['first-case'], chapters: [1],
      cards: { x: { box: 2, due: 5, attempts: 2, solved: 2, lastSeen: 200 } }, log: [{ t: 1, id: 'x', level: 3, result: 'clean', xp: 30, bonus: 5 }] } as any;
    const b = { ...emptyProgress('kid'), xp: 90, lastDay: '2026-11-04', streak: 3, bestStreak: 3, daily: { '2026-11-04': 2, '2026-11-03': 1 }, badges: ['streak-3'], chapters: [2, 1],
      cards: { x: { box: 1, due: 1, attempts: 1, solved: 1, lastSeen: 100 }, y: { box: 1, due: 1, attempts: 1, solved: 1, lastSeen: 150 } }, log: [{ t: 2, id: 'y', level: 5, result: 'clean', xp: 60, bonus: 0 }] } as any;
    const m = mergeProgress(a, b);
    expect(m.xp).toBe(120);
    expect(m.lastDay).toBe('2026-11-04');
    expect(m.streak).toBe(3);
    expect(m.bestStreak).toBe(4);
    expect(m.daily).toEqual({ '2026-11-03': 3, '2026-11-04': 2 });
    expect(m.badges.sort()).toEqual(['first-case', 'streak-3']);
    expect(m.chapters).toEqual([1, 2]);
    expect(m.cards.x.lastSeen).toBe(200); // newest version of a case wins
    expect(Object.keys(m.cards).sort()).toEqual(['x', 'y']);
    expect(m.log?.map((e) => e.id)).toEqual(['x', 'y']);
    expect(mergeProgress(m, m).log).toHaveLength(2); // syncing twice changes nothing
  });
});

describe('coach truthfulness in the opening', () => {
  it('does not call an early pawn move a king escape square', () => {
    const facts = describeMove('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', 'd7d6').facts.join(' ');
    expect(facts).not.toMatch(/escape square/);
  });
  it('still spots a real escape square for a castled king later on', () => {
    const facts = describeMove('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 30', 'h2h3').facts.join(' ');
    expect(facts).toMatch(/escape square/);
  });
});
