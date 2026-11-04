// The Chess Detectives video course (youtube.com/@ChessDetectives) as chapters.
// Each chapter links to the mistake themes it teaches, so after watching you
// practise on positions from your *own* games.

import type { MistakeRecord, ThemeId } from './types';

export const CHANNEL_URL = 'https://www.youtube.com/@ChessDetectives';
export const PLAYLIST_ID = 'PLfkG2A1jWM-o';
export const PLAYLIST_TITLE = 'Season 1: From 1200 to 2000';
export const PLAYLIST_URL = `https://www.youtube.com/playlist?list=${PLAYLIST_ID}`;

export interface Chapter {
  ep: number;
  videoId: string;
  title: string;
  hook: string; // the episode's opening question
  learn: string; // what you'll learn
  themes: ThemeId[];
  /** Extra rule for picking practice positions (e.g. "you were winning"). */
  pick?: (m: MistakeRecord) => boolean;
  pickLabel?: string;
}

export interface Part {
  title: string;
  icon: string;
  chapters: number[];
}

export const PARTS: Part[] = [
  { title: 'Think like a detective', icon: '🧠', chapters: [1, 2, 3, 4, 5, 6] },
  { title: 'Tactics: spot the clue', icon: '🎯', chapters: [7, 8, 9, 10, 11, 12] },
  { title: 'Calculation', icon: '🧮', chapters: [13, 14, 15] },
  { title: 'Win the won game', icon: '🏁', chapters: [16, 17, 18] },
  { title: 'Mindset & final exam', icon: '🎓', chapters: [19, 20] },
];

const ALL: ThemeId[] = [
  'hung-piece', 'ignored-threat', 'missed-win', 'missed-mate', 'allowed-mate', 'missed-fork',
  'allowed-fork', 'missed-pin', 'opening-slip', 'endgame-technique', 'positional-slip',
];

