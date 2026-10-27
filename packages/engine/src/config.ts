import type { GameConfig, PlayerConfig, Pos } from './types.js';

export const CLASSIC_SIZE = 20;
export const MAX_PLAYERS = 16;
export const MAX_CLASSIC_PLAYERS = 4;
export const MIN_SIZE = 10;
export const MAX_SIZE = 128;

export interface BoardSize {
  id: 'classic' | 'large' | 'xl' | 'mega' | 'massive';
  label: string;
  size: number;
}

export const BOARD_SIZES: readonly BoardSize[] = [
  { id: 'classic', label: 'Classic', size: 20 },
  { id: 'large', label: 'Large', size: 35 },
  { id: 'xl', label: 'XL', size: 50 },
  { id: 'mega', label: 'Mega', size: 75 },
  { id: 'massive', label: 'Massive', size: 100 },
];

/** Original Fungus 2.0 head positions on a 20×20 board (CODE 3 @ 0x01124). */
const CLASSIC_HEADS: Record<number, Pos[]> = {
  // The original stores the board column-major; these are already converted to (row, col).
  2: [
    { r: 14, c: 5 },
    { r: 5, c: 14 },
  ],
  3: [
    { r: 13, c: 5 },
    { r: 5, c: 9 },
    { r: 12, c: 14 },
  ],
  4: [
    { r: 5, c: 5 },
    { r: 5, c: 14 },
    { r: 14, c: 14 },
    { r: 14, c: 5 },
  ],
};

/** Original constants. 80 cells = 80% of a fair share (20×20 / 4 players). */
const CLASSIC_BITE_STEP = 80;
const FAIR_SHARE_FRACTION = 0.8;

/**
 * Classic rules: the original 1994 game. Larger boards keep the original
 * constants, start spots (scaled to the board) and corner teeth.
 */
export function classicConfig(players: PlayerConfig[], overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    rules: 'classic',
    size: CLASSIC_SIZE,
    players,
    startBites: 0,
    toothBites: 1,
    biteStep: CLASSIC_BITE_STEP,
    maxBiteLevel: 3,
    toothBase: 8,
    toothJitter: 6,
    diagonalCapture: true,
    classicCpuGrowMin: 5,
    classicCpuGrowMax: 6,
    stalemateTurns: players.length * 2,
    turnTimeLimit: null,
    ...overrides,
  };
}

/** Five-step speed scale used by the modern options. */
export type Speed = 'veryslow' | 'slow' | 'normal' | 'fast' | 'veryfast';
export const SPEEDS: readonly { id: Speed; label: string }[] = [
  { id: 'veryslow', label: 'Very slow' },
  { id: 'slow', label: 'Slow' },
  { id: 'normal', label: 'Normal' },
  { id: 'fast', label: 'Fast' },
  { id: 'veryfast', label: 'Very fast' },
];

/** New teeth: everyone gets +1 bite every `base` + [0, jitter) rounds. Normal = the 1994 value. */
export const TOOTH_RATES: Record<Speed, { base: number; jitter: number }> = {
  veryslow: { base: 16, jitter: 6 },
  slow: { base: 12, jitter: 6 },
  normal: { base: 8, jitter: 6 },
  fast: { base: 5, jitter: 4 },
  veryfast: { base: 3, jitter: 3 },
};

/** Bite growth: big bites arrive at this fraction of a fair share of the board. Normal = 1994. */
export const BITE_GROWTH: Record<Speed, number> = {
  veryslow: 1.4,
  slow: 1.1,
  normal: FAIR_SHARE_FRACTION,
  fast: 0.55,
  veryfast: 0.35,
};

export interface ModernOptions {
  /** How often everyone grows a new tooth. */
  newTeeth?: Speed;
  /** How soon bites become big (and then monster) bites. */
  biteGrowth?: Speed;
}

/**
 * Game speed presets [ours]: one choice that sets board size, new teeth and
 * bite growth together. Board size is relative to the smallest board that fits
 * the player count, so "Normal" with 4 players is the classic 20×20.
 */
export type GameSpeed = 'slowest' | 'slow' | 'normal' | 'fast' | 'fastest';
export const GAME_SPEEDS: readonly { id: GameSpeed; label: string; sizeStepsUp: number; newTeeth: Speed; biteGrowth: Speed }[] = [
  { id: 'slowest', label: 'Slowest', sizeStepsUp: 2, newTeeth: 'veryslow', biteGrowth: 'veryslow' },
  { id: 'slow', label: 'Slow', sizeStepsUp: 1, newTeeth: 'slow', biteGrowth: 'slow' },
  { id: 'normal', label: 'Normal', sizeStepsUp: 0, newTeeth: 'normal', biteGrowth: 'normal' },
  { id: 'fast', label: 'Fast', sizeStepsUp: 0, newTeeth: 'fast', biteGrowth: 'fast' },
  { id: 'fastest', label: 'Fastest', sizeStepsUp: 0, newTeeth: 'veryfast', biteGrowth: 'veryfast' },
];

