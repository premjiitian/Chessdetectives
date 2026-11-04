// App state: who you are, your games, their analysis and your progress.
// Views read from here and listen for changes.

import * as store from './store';
import { fetchGames, fetchProfile, type Profile } from './chesscom';
import { analyzeGame } from './analyzer';
import { browserEngine, type Engine } from './engine';
import { loadProgress, saveProgress, type Progress } from './training';
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
  analyses = new Map<string, GameAnalysis>();
  progress: Progress | null = null;
  job: AnalysisJob | null = null;
  fetching: { done: number; total: number } | null = null;
  depth = 10;
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
    this.lastSyncAt = (await store.get<number>(`last-sync:${u}`)) ?? 0;
  }

  async connect(username: string) {
    const profile = await fetchProfile(username);
    const u = profile.username.toLowerCase();
    await store.set(`profile:${u}`, profile);
    await store.set('current-user', u);
    await this.load(u);
    this.profile = profile;
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
      this.games = games;
      this.fetchedDays = Math.max(days, this.fetchedDays);
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
    return this.games.filter((g) => g.endTime > from && g.endTime <= to);
  }

  mistakes(days?: number): MistakeRecord[] {
    const games = days ? new Set(this.gamesIn(days).map((g) => g.id)) : null;
    const out: MistakeRecord[] = [];
    for (const a of this.analyses.values()) if (!games || games.has(a.gameId)) out.push(...a.mistakes);
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
    this.emit();
  }

  async resetAnalysis() {
    this.analyses.clear();
    await store.del(`analysis:${this.username}`);
    this.emit();
  }
}

export const app = new AppState();
