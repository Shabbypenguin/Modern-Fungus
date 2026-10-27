import { defaultHeads, defaultTeeth, validateConfig } from './config.js';
import { Rng } from './rng.js';
import { SHAPES, shapeCells } from './shapes.js';
import type { Action, ActionResult, GameConfig, GameEvent, GameState, Pos } from './types.js';

/**
 * Capture directions in the original's order (CODE 3 @ 0x0298A).
 * Odd indices are diagonals.
 */
const DIRS: readonly Pos[] = [
  { r: 0, c: -1 },
  { r: 1, c: -1 },
  { r: 1, c: 0 },
  { r: 1, c: 1 },
  { r: 0, c: 1 },
  { r: -1, c: 1 },
  { r: -1, c: 0 },
  { r: -1, c: -1 },
];
const ORTHO: readonly Pos[] = [
  { r: -1, c: 0 },
  { r: 1, c: 0 },
  { r: 0, c: -1 },
  { r: 0, c: 1 },
];

// ---------------------------------------------------------------- creation

export function createGame(config: GameConfig, seed: number): GameState {
  const err = validateConfig(config);
  if (err) throw new Error(`invalid config: ${err}`);
  const size = config.size;
  const heads = config.heads ?? defaultHeads(config.players.length, size);
  const cells = new Array<number>(size * size).fill(0);
  const teeth = new Array<number>(size * size).fill(0);
  heads.forEach((h, i) => (cells[h.r * size + h.c] = i + 1));
  for (const t of config.teeth ?? defaultTeeth(size)) {
    const k = t.r * size + t.c;
    if (cells[k] === 0) teeth[k] = 1;
  }
  const rng = new Rng(seed);
  const round = 1;
  const cfg = structuredClone(config);
  // One shared roll for everyone, fixed for the whole game (and replayed identically from the seed).
  // The rolled value replaces the range, so the state's config is final and can't be rolled twice.
  if (cfg.biteRoll) {
    cfg.biteStep += cfg.biteRoll.min + rng.int(cfg.biteRoll.max - cfg.biteRoll.min + 1);
    delete cfg.biteRoll;
  }
  const state: GameState = {
    version: 1,
    config: cfg,
    size,
    cells,
    teeth,
    players: config.players.map((p, i) => ({
      name: p.name,
      kind: p.kind,
      difficulty: p.difficulty ?? 0.5,
      alive: true,
      head: { ...heads[i]! },
      bites: config.startBites,
    })),
    current: 0,
    piece: rng.int(SHAPES.length),
    round,
    nextToothRound: round + config.toothBase + rng.int(Math.max(1, config.toothJitter)),
    passStreak: 0,
    turn: 0,
    winner: null,
    rngSeed: rng.seed,
  };
  return state;
}

// ---------------------------------------------------------------- queries

export const idx = (s: GameState, r: number, c: number): number => r * s.size + c;
export const inBounds = (s: GameState, r: number, c: number): boolean =>
  r >= 0 && c >= 0 && r < s.size && c < s.size;
export const ownerAt = (s: GameState, r: number, c: number): number => s.cells[r * s.size + c]! - 1;

export function cellCount(s: GameState, p: number): number {
  let n = 0;
  for (const v of s.cells) if (v === p + 1) n++;
  return n;
}

/** 1 = Bites, 2 = Big Bites, 3 = Monster Bites (CODE 3 @ 0x027CA). */
export function biteLevel(s: GameState, p: number): number {
  const step = s.config.biteStep;
  if (step <= 0) return 1;
  return Math.min(s.config.maxBiteLevel, 1 + Math.floor(cellCount(s, p) / step));
}

export function isHead(s: GameState, r: number, c: number): boolean {
  return s.players.some((pl) => pl.alive && pl.head.r === r && pl.head.c === c);
}

