// Your training loop: spaced repetition for puzzles, XP, ranks and streaks.
// Get a case right and it comes back later (to make sure it stuck).
// Get it wrong and it comes back soon.

import * as store from './store';
import type { MistakeRecord, ThemeId } from './types';

export interface CardState {
  box: number; // 0 = new, 1..6 = how well you know it
  due: number; // ms timestamp
  attempts: number;
  solved: number;
  lastResult?: 'clean' | 'hinted' | 'failed';
  lastSeen?: number;
}

export interface Progress {
  username: string;
  xp: number;
  streak: number;
  lastDay: string; // yyyy-mm-dd of last training
  bestStreak: number;
  daily: Record<string, number>; // yyyy-mm-dd -> puzzles solved
  themes: Partial<Record<ThemeId, { attempts: number; clean: number }>>;
  cards: Record<string, CardState>;
  badges: string[];
  chapters?: number[]; // episodes watched
}

const INTERVAL_DAYS = [0, 1, 3, 7, 14, 30, 60];

export const RANKS = [
  { xp: 0, title: 'Rookie Sleuth', icon: '🔍' },
  { xp: 150, title: 'Junior Investigator', icon: '🕵️' },
  { xp: 400, title: 'Detective', icon: '🧐' },
  { xp: 900, title: 'Inspector', icon: '🎩' },
  { xp: 1800, title: 'Chief Inspector', icon: '🏅' },
  { xp: 3500, title: 'Master Detective', icon: '🦉' },
  { xp: 6000, title: 'Legend of the 64 Squares', icon: '👑' },
];

export const BADGES: Record<string, { title: string; icon: string; desc: string }> = {
  'first-case': { title: 'First Case Closed', icon: '📁', desc: 'Solved your first puzzle.' },
  'clean-5': { title: 'Sharp Eyes', icon: '👁️', desc: 'Solved 5 puzzles without hints.' },
  'streak-3': { title: 'On the Trail', icon: '🔥', desc: 'Trained 3 days in a row.' },
  'streak-7': { title: 'Relentless', icon: '⚡', desc: 'Trained 7 days in a row.' },
  'mate-hunter': { title: 'Mate Hunter', icon: '👑', desc: 'Found 3 checkmates you missed in your games.' },
  'fork-master': { title: 'Fork Master', icon: '🍴', desc: 'Solved 3 fork puzzles cleanly.' },
  'blunder-buster': { title: 'Blunder Buster', icon: '🛡️', desc: 'Solved 10 of your blunders.' },
  'fifty': { title: 'Case Hardened', icon: '🗂️', desc: 'Solved 50 puzzles.' },
  'student': { title: 'Star Student', icon: '📺', desc: 'Watched 5 chapters of the course.' },
  'graduate': { title: 'Graduate Detective', icon: '🎓', desc: 'Watched all 20 chapters.' },
};

export function rankOf(xp: number) {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1].xp) i++;
  const next = RANKS[i + 1];
  return { ...RANKS[i], index: i, next, progress: next ? (xp - RANKS[i].xp) / (next.xp - RANKS[i].xp) : 1 };
}

export const today = (d = new Date()) => d.toISOString().slice(0, 10);

export function emptyProgress(username: string): Progress {
  return { username, xp: 0, streak: 0, lastDay: '', bestStreak: 0, daily: {}, themes: {}, cards: {}, badges: [] };
}

export async function loadProgress(username: string): Promise<Progress> {
  return (await store.get<Progress>(`progress:${username}`)) ?? emptyProgress(username);
}

export async function saveProgress(p: Progress) {
  await store.set(`progress:${p.username}`, p);
}

export function cardOf(p: Progress, id: string): CardState {
  return p.cards[id] ?? { box: 0, due: 0, attempts: 0, solved: 0 };
}

export interface ResultSummary {
  xp: number;
  newBadges: string[];
  rankUp: boolean;
}

