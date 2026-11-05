// App state: who you are, your games, their analysis and your progress.
// Views read from here and listen for changes.

import * as store from './store';
import { fetchGames, fetchProfile, type Profile, lastGameTime } from './chesscom';
import { analyzeGame } from './analyzer';
import { browserEngine, type Engine } from './engine';
import { loadProgress, saveProgress, type Progress } from './training';
import { cloudConfig, mergeProgress, pull, push, watchUser, type CloudUser } from './cloud';
import type { GameAnalysis, GameRecord, MistakeRecord } from './types';

export const PERIODS = [
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
  { id: '120d', label: '120 days', days: 120 },
  { id: '1y', label: '1 year', days: 365 },
  { id: '3y', label: '3 years', days: 1095 },
] as const;
export type PeriodId = (typeof PERIODS)[number]['id'];

/** chess.com game speeds you can include or leave out. */
export const TIME_CLASSES = [
  { id: 'bullet', label: 'Bullet', icon: '⚡' },
  { id: 'blitz', label: 'Blitz', icon: '🔥' },
  { id: 'rapid', label: 'Rapid', icon: '⏱️' },
  { id: 'daily', label: 'Daily', icon: '📅' },
] as const;
export const ALL_TIME_CLASSES = TIME_CLASSES.map((t) => t.id as string);
export const LIVE_TIME_CLASSES = ['bullet', 'blitz', 'rapid'];

export interface AnalysisJob {
  total: number;
  done: number;
  current?: string;
  plyDone?: number;
  plyTotal?: number;
}

type Listener = () => void;