function touchesOwn(s: GameState, p: number, r: number, c: number): boolean {
  return ORTHO.some((d) => inBounds(s, r + d.r, c + d.c) && ownerAt(s, r + d.r, c + d.c) === p);
}

/** Cells of player p orthogonally connected to p's head (as a Set of indices). */
function connectedToHead(s: GameState, p: number): Set<number> {
  const seen = new Set<number>();
  const pl = s.players[p]!;
  const start = idx(s, pl.head.r, pl.head.c);
  if (s.cells[start] !== p + 1) return seen;
  const stack = [start];
  seen.add(start);
  while (stack.length) {
    const k = stack.pop()!;
    const r = Math.floor(k / s.size);
    const c = k % s.size;
    for (const d of ORTHO) {
      const rr = r + d.r;
      const cc = c + d.c;
      if (!inBounds(s, rr, cc)) continue;
      const kk = idx(s, rr, cc);
      if (!seen.has(kk) && s.cells[kk] === p + 1) {
        seen.add(kk);
        stack.push(kk);
      }
    }
  }
  return seen;
}

/** Absolute cells a placement would cover, or an error. */
export function checkPlacement(s: GameState, p: number, rotation: number, r: number, c: number): Pos[] | string {
  const cells = shapeCells(s.piece, rotation).map((o) => ({ r: r + o.r, c: c + o.c }));
  let touching = false;
  for (const q of cells) {
    if (!inBounds(s, q.r, q.c)) return 'off board';
    if (s.cells[idx(s, q.r, q.c)] !== 0) return 'cell occupied';
    if (touchesOwn(s, p, q.r, q.c)) touching = true;
  }
  return touching ? cells : 'must touch your fungus (edge to edge)';
}

/** Every legal (rotation, r, c) for the current piece. */
export function legalPlacements(s: GameState, p: number): { rotation: number; r: number; c: number }[] {
  const out: { rotation: number; r: number; c: number }[] = [];
  const rots = SHAPES[s.piece]!.masks.length;
  for (let rot = 0; rot < rots; rot++) {
    for (let r = -3; r < s.size; r++) {
      for (let c = -3; c < s.size; c++) {
        if (typeof checkPlacement(s, p, rot, r, c) !== 'string') out.push({ rotation: rot, r, c });
      }
    }
  }
  return out;
}

/** Validates a bite line (CODE 3 @ 0x0239E). Returns null if legal. */
export function checkBite(s: GameState, p: number, cells: Pos[]): string | null {
  if (s.players[p]!.bites < 1) return 'no bites';
  if (cells.length < 1) return 'empty bite';
  // A single cell is always within level (≥1); only count cells for longer bites.
  if (cells.length > 1 && cells.length > biteLevel(s, p)) return 'bite too long for your size';
  const first = cells[0]!;
  if (!inBounds(s, first.r, first.c) || !touchesOwn(s, p, first.r, first.c)) return 'bite must start next to your fungus';
  let dir: Pos | null = null;
  for (let i = 0; i < cells.length; i++) {
    const q = cells[i]!;
    if (!inBounds(s, q.r, q.c)) return 'off board';
    const o = ownerAt(s, q.r, q.c);
    if (o < 0) return 'can only bite enemy fungus';
    if (o === p) return 'cannot bite yourself';
    if (isHead(s, q.r, q.c)) return 'heads cannot be bitten';
    if (i > 0) {
      const prev = cells[i - 1]!;
      const d = { r: q.r - prev.r, c: q.c - prev.c };
      if (Math.abs(d.r) + Math.abs(d.c) !== 1) return 'bite must be a straight line';
      if (dir && (dir.r !== d.r || dir.c !== d.c)) return 'bite must be a straight line';
      dir = d;
    }
  }
  return null;
}