export const CHAPTERS: Chapter[] = [
  { ep: 1, videoId: 'N_2tWKEcPg4', title: 'How to THINK in Chess (Not Just Move!)', hook: 'Before you grab that free pawn, what is your opponent threatening?', learn: 'How to think in chess with a six-step Thinking Loop and a Pause & Solve challenge.', themes: ['ignored-threat', 'hung-piece'] },
  { ep: 2, videoId: 'p1BZltgStsU', title: 'Is Your King SAFE? Chess Question #1', hook: 'Is your king safe, or is the roof already leaking?', learn: 'King safety: spotting danger, checking escape squares and thinking about castling.', themes: ['allowed-mate', 'ignored-threat'] },
  { ep: 3, videoId: 'Sv5BxbgfkOk', title: 'Material in Chess: More Than Just Counting', hook: 'Who is really ahead — and does it matter right now?', learn: 'What pieces are worth, when to trade, and why a loose piece is a gift to your opponent.', themes: ['hung-piece', 'missed-win'] },
  { ep: 4, videoId: 'BhVrOBWBZ80', title: 'Piece Activity: Wake Up Your Sleepy Pieces!', hook: 'Your pieces are on the board. But are they doing any work?', learn: 'Piece activity and three ways to wake up a sleepy piece.', themes: ['positional-slip', 'opening-slip'] },
  { ep: 5, videoId: 'ELwv0CF4q4A', title: 'Pawn Structure Explained', hook: 'A pawn move cannot be taken back. What will it leave behind?', learn: 'Pawn islands, isolated pawns, doubled pawns and the plans they suggest.', themes: ['positional-slip', 'endgame-technique'] },
  { ep: 6, videoId: 'jG9TW9p1QdE', title: 'The 5-Question Checklist: Attack, Convert or Repair?', hook: 'Should you attack, convert your advantage or repair your position?', learn: 'A five-question checklist that turns clues about the position into a plan.', themes: ['positional-slip', 'opening-slip', 'ignored-threat'] },
  { ep: 7, videoId: '4AD5qi76IzU', title: 'Why Tactics Work: The Secret of Chess Motives', hook: 'A tactic starts with a clue. Can you spot the weakness first?', learn: 'Tactical motives, the forcing-move hierarchy and why combinations work.', themes: ['missed-win', 'missed-fork', 'missed-pin'] },
  { ep: 8, videoId: 'z5DOYDayp3Q', title: 'Forks, Pins and Loose Pieces', hook: 'Two targets. One knight. Can you find the fork?', learn: 'Forks, pins and loose-piece tactics with three Pause & Solve puzzles.', themes: ['missed-fork', 'allowed-fork', 'missed-pin', 'hung-piece'] },
  { ep: 9, videoId: 'KZl1JVLpCkk', title: 'Back Rank Mate and the Smothered Mate', hook: 'Your king has no escape square. What could go wrong?', learn: 'Back-rank mate, smothered mate and overloaded-defender tactics.', themes: ['missed-mate', 'allowed-mate'] },
  { ep: 10, videoId: 'n8Qy-Rzo_yw', title: 'Discovered Attack Explained', hook: 'Move one piece, uncover another attack. Can the queen escape?', learn: 'The discovered attack and how unsafe queens become tactical targets.', themes: ['missed-win', 'ignored-threat'] },
  { ep: 11, videoId: 'cXagJXBrgWM', title: 'Passed Pawns: How a Pawn Wins the Game', hook: 'Can one little pawn really win the game?', learn: 'Creating, pushing and stopping passed pawns — the engine of most endgames.', themes: ['endgame-technique'] },
  { ep: 12, videoId: '7UWPOeHRnHc', title: 'Helping Chess: The Mistake Even Strong Players Make', hook: 'Your plan works perfectly... if your opponent helps you.', learn: 'Stop playing "helping chess" with a Danger Scan and four boss-fight puzzles.', themes: ['ignored-threat', 'hung-piece', 'allowed-fork'] },
  { ep: 13, videoId: 'MMYdmxn6qBU', title: 'How to Find the Best Move: Candidate Moves', hook: 'Is your first idea really your best idea?', learn: 'Listing candidate moves before choosing, so the best move is never missed.', themes: ['missed-win', 'positional-slip', 'missed-fork'] },
  { ep: 14, videoId: 'M24xGvef26Y', title: 'Calculate Like a Grandmaster: The Kotov Tree', hook: 'How far ahead can you see — and in what order?', learn: 'Calculating variations step by step with the Kotov tree.', themes: ['missed-mate', 'missed-win', 'allowed-mate'] },
  { ep: 15, videoId: '9P0PzKjAOgk', title: 'Visualization and Calculation Training', hook: 'Can you see the board after three moves — without moving the pieces?', learn: 'Training your inner board so tactics a few moves deep become visible.', themes: ['missed-fork', 'missed-pin', 'missed-win'] },
  { ep: 16, videoId: 'IiAXmwoJsPc', title: 'How to WIN a Won Position', hook: 'Winning position. One careless move. Sound familiar?', learn: 'The Conversion Cycle and a 10-second blunder check for positions where you are ahead.', themes: ALL, pick: (m) => m.winBefore >= 70, pickLabel: 'moments where you were winning' },
  { ep: 17, videoId: 'mRo5u0HXGkQ', title: 'Positional Advantage: Five Tools', hook: 'You have the better position. How do you turn it into something real?', learn: 'Five tools for converting a positional advantage, including a minority-attack plan.', themes: ['positional-slip'], pick: (m) => m.winBefore >= 55, pickLabel: 'moments where you were better' },
  { ep: 18, videoId: 'u0RJk_mxFSI', title: 'Winning Material and Endgame Technique: Lucena and More', hook: 'An extra piece is useful. Knowing how to cash it in matters too.', learn: 'Endgame technique with the Lucena position, wrong-bishop ideas and stalemate awareness.', themes: ['endgame-technique'], pick: (m) => m.phase === 'endgame', pickLabel: 'your endgames' },
  { ep: 19, videoId: 'CTwZtDMpxkE', title: 'Chess Psychology: Nerves, Traps and Comebacks', hook: 'Nervous before a game? In trouble on the board? Keep looking for chances.', learn: 'Nerves, traps and practical ways to fight back.', themes: ALL, pick: (m) => m.timePressure || m.winBefore < 40, pickLabel: 'moments under pressure' },
  { ep: 20, videoId: 't842JPhUHG8', title: 'Final Exam: Put It All Together', hook: 'The clues are all there. Can you put the whole Thinking Loop together?', learn: 'The final exam — and building your own training plan.', themes: ALL, pickLabel: 'a mix of all your mistakes' },
];

export const chapterByEp = (ep: number) => CHAPTERS.find((c) => c.ep === ep);

/** Your own positions that fit a chapter, blunders and recent ones first. */
export function practiceFor(c: Chapter, mistakes: MistakeRecord[]): MistakeRecord[] {
  return mistakes
    .filter((m) => c.themes.includes(m.theme) && (!c.pick || c.pick(m)))
    .sort((a, b) => (b.severity === 'blunder' ? 1 : 0) - (a.severity === 'blunder' ? 1 : 0) || b.endTime - a.endTime);
}

/** The chapter that targets your most frequent mistake. */
export function recommendChapter(mistakes: MistakeRecord[], watched: number[] = []): Chapter | undefined {
  const counts = new Map<ThemeId, number>();
  for (const m of mistakes) counts.set(m.theme, (counts.get(m.theme) ?? 0) + 1);
  const score = (c: Chapter) => (c.themes.length > 6 ? 0 : c.themes.reduce((a, t, i) => a + (counts.get(t) ?? 0) * (i === 0 ? 2 : 1), 0));
  const ranked = CHAPTERS.filter((c) => !watched.includes(c.ep)).sort((a, b) => score(b) - score(a) || a.ep - b.ep);
  return ranked[0] && score(ranked[0]) > 0 ? ranked[0] : CHAPTERS.find((c) => !watched.includes(c.ep));
}

export const thumb = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
