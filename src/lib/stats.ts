// Numbers for the dashboard: what goes wrong most often, and is it improving?

import { THEMES } from './themes';
import type { GameAnalysis, GameRecord, MistakeRecord, Phase, ThemeId } from './types';

export interface ThemeStat {
  id: ThemeId;
  count: number;
  perGame: number; // per analyzed game
  prevPerGame: number | null; // previous period, same length
  blunders: number;
}

export interface PeriodStats {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  analyzed: number;
  accuracy: number | null;
  mistakesPerGame: number | null;
  blundersPerGame: number | null;
  themes: ThemeStat[];
  phases: Record<Phase, number>;
  timePressure: number; // share of mistakes made in time trouble
  openings: { name: string; games: number; mistakes: number; score: number }[];
  ratingNow: number | null;
  ratingChange: number | null;
  byTimeClass: { timeClass: string; games: number; rating: number }[];
}

function analyzedIn(games: GameRecord[], analyses: Map<string, GameAnalysis>) {
  return games.map((g) => analyses.get(g.id)).filter((a): a is GameAnalysis => !!a);
}

export function periodStats(games: GameRecord[], prevGames: GameRecord[] | null, analyses: Map<string, GameAnalysis>): PeriodStats {
  const done = analyzedIn(games, analyses);
  const mistakes: MistakeRecord[] = done.flatMap((a) => a.mistakes);
  const prevDone = prevGames ? analyzedIn(prevGames, analyses) : [];
  const prevMistakes = prevDone.flatMap((a) => a.mistakes);

  const themeMap = new Map<ThemeId, ThemeStat>();
  for (const m of mistakes) {
    const t = themeMap.get(m.theme) ?? { id: m.theme, count: 0, perGame: 0, prevPerGame: null, blunders: 0 };
    t.count++;
    if (m.severity === 'blunder') t.blunders++;
    themeMap.set(m.theme, t);
  }
  for (const t of themeMap.values()) {
    t.perGame = done.length ? t.count / done.length : 0;
    t.prevPerGame = prevDone.length >= 3 ? prevMistakes.filter((m) => m.theme === t.id).length / prevDone.length : null;
  }

  const phases: Record<Phase, number> = { opening: 0, middlegame: 0, endgame: 0 };
  for (const m of mistakes) phases[m.phase]++;

  const openingMap = new Map<string, { name: string; games: number; mistakes: number; points: number }>();
  for (const g of games) {
    const o = openingMap.get(g.opening) ?? { name: g.opening, games: 0, mistakes: 0, points: 0 };
    o.games++;
    o.points += g.result === 'win' ? 1 : g.result === 'draw' ? 0.5 : 0;
    o.mistakes += analyses.get(g.id)?.mistakes.length ?? 0;
    openingMap.set(g.opening, o);
  }

  const byClass = new Map<string, GameRecord[]>();
  for (const g of games) byClass.set(g.timeClass, [...(byClass.get(g.timeClass) ?? []), g]);
  const main = [...byClass.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  let ratingNow: number | null = null;
  let ratingChange: number | null = null;
  if (main) {
    const list = main[1]; // newest first
    ratingNow = list[0].userRating;
    ratingChange = list.length > 1 ? list[0].userRating - list[list.length - 1].userRating : null;
  }

  const acc = done.length ? done.reduce((a, b) => a + b.accuracy, 0) / done.length : null;
  return {
    games: games.length,
    wins: games.filter((g) => g.result === 'win').length,
    losses: games.filter((g) => g.result === 'loss').length,
    draws: games.filter((g) => g.result === 'draw').length,
    analyzed: done.length,
    accuracy: acc === null ? null : Math.round(acc * 10) / 10,
    mistakesPerGame: done.length ? mistakes.length / done.length : null,
    blundersPerGame: done.length ? mistakes.filter((m) => m.severity === 'blunder').length / done.length : null,
    themes: [...themeMap.values()].sort((a, b) => b.count - a.count),
    phases,
    timePressure: mistakes.length ? mistakes.filter((m) => m.timePressure).length / mistakes.length : 0,
    openings: [...openingMap.values()]
      .map((o) => ({ name: o.name, games: o.games, mistakes: o.mistakes, score: o.games ? o.points / o.games : 0 }))
      .sort((a, b) => b.games - a.games)
      .slice(0, 6),
    ratingNow,
    ratingChange,
    byTimeClass: [...byClass.entries()].map(([timeClass, l]) => ({ timeClass, games: l.length, rating: l[0].userRating })),
  };
}

/** A one-line story about the numbers, to keep you motivated. */
export function headline(s: PeriodStats): string {
  if (!s.games) return 'No games in this period yet — play a few and come back with fresh clues!';
  if (!s.analyzed) return `You played ${s.games} games. Let Stockfish investigate them to reveal your patterns.`;
  const top = s.themes[0];
  const improving = s.themes.find((t) => t.prevPerGame !== null && t.prevPerGame > 0 && t.perGame < t.prevPerGame * 0.8);
  if (improving) {
    const pct = Math.round((1 - improving.perGame / improving.prevPerGame!) * 100);
    return `Progress spotted: ${pct}% fewer “${THEMES[improving.id].title.toLowerCase()}” mistakes than the period before. Keep going!`;
  }
  if (top) return `Your #1 recurring clue: ${THEMES[top.id].title.toLowerCase()} (${top.count}× in ${s.analyzed} games). Let's close those cases.`;
  return 'Clean games! Not a single real mistake found. Time to play stronger opponents?';
}

export interface WeekPoint {
  start: number; // unix seconds, start of week
  games: number;
  accuracy: number | null;
  blundersPerGame: number | null;
}

/** Week-by-week accuracy and blunders, oldest first (only analyzed games count). */
export function weeklyTrend(games: GameRecord[], analyses: Map<string, GameAnalysis>, weeks: number, now = Date.now() / 1000): WeekPoint[] {
  const W = 7 * 86400;
  const out: WeekPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = now - i * W;
    const start = end - W;
    const done = games.filter((g) => g.endTime > start && g.endTime <= end).map((g) => analyses.get(g.id)).filter((a): a is GameAnalysis => !!a);
    out.push({
      start,
      games: done.length,
      accuracy: done.length ? done.reduce((a, b) => a + b.accuracy, 0) / done.length : null,
      blundersPerGame: done.length ? done.reduce((a, b) => a + b.mistakes.filter((m) => m.severity === 'blunder').length, 0) / done.length : null,
    });
  }
  return out;
}