/** Validates a classic-CPU trail: each cell empty and edge-adjacent to own fungus or an earlier trail cell. */
export function checkGrow(s: GameState, p: number, cells: Pos[]): string | null {
  if (s.players[p]!.kind !== 'cpu-classic') return 'grow is only for the classic CPU';
  if (cells.length < 1 || cells.length > s.config.classicCpuGrowMax) return 'bad trail length';
  const trail = new Set<number>();
  for (const q of cells) {
    if (!inBounds(s, q.r, q.c)) return 'off board';
    const k = idx(s, q.r, q.c);
    if (s.cells[k] !== 0 || trail.has(k)) return 'cell occupied';
    const ok =
      touchesOwn(s, p, q.r, q.c) ||
      ORTHO.some((d) => trail.has(idx(s, q.r + d.r, q.c + d.c)) && inBounds(s, q.r + d.r, q.c + d.c));
    if (!ok) return 'trail must stay connected';
    trail.add(k);
  }
  return null;
}

/** Cells where p could start a bite right now (enemy body next to p's fungus). */
export function biteStarts(s: GameState, p: number): Pos[] {
  if (s.players[p]!.bites < 1) return [];
  const out: Pos[] = [];
  for (let r = 0; r < s.size; r++)
    for (let c = 0; c < s.size; c++) {
      const v = s.cells[r * s.size + c]!;
      if (v && v !== p + 1 && touchesOwn(s, p, r, c) && !isHead(s, r, c)) out.push({ r, c });
    }
  return out;
}

/** True if any placement of the current piece is legal (stops at the first one). */
export function hasAnyPlacement(s: GameState, p: number): boolean {
  const rots = SHAPES[s.piece]!.masks.length;
  // Only anchors near own cells can touch them: scan own cells' neighbourhoods.
  for (let k = 0; k < s.cells.length; k++) {
    if (s.cells[k] !== p + 1) continue;
    const r0 = Math.floor(k / s.size);
    const c0 = k % s.size;
    for (let rot = 0; rot < rots; rot++)
      for (let r = r0 - 4; r <= r0 + 1; r++)
        for (let c = c0 - 4; c <= c0 + 1; c++) if (typeof checkPlacement(s, p, rot, r, c) !== 'string') return true;
  }
  return false;
}

/** True if the player can do anything except pass. */
export function hasAnyMove(s: GameState, p: number): boolean {
  return hasAnyPlacement(s, p) || biteStarts(s, p).length > 0;
}

// ---------------------------------------------------------------- mutation

class Ctx {
  events: GameEvent[] = [];
  /** 1 = needs disconnection check, 2 = head captured. */
  flags: number[];
  rng: Rng;
  levels: number[];
  /** Live cell count per player, so level checks stay O(1) on 100×100 boards. */
  counts: number[];
  constructor(public s: GameState) {
    this.flags = s.players.map(() => 0);
    this.rng = new Rng(s.rngSeed);
    this.counts = s.players.map(() => 0);
    for (const v of s.cells) if (v) this.counts[v - 1]!++;
    this.levels = s.players.map((_, i) => this.level(i));
  }

  level(p: number): number {
    const step = this.s.config.biteStep;
    if (step <= 0) return 1;
    return Math.min(this.s.config.maxBiteLevel, 1 + Math.floor(this.counts[p]! / step));
  }

  /** Every board write goes through here to keep counts exact. */
  set(k: number, v: number): void {
    const old = this.s.cells[k]!;
    if (old === v) return;
    if (old) this.counts[old - 1]!--;
    if (v) this.counts[v - 1]!++;
    this.s.cells[k] = v;
  }

  pos(k: number): Pos {
    return { r: Math.floor(k / this.s.size), c: k % this.s.size };
  }

  noteLevel(p: number): void {
    const lv = this.level(p);
    if (lv !== this.levels[p]) {
      this.levels[p] = lv;
      this.events.push({ type: 'biteLevel', player: p, level: lv });
    }
  }

