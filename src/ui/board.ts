// The chessboard: Chessground (the board used by lichess) driven by chess.js.

import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Key } from '@lichess-org/chessground/types';
import type { DrawShape } from '@lichess-org/chessground/draw';
import { Chess, type Square } from 'chess.js';

export interface BoardOptions {
  fen: string;
  orientation: 'white' | 'black';
  interactive?: boolean;
  onMove?: (uci: string) => void;
  coordinates?: boolean;
}

export class Board {
  cg: Api;
  chess: Chess;
  private onMove?: (uci: string) => void;
  private interactive: boolean;

  constructor(host: HTMLElement, opts: BoardOptions) {
    this.chess = new Chess(opts.fen);
    this.onMove = opts.onMove;
    this.interactive = opts.interactive ?? true;
    host.classList.add('cd-board');
    this.cg = Chessground(host, {
      fen: opts.fen,
      orientation: opts.orientation,
      coordinates: opts.coordinates ?? true,
      animation: { enabled: true, duration: 220 },
      highlight: { lastMove: true, check: true },
      premovable: { enabled: false },
      draggable: { showGhost: true },
      drawable: { enabled: true, visible: true },
      movable: { free: false, showDests: true, events: { after: (o, d) => this.userMoved(o, d) } },
    });
    this.sync();
  }

  private userMoved(orig: Key, dest: Key) {
    const piece = this.chess.get(orig as Square);
    const promo = piece?.type === 'p' && (dest[1] === '8' || dest[1] === '1') ? 'q' : '';
    const uci = orig + dest + promo;
    this.onMove?.(uci);
  }

  /** Re-reads the chess.js position into the board. */
  sync(lastMove?: [string, string]) {
    const turn = this.chess.turn() === 'w' ? 'white' : 'black';
    const dests = new Map<Key, Key[]>();
    if (this.interactive) {
      for (const m of this.chess.moves({ verbose: true })) {
        const list = dests.get(m.from as Key) ?? [];
        list.push(m.to as Key);
        dests.set(m.from as Key, list);
      }
    }
    this.cg.set({
      fen: this.chess.fen(),
      turnColor: turn,
      check: this.chess.inCheck() ? turn : false,
      lastMove: lastMove as Key[] | undefined,
      movable: { color: this.interactive ? turn : undefined, dests },
    });
  }

  setPosition(fen: string, lastMove?: [string, string]) {
    this.chess.load(fen);
    this.sync(lastMove);
  }

  /** Plays a UCI move on the board (with animation). Returns SAN or null. */
  play(uci: string): string | null {
    try {
      const m = this.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      this.sync([m.from, m.to]);
      return m.san;
    } catch {
      this.sync();
      return null;
    }
  }

  undo() {
    this.chess.undo();
    const h = this.chess.history({ verbose: true });
    const last = h[h.length - 1];
    this.sync(last ? [last.from, last.to] : undefined);
  }

  setInteractive(on: boolean) {
    this.interactive = on;
    this.sync();
  }

  shapes(shapes: DrawShape[]) {
    this.cg.setAutoShapes(shapes);
  }

  arrow(from: string, to: string, brush = 'green'): DrawShape {
    return { orig: from as Key, dest: to as Key, brush };
  }

  circle(sq: string, brush = 'yellow'): DrawShape {
    return { orig: sq as Key, brush };
  }

  destroy() {
    this.cg.destroy();
  }
}

/** A small, view-only board for lists. */
export function miniBoard(host: HTMLElement, fen: string, orientation: 'white' | 'black', lastMove?: [string, string]) {
  host.classList.add('cd-board', 'mini');
  return Chessground(host, {
    fen,
    orientation,
    viewOnly: true,
    coordinates: false,
    lastMove: lastMove as Key[] | undefined,
    animation: { enabled: false },
  });
}
