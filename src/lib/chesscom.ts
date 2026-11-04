// Talks to the public chess.com API (no login needed).
// Past months never change, so we cache them forever and only re-download
// the current month. Requests are made one at a time, politely.

import * as store from './store';
import type { Color, GameRecord } from './types';

const API = 'https://api.chess.com/pub/player';

export interface Profile {
  username: string;
  name?: string;
  avatar?: string;
  url?: string;
  joined?: number;
}

async function getJson(url: string): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch {
      throw new Error(typeof navigator !== 'undefined' && !navigator.onLine
        ? "You're offline — showing the games already saved on this device."
        : "Couldn't reach chess.com. Check your internet connection and try again.");
    }
    if (res.ok) return res.json();
    if (res.status === 404) throw new Error('not-found');
    if (res.status === 429 || res.status >= 500) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    throw new Error(`chess.com answered ${res.status}`);
  }
  throw new Error('chess.com is busy right now, please try again in a minute.');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchProfile(username: string): Promise<Profile> {
  const u = username.trim().toLowerCase();
  try {
    const p = await getJson(`${API}/${encodeURIComponent(u)}`);
    return { username: p.username ?? u, name: p.name, avatar: p.avatar, url: p.url, joined: p.joined };
  } catch (e) {
    if ((e as Error).message === 'not-found') throw new Error(`We couldn't find a chess.com player called “${username}”.`);
    throw e;
  }
}

function monthKey(url: string) {
  const m = url.match(/(\d{4})\/(\d{2})$/);
  return m ? { y: +m[1], mo: +m[2] } : null;
}

/**
 * Download games ending after `sinceSec`. `onProgress` reports months done.
 * Returns every standard-chess game, newest first.
 */
export async function fetchGames(
  username: string,
  sinceSec: number,
  onProgress?: (done: number, total: number) => void,
): Promise<GameRecord[]> {
  const u = username.toLowerCase();
  const { archives } = await getJson(`${API}/${encodeURIComponent(u)}/games/archives`);
  const since = new Date(sinceSec * 1000);
  const sinceMonth = since.getUTCFullYear() * 12 + since.getUTCMonth();
  const now = new Date();
  const nowMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();

  const wanted = (archives as string[]).filter((a) => {
    const k = monthKey(a);
    return k && k.y * 12 + (k.mo - 1) >= sinceMonth;
  });

  const all: GameRecord[] = [];
  let done = 0;
  for (const url of wanted) {
    const k = monthKey(url)!;
    const isCurrent = k.y * 12 + (k.mo - 1) >= nowMonth - 0; // current month may still change
    const cacheKey = `month:${u}:${k.y}-${k.mo}`;
    let games: GameRecord[] | undefined = isCurrent ? undefined : await store.get<GameRecord[]>(cacheKey);
    if (!games) {
      const data = await getJson(url);
      games = (data.games as any[]).map((g) => toRecord(g, u)).filter((g): g is GameRecord => !!g);
      await store.set(cacheKey, games);
      await sleep(350); // be gentle with chess.com
    }
    all.push(...games);
    onProgress?.(++done, wanted.length);
  }
  return all.filter((g) => g.endTime >= sinceSec).sort((a, b) => b.endTime - a.endTime);
}

function toRecord(g: any, user: string): GameRecord | null {
  if (g.rules !== 'chess' || !g.pgn) return null;
  if (g.initial_setup && !g.initial_setup.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR')) return null;
  const isWhite = g.white?.username?.toLowerCase() === user;
  const me = isWhite ? g.white : g.black;
  const opp = isWhite ? g.black : g.white;
  if (!me) return null;
  const drawResults = ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'];
  const result: GameRecord['result'] = me.result === 'win' ? 'win' : drawResults.includes(me.result) ? 'draw' : 'loss';
  const opening = openingName(g.eco || '');
  return {
    id: g.url,
    url: g.url,
    pgn: g.pgn,
    endTime: g.end_time,
    timeClass: g.time_class,
    timeControl: g.time_control,
    rated: !!g.rated,
    userColor: (isWhite ? 'white' : 'black') as Color,
    userRating: me.rating,
    opponent: opp?.username ?? '?',
    opponentRating: opp?.rating ?? 0,
    result,
    opening,
  };
}

export function openingName(ecoUrl: string): string {
  const slug = ecoUrl.split('/openings/')[1];
  if (!slug) return 'Unknown opening';
  // "Reti-Opening-Kings-Indian-Attack-2...d6-3.Bg2" -> "Reti Opening Kings Indian Attack"
  const words = slug.split('-');
  const out: string[] = [];
  for (const w of words) {
    if (/\d/.test(w)) break;
    out.push(w);
  }
  return out.join(' ').slice(0, 60) || 'Unknown opening';
}