  /** Make cell k belong to p, then run the capture search from it (CODE 3 @ 0x0184E). */
  claim(k: number, p: number): void {
    const s = this.s;
    const o = s.cells[k]! - 1;
    if (o >= 0 && o !== p) {
      const victim = s.players[o]!;
      if (victim.alive) {
        this.flags[o] = Math.max(this.flags[o]!, 1);
        const pos = this.pos(k);
        if (victim.head.r === pos.r && victim.head.c === pos.c) {
          victim.alive = false;
          this.flags[o] = 2;
        }
      }
      this.events.push({ type: 'captured', player: p, from: o, pos: this.pos(k) });
    }
    this.set(k, p + 1);
    this.captureFrom(k, p);
    this.noteLevel(p);
  }

  /** Othello-style search in 8 directions with chain reactions (CODE 3 @ 0x02852). */
  captureFrom(k: number, p: number): void {
    const s = this.s;
    const { r, c } = this.pos(k);
    for (let d = 0; d < DIRS.length; d++) {
      const diagonal = d % 2 === 1;
      if (diagonal && !s.config.diagonalCapture) continue;
      const dr = DIRS[d]!.r;
      const dc = DIRS[d]!.c;
      let rr = r + dr;
      let cc = c + dc;
      let steps = 0;
      while (inBounds(s, rr, cc)) {
        const v = s.cells[idx(s, rr, cc)]!;
        if (v === 0 || v === p + 1) break;
        steps++;
        rr += dr;
        cc += dc;
      }
      if (steps === 0 || !inBounds(s, rr, cc) || s.cells[idx(s, rr, cc)] !== p + 1) continue;
      const first = idx(s, r + dr, c + dc);
      if (s.cells[first] === p + 1) continue; // already converted by a chain reaction
      this.claim(first, p);
      // A diagonal capture that isn't edge-connected to our head is destroyed (CODE 3 @ 0x0291E).
      if (diagonal && s.cells[first] === p + 1 && !connectedToHead(s, p).has(first)) {
        this.set(first, 0);
        this.events.push({ type: 'died', player: p, pos: this.pos(first) });
        this.noteLevel(p);
      }
    }
  }

  /** Remove p's cells that are no longer edge-connected to p's head (CODE 3 @ 0x02B60). */
  disconnect(p: number): void {
    const s = this.s;
    const keep = connectedToHead(s, p);
    for (let k = 0; k < s.cells.length; k++) {
      if (s.cells[k] === p + 1 && !keep.has(k)) {
        this.set(k, 0);
        this.events.push({ type: 'died', player: p, pos: this.pos(k) });
      }
    }
    this.noteLevel(p);
  }

  /** Killer takes every cell and all bites of the victim (CODE 3 @ 0x01A72). */
  inherit(victim: number, killer: number): void {
    const s = this.s;
    for (let k = 0; k < s.cells.length; k++) {
      if (s.cells[k] === victim + 1) this.claim(k, killer);
    }
    const taken = s.players[victim]!.bites;
    s.players[killer]!.bites += taken;
    s.players[victim]!.bites = 0;
    this.events.push({ type: 'killed', player: killer, victim, bitesTaken: taken });
    this.noteLevel(killer);
  }

  /** Process queued disconnections and kills until nothing is pending. */
  resolve(p: number): void {
    let guard = 0;
    for (;;) {
      const o = this.flags.findIndex((f, i) => f > 0 && i !== p);
      if (o < 0 || guard++ > 64) break;
      const f = this.flags[o]!;
      this.flags[o] = 0;
      if (f === 2) this.inherit(o, p);
      else if (this.s.players[o]!.alive) this.disconnect(o);
    }
    this.flags[p] = 0;
  }

  /** Lay down new cells for p (placement or classic trail), then capture. */
  grow(p: number, cells: Pos[]): void {
    const s = this.s;
    const ks = cells.map((q) => idx(s, q.r, q.c));
    this.events.push({ type: 'placed', player: p, cells: cells.map((q) => ({ ...q })) });
    for (const k of ks) {
      if (s.teeth[k]) {
        s.teeth[k] = 0;
        s.players[p]!.bites += s.config.toothBites;
        this.events.push({ type: 'tooth', player: p, pos: this.pos(k) });
      }
      this.set(k, p + 1);
    }
    for (const k of ks) if (s.cells[k] === p + 1) this.claim(k, p);
    this.resolve(p);
  }