class AppState {
  username = '';
  profile: Profile | null = null;
  games: GameRecord[] = [];
  fetchedDays = 0;
  /** End time (s) of the player's newest standard game on chess.com, when known; null = none at all. */
  lastPlayed: number | null | undefined = undefined;
  analyses = new Map<string, GameAnalysis>();
  progress: Progress | null = null;
  job: AnalysisJob | null = null;
  fetching: { done: number; total: number } | null = null;
  depth = 10;
  /** Which game speeds count everywhere (stats, analysis, puzzles). */
  timeClasses: string[] = [...ALL_TIME_CLASSES];
  /** Google account (only when sign-in is set up) */
  user: CloudUser | null = null;
  cloudEnabled = false;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelJob = false;
  private listeners = new Set<Listener>();
  private analysisEngine: Engine | null = null;

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    this.listeners.forEach((f) => f());
  }

  async restore(): Promise<boolean> {
    const u = await store.get<string>('current-user');
    if (!u) return false;
    await this.load(u);
    return true;
  }

  private async load(u: string) {
    this.username = u;
    this.profile = (await store.get<Profile>(`profile:${u}`)) ?? { username: u };
    this.games = (await store.get<GameRecord[]>(`games:${u}`)) ?? [];
    this.fetchedDays = (await store.get<number>(`fetched-days:${u}`)) ?? 0;
    const list = (await store.get<GameAnalysis[]>(`analysis:${u}`)) ?? [];
    this.analyses = new Map(list.map((a) => [a.gameId, a]));
    this.progress = await loadProgress(u);
    this.depth = (await store.get<number>('depth')) ?? 10;
    this.timeClasses = (await store.get<string[]>(`time-classes:${u}`)) ?? [...ALL_TIME_CLASSES];
    this.lastSyncAt = (await store.get<number>(`last-sync:${u}`)) ?? 0;
  }

  /** Turns on Google sign-in if it is set up, and keeps progress in sync. */
  async initCloud() {
    this.cloudEnabled = !!(await cloudConfig());
    this.emit();
    if (!this.cloudEnabled) return;
    await watchUser(async (u) => {
      this.user = u;
      if (u) await this.syncFromCloud().catch((e) => console.warn('sync failed', e));
      this.emit();
    });
  }

  private async syncFromCloud() {
    if (!this.user) return;
    const remote = await pull(this.user.uid);
    if (remote?.username && !this.username) {
      // New device: pick up where you left off.
      await this.connect(remote.username, false, false);
      if (remote.timeClasses) await this.setTimeClasses(remote.timeClasses);
      if (location.hash === '' || location.hash === '#/' || location.hash.startsWith('#/welcome')) location.hash = '#/dashboard?first=1';
    }
    if (this.progress && remote?.progress && remote.username === this.username) {
      this.progress = mergeProgress(this.progress, remote.progress);
      await saveProgress(this.progress);
    }
    this.schedulePush(0);
  }

  /** Saves your progress to your Google account (a moment after changes). */
  schedulePush(delay = 1500) {
    if (!this.user || !this.username) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      const u = this.user;
      if (!u) return;
      push(u.uid, { username: this.username, timeClasses: this.timeClasses, progress: this.progress ?? undefined }).catch((e) => console.warn('save to account failed', e));
    }, delay);
  }

  async connect(username: string, liveOnly = false, sync = true) {
    const profile = await fetchProfile(username);
    const u = profile.username.toLowerCase();
    await store.set(`profile:${u}`, profile);
    await store.set('current-user', u);
    await this.load(u);
    if (liveOnly) await this.setTimeClasses(LIVE_TIME_CLASSES);
    this.profile = profile;
    if (sync && this.user) await this.syncFromCloud().catch(() => {});
    this.emit();
  }

  async logout() {
    this.stopAnalysis();
    await store.del('current-user');
    this.username = '';
    this.games = [];
    this.analyses.clear();
    this.progress = null;
    this.emit();
  }

  /** Make sure we have downloaded at least `days` of games. */
  async ensureGames(days: number, force = false) {
    if (!this.username) return;
    if (!force && this.fetchedDays >= days && this.lastSync() > Date.now() - 30 * 60 * 1000) return;
    const since = Math.floor(Date.now() / 1000) - Math.max(days, this.fetchedDays) * 86400;
    this.fetching = { done: 0, total: 1 };
    this.emit();
    try {
      const games = await fetchGames(this.username, since, (done, total) => {
        this.fetching = { done, total };
        this.emit();
      });
      let window = Math.max(days, this.fetchedDays);
      // Nothing recent? Ask chess.com when the last game was and look back that far
      // (up to 3 years), instead of ending in an empty "0 of 0 games".
      if (!games.length) {
        this.lastPlayed = await lastGameTime(this.username);
        const ago = this.lastPlayed ? Math.ceil((Date.now() / 1000 - this.lastPlayed) / 86400) + 1 : Infinity;
        if (ago > window && ago <= 1095) {
          // Look back over the whole period that contains the last game (e.g. 1 or
          // 3 years), not just to that day — otherwise only the last game comes in.
          window = PERIODS.find((p) => p.days >= ago)!.days;
          games.push(...(await fetchGames(this.username, Math.floor(Date.now() / 1000) - window * 86400)));
        }
      } else this.lastPlayed = games[0].endTime;
      this.games = games;
      this.fetchedDays = window;
      await store.set(`games:${this.username}`, games);
      await store.set(`fetched-days:${this.username}`, this.fetchedDays);
      this.lastSyncAt = Date.now();
      await store.set(`last-sync:${this.username}`, this.lastSyncAt);
    } finally {
      this.fetching = null;
      this.emit();
    }
  }

  lastSyncAt = 0;
  lastSync() {
    return this.lastSyncAt;
  }

  gamesIn(days: number, offsetDays = 0): GameRecord[] {
    const now = Date.now() / 1000;
    const to = now - offsetDays * 86400;
    const from = to - days * 86400;
    return this.games.filter((g) => g.endTime > from && g.endTime <= to && this.includes(g.timeClass));
  }

  /** Is this game speed switched on? (Anything unusual counts as daily.) */
  includes(timeClass: string): boolean {
    const tc = (ALL_TIME_CLASSES as string[]).includes(timeClass) ? timeClass : 'daily';
    return this.timeClasses.includes(tc);
  }

  async setTimeClasses(list: string[]) {
    this.timeClasses = list.length ? list : [...ALL_TIME_CLASSES];
    if (this.username) await store.set(`time-classes:${this.username}`, this.timeClasses);
    this.schedulePush();
    this.emit();
  }

  mistakes(days?: number): MistakeRecord[] {
    const games = days ? new Set(this.gamesIn(days).map((g) => g.id)) : null;
    const out: MistakeRecord[] = [];
    for (const a of this.analyses.values()) {
      if (games && !games.has(a.gameId)) continue;
      out.push(...a.mistakes.filter((m) => this.includes(m.timeClass)));
    }
    return out.sort((a, b) => b.endTime - a.endTime);
  }

  findMistake(id: string): MistakeRecord | undefined {
    const gameId = id.split('#')[0];
    return this.analyses.get(gameId)?.mistakes.find((m) => m.id === id);
  }

  gameOf(m: MistakeRecord) {
    return this.games.find((g) => g.id === m.gameId);
  }

  /**
   * Analyze up to `limit` not-yet-analyzed games from the period. For long
   * periods we spread the games evenly so the picture is fair.
   */
  async analyze(days: number, limit: number) {
    if (this.job) return;
    const pending = this.gamesIn(days).filter((g) => !this.analyses.has(g.id));
    let pick = pending;
    if (pending.length > limit) {
      const recent = pending.slice(0, Math.ceil(limit / 2));
      const rest = pending.slice(recent.length);
      const step = rest.length / (limit - recent.length);
      pick = [...recent, ...Array.from({ length: limit - recent.length }, (_, i) => rest[Math.floor(i * step)])];
    }
    if (!pick.length) return;
    this.cancelJob = false;
    this.job = { total: pick.length, done: 0 };
    this.emit();
    this.analysisEngine ??= browserEngine();
    try {
      for (const g of pick) {
        if (this.cancelJob) break;
        this.job.current = `vs ${g.opponent}`;
        const a = await analyzeGame(this.analysisEngine, g, this.depth, (p, t) => {
          if (this.job) {
            this.job.plyDone = p;
            this.job.plyTotal = t;
            this.emitThrottled();
          }
        });
        this.analyses.set(g.id, a);
        this.job.done++;
        await store.set(`analysis:${this.username}`, [...this.analyses.values()]);
        this.emit();
      }
    } catch (e) {
      console.error(e);
    } finally {
      this.job = null;
      this.emit();
    }
  }

  /** Removes a case that a deeper look showed was not a real mistake. */
  async dismissMistake(id: string) {
    const a = this.analyses.get(id.split('#')[0]);
    if (!a) return;
    a.mistakes = a.mistakes.filter((m) => m.id !== id);
    await store.set(`analysis:${this.username}`, [...this.analyses.values()]);
  }

  stopAnalysis() {
    this.cancelJob = true;
  }

  private throttle = 0;
  private emitThrottled() {
    const now = Date.now();
    if (now - this.throttle > 250) {
      this.throttle = now;
      this.emit();
    }
  }

  async setDepth(d: number) {
    this.depth = d;
    await store.set('depth', d);
  }

  async saveProgress() {
    if (this.progress) await saveProgress(this.progress);
    this.schedulePush();
    this.emit();
  }

  async resetAnalysis() {
    this.analyses.clear();
    await store.del(`analysis:${this.username}`);
    this.emit();
  }
}

export const app = new AppState();
