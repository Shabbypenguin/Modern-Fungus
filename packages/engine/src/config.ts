import type { GameConfig, PlayerConfig, Pos } from './types.js';

export const CLASSIC_SIZE = 20;
export const MAX_PLAYERS = 16;

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

export function classicConfig(players: PlayerConfig[], overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    size: CLASSIC_SIZE,
    players,
    startBites: 0,
    toothBites: 1,
    biteStep: 80,
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

/**
 * Default head layout. 2–4 players use the original positions (scaled to the
 * board size). More players [ours] are spaced evenly on a ring at ~30% inset.
 */
export function defaultHeads(n: number, size: number): Pos[] {
  const classic = CLASSIC_HEADS[n];
  if (classic) {
    const k = (size - 1) / (CLASSIC_SIZE - 1);
    return classic.map((p) => ({ r: Math.round(p.r * k), c: Math.round(p.c * k) }));
  }
  const mid = (size - 1) / 2;
  const radius = (size - 1) * 0.35;
  const out: Pos[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI * 0.75;
    out.push({ r: Math.round(mid + radius * Math.sin(a)), c: Math.round(mid + radius * Math.cos(a)) });
  }
  return out;
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
  if (!Number.isInteger(cfg.size) || cfg.size < 10 || cfg.size > 64) return `board size must be 10–64`;
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