  checkWinner(): boolean {
    const alive = this.s.players.flatMap((pl, i) => (pl.alive ? [i] : []));
    if (alive.length === 1) {
      this.s.winner = alive[0]!;
      this.events.push({ type: 'gameOver', winner: alive[0]!, reason: 'last-alive' });
      return true;
    }
    return false;
  }

  /** Advance to the next living seat; handles rounds and tooth regrowth (CODE 3 @ 0x00276). */
  endTurn(progress: boolean): void {
    const s = this.s;
    s.turn++;
    s.passStreak = progress ? 0 : s.passStreak + 1;
    if (s.config.stalemateTurns > 0 && s.passStreak >= s.config.stalemateTurns) {
      let best = -1;
      let bestN = -1;
      s.players.forEach((pl, i) => {
        const n = pl.alive ? this.counts[i]! : -1;
        if (n > bestN) {
          best = i;
          bestN = n;
        }
      });
      s.winner = best;
      this.events.push({ type: 'gameOver', winner: best, reason: 'stalemate' });
      return;
    }
    let next = s.current;
    do {
      next++;
      if (next >= s.players.length) {
        next = 0;
        s.round++;
        if (s.round === s.nextToothRound) {
          for (const pl of s.players) if (pl.alive) pl.bites++;
          this.events.push({ type: 'toothRegrow', round: s.round });
          s.nextToothRound = s.round + s.config.toothBase + this.rng.int(Math.max(1, s.config.toothJitter));
        }
      }
    } while (!s.players[next]!.alive);
    s.current = next;
    s.piece = this.rng.int(SHAPES.length);
    this.events.push({ type: 'turn', player: next, piece: s.piece, round: s.round });
  }
}

/**
 * Apply one action for player p. Pure: the input state is never modified.
 * Bites do not end the turn; place / grow / pass do.
 */
export function applyAction(state: GameState, p: number, action: Action): ActionResult {
  if (state.winner !== null) return { ok: false, error: 'game is over' };
  if (p !== state.current) return { ok: false, error: 'not your turn' };
  const s = structuredClone(state);
  const ctx = new Ctx(s);

  switch (action.type) {
    case 'place': {
      if (s.players[p]!.kind === 'cpu-classic') return { ok: false, error: 'classic CPU must grow' };
      const cells = checkPlacement(s, p, action.rotation, action.r, action.c);
      if (typeof cells === 'string') return { ok: false, error: cells };
      ctx.grow(p, cells);
      if (!ctx.checkWinner()) ctx.endTurn(true);
      break;
    }
    case 'grow': {
      const err = checkGrow(s, p, action.cells);
      if (err) return { ok: false, error: err };
      ctx.grow(p, action.cells);
      if (!ctx.checkWinner()) ctx.endTurn(true);
      break;
    }
    case 'bite': {
      const err = checkBite(s, p, action.cells);
      if (err) return { ok: false, error: err };
      for (const q of action.cells) {
        const k = idx(s, q.r, q.c);
        const o = s.cells[k]! - 1;
        ctx.flags[o] = Math.max(ctx.flags[o]!, 1);
        ctx.set(k, 0);
        ctx.events.push({ type: 'bitten', player: p, victim: o, pos: { ...q } });
      }
      s.players[p]!.bites--;
      ctx.resolve(p);
      s.passStreak = 0;
      break;
    }
    case 'pass':
      ctx.endTurn(false);
      break;
    default:
      return { ok: false, error: 'unknown action' };
  }

  s.rngSeed = ctx.rng.seed;
  return { ok: true, state: s, events: ctx.events };
}