/** Records a finished puzzle and returns the XP earned. */
export function recordResult(p: Progress, m: MistakeRecord, result: 'clean' | 'hinted' | 'failed', now = Date.now()): ResultSummary {
  const card = cardOf(p, m.id);
  const rankBefore = rankOf(p.xp).index;
  card.attempts++;
  card.lastSeen = now;
  card.lastResult = result;
  if (result === 'failed') {
    card.box = 1;
    card.due = now + 10 * 60 * 1000; // try again in 10 minutes
  } else {
    card.solved++;
    card.box = result === 'clean' ? Math.min(6, card.box + 1) : Math.max(1, card.box);
    card.due = now + INTERVAL_DAYS[card.box] * 86400000;
  }
  p.cards[m.id] = card;

  const t = (p.themes[m.theme] ??= { attempts: 0, clean: 0 });
  t.attempts++;
  if (result === 'clean') t.clean++;

  let xp = result === 'clean' ? 30 : result === 'hinted' ? 15 : 5;
  if (m.severity === 'blunder' && result !== 'failed') xp += 10;

  const d = today(new Date(now));
  if (p.lastDay !== d) {
    const y = today(new Date(now - 86400000));
    p.streak = p.lastDay === y ? p.streak + 1 : 1;
    p.lastDay = d;
    p.bestStreak = Math.max(p.bestStreak, p.streak);
    xp += Math.min(50, p.streak * 5); // daily streak bonus
  }
  if (result !== 'failed') p.daily[d] = (p.daily[d] ?? 0) + 1;
  p.xp += xp;

  const newBadges = checkBadges(p);
  return { xp, newBadges, rankUp: rankOf(p.xp).index > rankBefore };
}

export function checkBadges(p: Progress): string[] {
  const cards = Object.values(p.cards);
  const solved = cards.reduce((a, c) => a + (c.solved ? 1 : 0), 0);
  const clean = Object.values(p.themes).reduce((a, t) => a + (t?.clean ?? 0), 0);
  const earned: string[] = [];
  const give = (id: string, cond: boolean) => {
    if (cond && !p.badges.includes(id)) {
      p.badges.push(id);
      earned.push(id);
    }
  };
  give('first-case', solved >= 1);
  give('clean-5', clean >= 5);
  give('streak-3', p.streak >= 3);
  give('streak-7', p.streak >= 7);
  give('mate-hunter', (p.themes['missed-mate']?.clean ?? 0) >= 3);
  give('fork-master', (p.themes['missed-fork']?.clean ?? 0) + (p.themes['allowed-fork']?.clean ?? 0) >= 3);
  give('fifty', solved >= 50);
  give('student', (p.chapters?.length ?? 0) >= 5);
  give('graduate', (p.chapters?.length ?? 0) >= 20);
  return earned;
}

export function countBlunderSolves(p: Progress, mistakes: MistakeRecord[]): number {
  return mistakes.filter((m) => m.severity === 'blunder' && (p.cards[m.id]?.solved ?? 0) > 0).length;
}

/**
 * Today's session: due reviews first, then fresh cases from your most common
 * weakness, then a mix. Blunders before mistakes, recent before old.
 */
export function buildSession(p: Progress, mistakes: MistakeRecord[], size = 6, now = Date.now(), focus?: ThemeId): MistakeRecord[] {
  const pool = focus ? mistakes.filter((m) => m.theme === focus) : mistakes;
  const due = pool.filter((m) => p.cards[m.id] && p.cards[m.id].due <= now).sort((a, b) => p.cards[a.id].due - p.cards[b.id].due);
  const fresh = pool.filter((m) => !p.cards[m.id]);
  const counts = new Map<ThemeId, number>();
  for (const m of mistakes) counts.set(m.theme, (counts.get(m.theme) ?? 0) + 1);
  const score = (m: MistakeRecord) => (counts.get(m.theme) ?? 0) * 2 + (m.severity === 'blunder' ? 5 : 0) + m.endTime / 1e9;
  fresh.sort((a, b) => score(b) - score(a));
  const out: MistakeRecord[] = [];
  for (const m of [...due.slice(0, Math.ceil(size / 2)), ...fresh, ...due]) {
    if (out.length >= size) break;
    if (!out.includes(m)) out.push(m);
  }
  return out;
}
