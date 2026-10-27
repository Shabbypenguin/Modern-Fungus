export interface Pos {
  r: number;
  c: number;
}

/**
 * human        — plays with the dealt piece.
 * cpu-classic  — faithful 1994 CPU: ignores pieces, grows a 5–6 cell trail (see cpu/classic.ts).
 * cpu          — modern CPU that plays by human rules (difficulty set per seat).
 */
export type PlayerKind = 'human' | 'cpu-classic' | 'cpu';

export interface PlayerConfig {
  name: string;
  kind: PlayerKind;
  /** 0..1 for kind 'cpu'; ignored otherwise. */
  difficulty?: number;
}

export interface GameConfig {
  /** 'classic' = the 1994 rules (2–4 players); 'modern' = ring spawns, fair teeth, 2–16 players. */
  rules: 'classic' | 'modern';
  /** Board is size × size. Classic: 20. */
  size: number;
  players: PlayerConfig[];
  /** Head positions, one per player. Default: original layout for 2–4, ring layout above that. */
  heads?: Pos[];
  /** Tooth cells. Default: the four corners. */
  teeth?: Pos[];
  /** Bites each player starts with. Classic 2.0: 0. */
  startBites: number;
  /** Bites gained for growing onto a tooth cell. Classic: 1. */
  toothBites: number;
  /** Cells per bite-level step: level = 1 + floor(cells / biteStep). Classic: 80. */
  biteStep: number;
  /**
   * Modern: a random number of cells in [min, max], rolled once per game from the seed
   * and shared by every player, added to biteStep when the game is created.
   */
  biteRoll?: { min: number; max: number };
  /** Max bite level (1 = Bites, 2 = Big, 3 = Monster). Classic: 3. */
  maxBiteLevel: number;
  /** Free tooth for everyone every toothBase + [0, toothJitter) rounds. Classic: 8, 6. */
  toothBase: number;
  toothJitter: number;
  /** Capture along diagonals as well as rows/columns. Classic: true. */
  diagonalCapture: boolean;
  /** Classic CPU trail length range (inclusive). Classic: 5–6. */
  classicCpuGrowMin: number;
  classicCpuGrowMax: number;
  /**
   * [ours] The game ends when this many consecutive turns pass with no
   * place/grow/bite, and the largest fungus wins. 0 = never. Default: 2 × players.
   */
  stalemateTurns: number;
  /** Turn time limit in seconds (enforced by the host, not the engine). null = off. */
  turnTimeLimit: number | null;
}

export interface PlayerState {
  name: string;
  kind: PlayerKind;
  difficulty: number;
  alive: boolean;
  head: Pos;
  bites: number;
}

export interface GameState {
  version: 1;
  config: GameConfig;
  size: number;
  /** Row-major board. 0 = empty, otherwise playerIndex + 1. */
  cells: number[];
  /** Row-major tooth overlay. 1 = an unclaimed tooth sits here. */
  teeth: number[];
  players: PlayerState[];
  /** Index of the player whose turn it is. */
  current: number;
  /** The piece dealt for this turn (index into SHAPES). */
  piece: number;
  /** Starts at 1; increments each time play wraps back to the first seat. */
  round: number;
  nextToothRound: number;
  /** Consecutive turns without any place/grow/bite. */
  passStreak: number;
  /** Total turns ended so far. */
  turn: number;
  winner: number | null;
  rngSeed: number;
}

export type Action =
  | { type: 'place'; rotation: number; r: number; c: number }
  | { type: 'bite'; cells: Pos[] }
  | { type: 'grow'; cells: Pos[] }
  | { type: 'pass' };

export type GameEvent =
  | { type: 'placed'; player: number; cells: Pos[] }
  | { type: 'tooth'; player: number; pos: Pos }
  | { type: 'captured'; player: number; from: number; pos: Pos }
  | { type: 'died'; player: number; pos: Pos }
  | { type: 'bitten'; player: number; victim: number; pos: Pos }
  | { type: 'killed'; player: number; victim: number; bitesTaken: number }
  | { type: 'toothRegrow'; round: number }
  | { type: 'biteLevel'; player: number; level: number }
  | { type: 'turn'; player: number; piece: number; round: number }
  | { type: 'gameOver'; winner: number; reason: 'last-alive' | 'stalemate' };

export type ActionResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: string };