export interface SpeedSettings {
  boardSize: number;
  newTeeth: Speed;
  biteGrowth: Speed;
}

/** The board size, new teeth and bite growth a preset means for `players` players. */
export function gameSpeedSettings(speed: GameSpeed, players: number): SpeedSettings {
  const preset = GAME_SPEEDS.find((g) => g.id === speed)!;
  const minIdx = BOARD_SIZES.findIndex((b) => b.size === minModernSize(players));
  const idx = Math.min(BOARD_SIZES.length - 1, minIdx + preset.sizeStepsUp);
  return { boardSize: BOARD_SIZES[idx]!.size, newTeeth: preset.newTeeth, biteGrowth: preset.biteGrowth };
}

/** Which preset (if any) these settings match. */
export function matchGameSpeed(settings: SpeedSettings, players: number): GameSpeed | null {
  for (const g of GAME_SPEEDS) {
    const p = gameSpeedSettings(g.id, players);
    if (p.boardSize === settings.boardSize && p.newTeeth === settings.newTeeth && p.biteGrowth === settings.biteGrowth) return g.id;
  }
  return null;
}

/** Cells per bite-level step for a modern board. */
export function modernBiteStep(size: number, players: number, growth: Speed = 'normal'): number {
  return Math.max(10, Math.round((BITE_GROWTH[growth] * size * size) / players));
}

/**
 * Modern rules [ours]: 2–16 players spaced evenly on a circle, teeth placed so
 * every player is the same distance from the same number of teeth, and bite
 * levels scaled so "big" means the same share of the board at any size.
 */
export function modernConfig(
  players: PlayerConfig[],
  size: number,
  overrides: Partial<GameConfig> = {},
  options: ModernOptions = {},
): GameConfig {
  const n = players.length;
  const teeth = TOOTH_RATES[options.newTeeth ?? 'normal'];
  return {
    ...classicConfig(players),
    rules: 'modern',
    size,
    heads: circleHeads(n, size),
    teeth: circleTeeth(n, size),
    biteStep: modernBiteStep(size, n, options.biteGrowth),
    toothBase: teeth.base,
    toothJitter: teeth.jitter,
    stalemateTurns: n * 2,
    ...overrides,
  };
}

/** Spawn circle radius as a fraction of the board, leaving room to grow outward. */
const RING = 0.36;
/** Teeth sit further out ("outfield"), still exactly between neighbours. */
const TOOTH_RING = 0.45;
/** Minimum distance (cells) between neighbouring spawns for a size to be offered. */
const MIN_SPACING = 5;

interface Layout {
  heads: Pos[];
  teeth: Pos[];
}

function ringAt(n: number, size: number, R: number, rot: number, offset: number): Pos[] {
  const mid = (size - 1) / 2;
  // First seat top-left, then clockwise — matches the classic seat order for 4.
  const base = -Math.PI / 2 - Math.PI / n + rot;
  return Array.from({ length: n }, (_, i) => {
    const a = base + offset + (2 * Math.PI * i) / n;
    return { r: Math.round(mid + R * Math.sin(a)), c: Math.round(mid + R * Math.cos(a)) };
  });
}

function centreTeeth(size: number): Pos[] {
  const lo = Math.floor((size - 1) / 2);
  const hi = Math.ceil((size - 1) / 2);
  const out: Pos[] = [];
  for (const r of new Set([lo, hi])) for (const c of new Set([lo, hi])) out.push({ r, c });
  return out;
}

const d = (a: Pos, b: Pos) => Math.hypot(a.r - b.r, a.c - b.c);

/** Worst-case unfairness of a layout, in cells (0 = perfectly fair). */
export function layoutUnfairness(heads: Pos[], teeth: Pos[], size: number): number {
  const mid = (size - 1) / 2;
  const radii = heads.map((h) => d(h, { r: mid, c: mid }));
  let worst = Math.max(...radii) - Math.min(...radii);
  // Neighbour spacing: nobody should be noticeably closer to a rival than others are.
  if (heads.length > 2) {
    const gaps = heads.map((h, i) => d(h, heads[(i + 1) % heads.length]!));
    worst = Math.max(worst, Math.max(...gaps) - Math.min(...gaps));
  }
  const profile = (h: Pos) => teeth.map((t) => d(h, t)).sort((a, b) => a - b);
  const profiles = heads.map(profile);
  for (let i = 0; i < teeth.length; i++) {
    const col = profiles.map((p) => p[i]!);
    worst = Math.max(worst, Math.max(...col) - Math.min(...col));
  }
  return worst;
}

const layoutCache = new Map<string, Layout>();

