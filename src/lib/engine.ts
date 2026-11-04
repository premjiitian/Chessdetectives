// A friendly wrapper around Stockfish 19 speaking the UCI protocol.
// All requests are queued so only one search runs at a time.

import type { EngineLine } from './types';

export interface Transport {
  post(cmd: string): void;
  onLine(cb: (line: string) => void): void;
  terminate?(): void;
}

export interface SearchOptions {
  depth?: number;
  movetime?: number;
  multipv?: number;
  /** Play like a human of roughly this rating (min 1320). Omit for full strength. */
  elo?: number;
}

export interface SearchResult {
  lines: EngineLine[];
  bestmove: string | null;
}

type Job = { fen: string; opts: SearchOptions; resolve: (r: SearchResult) => void; reject: (e: unknown) => void };

export class Engine {
  private listeners: ((l: string) => void)[] = [];
  private queue: Job[] = [];
  private busy = false;
  private ready: Promise<void>;
  private options: Record<string, string> = {};
  name = 'Stockfish';

  constructor(private transport: Transport) {
    transport.onLine((l) => this.listeners.forEach((f) => f(l)));
    this.ready = (async () => {
      await this.send('uci', (l) => {
        if (l.startsWith('id name ')) this.name = l.slice(8).trim();
        return l === 'uciok';
      });
      this.setOption('Hash', '32');
      await this.isReady();
    })();
  }

  private send(cmd: string, until?: (line: string) => boolean): Promise<void> {
    return new Promise((resolve) => {
      if (!until) {
        this.transport.post(cmd);
        return resolve();
      }
      const fn = (l: string) => {
        if (until(l)) {
          this.listeners = this.listeners.filter((x) => x !== fn);
          resolve();
        }
      };
      this.listeners.push(fn);
      this.transport.post(cmd);
    });
  }

  private isReady() {
    return this.send('isready', (l) => l === 'readyok');
  }

  private setOption(name: string, value: string) {
    if (this.options[name] === value) return;
    this.options[name] = value;
    this.transport.post(`setoption name ${name} value ${value}`);
  }

  whenReady() {
    return this.ready;
  }

  search(fen: string, opts: SearchOptions = {}): Promise<SearchResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({ fen, opts, resolve, reject });
      this.pump();
    });
  }

  /** Cancels every search that has not started yet. */
  clearQueue() {
    const q = this.queue;
    this.queue = [];
    q.forEach((j) => j.reject(new Error('cancelled')));
  }

  private async pump() {
    if (this.busy) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy = true;
    try {
      await this.ready;
      job.resolve(await this.run(job.fen, job.opts));
    } catch (e) {
      job.reject(e);
    } finally {
      this.busy = false;
      this.pump();
    }
  }

  private async run(fen: string, opts: SearchOptions): Promise<SearchResult> {
    const multipv = opts.multipv ?? 1;
    this.setOption('MultiPV', String(multipv));
    if (opts.elo) {
      this.setOption('UCI_LimitStrength', 'true');
      this.setOption('UCI_Elo', String(Math.max(1320, Math.min(3190, Math.round(opts.elo)))));
    } else {
      this.setOption('UCI_LimitStrength', 'false');
    }
    await this.isReady();
    const lines = new Map<number, EngineLine>();
    let bestmove: string | null = null;
    const go = opts.movetime ? `go movetime ${opts.movetime}` : `go depth ${opts.depth ?? 12}`;
    this.transport.post(`position fen ${fen}`);
    await this.send(go, (l) => {
      if (l.startsWith('info ') && l.includes(' pv ')) {
        const line = parseInfo(l);
        if (line) lines.set(line.index, line.line);
      } else if (l.startsWith('bestmove')) {
        const m = l.split(' ')[1];
        bestmove = m && m !== '(none)' ? m : null;
        return true;
      }
      return false;
    });
    const sorted = [...lines.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
    return { lines: sorted, bestmove };
  }

  terminate() {
    this.transport.terminate?.();
  }
}

function parseInfo(l: string): { index: number; line: EngineLine } | null {
  const t = l.split(' ');
  const get = (k: string) => {
    const i = t.indexOf(k);
    return i >= 0 ? t[i + 1] : undefined;
  };
  if (t.includes('lowerbound') || t.includes('upperbound')) return null;
  const depth = Number(get('depth') ?? 0);
  const index = Number(get('multipv') ?? 1);
  const si = t.indexOf('score');
  if (si < 0) return null;
  const kind = t[si + 1];
  const val = Number(t[si + 2]);
  const pvIdx = t.indexOf('pv');
  return {
    index,
    line: {
      uci: t.slice(pvIdx + 1),
      cp: kind === 'cp' ? val : null,
      mate: kind === 'mate' ? val : null,
      depth,
    },
  };
}

/** Browser transport: Stockfish runs in a Web Worker so the page never freezes. */
export function browserEngine(): Engine {
  const url = `${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`;
  const worker = new Worker(url);
  let cb: (l: string) => void = () => {};
  worker.onmessage = (e) => String(e.data).split('\n').forEach((l) => cb(l));
  return new Engine({ post: (c) => worker.postMessage(c), onLine: (f) => (cb = f), terminate: () => worker.terminate() });
}

let shared: Engine | null = null;
/** One engine for the whole app (analysis, puzzles and sparring take turns). */
export function getEngine(): Engine {
  if (!shared) shared = browserEngine();
  return shared;
}
