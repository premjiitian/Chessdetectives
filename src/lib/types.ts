export type Color = 'white' | 'black';

/** One finished game from chess.com, reduced to what we need. */
export interface GameRecord {
  id: string; // chess.com game url
  url: string;
  pgn: string;
  endTime: number; // unix seconds
  timeClass: string; // bullet | blitz | rapid | daily
  timeControl: string;
  rated: boolean;
  userColor: Color;
  userRating: number;
  opponent: string;
  opponentRating: number;
  result: 'win' | 'loss' | 'draw';
  opening: string;
}

export type Severity = 'inaccuracy' | 'mistake' | 'blunder';

export type ThemeId =
  | 'hung-piece'
  | 'missed-win'
  | 'missed-mate'
  | 'allowed-mate'
  | 'missed-fork'
  | 'allowed-fork'
  | 'missed-pin'
  | 'ignored-threat'
  | 'opening-slip'
  | 'endgame-technique'
  | 'positional-slip';

export type Phase = 'opening' | 'middlegame' | 'endgame';

/** A single mistake you made in one of your games: the seed of a puzzle. */
export interface MistakeRecord {
  id: string; // gameId#ply
  gameId: string;
  ply: number; // index of your move in the game (0 = white's first move)
  moveNumber: number;
  fenBefore: string; // position where you had to move
  played: string; // SAN you played
  playedUci: string;
  best: string; // engine SAN
  bestUci: string;
  pv: string[]; // engine line (UCI) starting with best move
  refutation: string[]; // opponent's best answer to your move (UCI line)
  winBefore: number; // your win% before your move (0..100)
  winAfter: number; // your win% after your move
  winLoss: number;
  severity: Severity;
  theme: ThemeId;
  phase: Phase;
  timePressure: boolean;
  clockSeconds?: number;
  endTime: number;
  timeClass: string;
  opening: string;
  userColor: Color;
}

export interface GameAnalysis {
  gameId: string;
  depth: number;
  accuracy: number; // 0..100
  mistakes: MistakeRecord[];
  moves: number;
  analyzedAt: number;
}

export interface EngineLine {
  uci: string[];
  cp: number | null; // centipawns from side to move
  mate: number | null; // mate in N from side to move (negative = getting mated)
  depth: number;
}