/**
 * Snapping a regular polygon to a grid can't be perfectly symmetric for most n,
 * so search small radius/rotation nudges and keep the fairest rounded layout.
 */
function fairLayout(n: number, size: number): Layout {
  const key = `${n}x${size}`;
  const hit = layoutCache.get(key);
  if (hit) return hit;
  const R0 = (size - 1) * RING;
  let best: Layout | null = null;
  let bestScore = Infinity;
  for (let dr = -1.5; dr <= 1.5001; dr += 0.25) {
    for (let k = -8; k <= 8; k++) {
      const rot = (k / 8) * (Math.PI / n) * 0.25;
      const heads = ringAt(n, size, R0 + dr, rot, 0);
      if (new Set(heads.map((h) => `${h.r},${h.c}`)).size !== n) continue;
      // Never trade spacing for symmetry: keep neighbours at least MIN_SPACING − ½ apart.
      if (n > 2 && heads.some((h, i) => d(h, heads[(i + 1) % n]!) < MIN_SPACING - 0.5)) continue;
      const Rt = (size - 1) * TOOTH_RING + dr;
      const teeth = dedupe([...ringAt(n, size, Rt, rot, Math.PI / n), ...centreTeeth(size)]).filter(
        (t) => !heads.some((h) => h.r === t.r && h.c === t.c),
      );
      // Prefer fairness, then staying close to the nominal circle and orientation.
      const score = layoutUnfairness(heads, teeth, size) + Math.abs(dr) * 0.01 + Math.abs(k) * 0.005;
      if (score < bestScore) {
        bestScore = score;
        best = { heads, teeth };
      }
    }
  }
  layoutCache.set(key, best!);
  return best!;
}

function dedupe(ps: Pos[]): Pos[] {
  const seen = new Set<string>();
  return ps.filter((p) => {
    const k = `${p.r},${p.c}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Regular polygon: 2 = opposite sides, 3 = triangle, 4 = square, 6 = hexagon… */
export function circleHeads(n: number, size: number): Pos[] {
  return fairLayout(n, size).heads.map((p) => ({ ...p }));
}

/**
 * One tooth exactly between each pair of neighbours — out past the spawn ring,
 * toward the edge of the board — plus the centre (one cell on odd boards, the
 * middle 2×2 on even boards). Every player is equally far from them.
 */
export function circleTeeth(n: number, size: number): Pos[] {
  return fairLayout(n, size).teeth.map((p) => ({ ...p }));
}

/** Smallest offered board size that gives `n` modern players room to breathe. */
export function minModernSize(n: number): number {
  for (const b of BOARD_SIZES) {
    const R = (b.size - 1) * RING;
    const spacing = n === 2 ? 2 * R : 2 * R * Math.sin(Math.PI / n);
    if (spacing >= MIN_SPACING) return b.size;
  }
  return BOARD_SIZES[BOARD_SIZES.length - 1]!.size;
}

/**
 * Default head layout for classic rules: the original positions for 2–4
 * players, scaled to the board size.
 */
export function defaultHeads(n: number, size: number): Pos[] {
  const classic = CLASSIC_HEADS[n];
  if (!classic) return circleHeads(n, size);
  const k = (size - 1) / (CLASSIC_SIZE - 1);
  return classic.map((p) => ({ r: Math.round(p.r * k), c: Math.round(p.c * k) }));
}

export function defaultTeeth(size: number): Pos[] {
  const e = size - 1;
  return [
    { r: 0, c: 0 },
    { r: 0, c: e },
    { r: e, c: 0 },
    { r: e, c: e },
  ];
}

export function validateConfig(cfg: GameConfig): string | null {
  const n = cfg.players.length;
  if (n < 2 || n > MAX_PLAYERS) return `need 2–${MAX_PLAYERS} players, got ${n}`;
  if (cfg.rules === 'classic' && n > MAX_CLASSIC_PLAYERS) return `classic rules allow up to ${MAX_CLASSIC_PLAYERS} players`;
  if (!Number.isInteger(cfg.size) || cfg.size < MIN_SIZE || cfg.size > MAX_SIZE) return `board size must be ${MIN_SIZE}–${MAX_SIZE}`;
  const heads = cfg.heads ?? defaultHeads(n, cfg.size);
  if (heads.length !== n) return 'heads must match player count';
  const seen = new Set<number>();
  for (const h of heads) {
    if (h.r < 0 || h.c < 0 || h.r >= cfg.size || h.c >= cfg.size) return 'head off board';
    const k = h.r * cfg.size + h.c;
    if (seen.has(k)) return 'duplicate head position';
    seen.add(k);
  }
  if (cfg.biteStep < 0 || cfg.maxBiteLevel < 1) return 'bad bite settings';
  if (cfg.classicCpuGrowMin < 1 || cfg.classicCpuGrowMax < cfg.classicCpuGrowMin) return 'bad classic CPU grow range';
  return null;
}
