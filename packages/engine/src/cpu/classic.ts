/**
 * The original Fungus 2.0 CPU (CODE 3 @ 0x01B3E), reproduced for nostalgia.
 *
 * It ignores the dealt piece. Each turn it:
 *   1. picks a random living opponent and aims within ±4 cells of their head;
 *   2. starts from its own frontier cell closest to that point (10%: a random own cell);
 *   3. if it has bites, 60% of the time bites a straight line toward the target;
 *   4. grows a 5–6 cell trail toward the target, sidestepping 15% of the time.
 *
 * Deviations [ours]: the original scanned only rows/cols < 16 for frontier
 * neighbours (a bug) and could bite non-target heads; both are fixed here.
 * Pure and deterministic: randomness is derived from the state, not Math.random.
 */
import { biteLevel, checkBite, checkGrow, idx, inBounds, ownerAt } from '../game.js';
import { Rng } from '../rng.js';
import type { Action, GameState, Pos } from '../types.js';

const ORTHO: readonly Pos[] = [
  { r: -1, c: 0 },
  { r: 1, c: 0 },
  { r: 0, c: -1 },
  { r: 0, c: 1 },
];

function dirToward(from: Pos, to: Pos): Pos {
  const dr = to.r - from.r;
  const dc = to.c - from.c;
  if (Math.abs(dc) > Math.abs(dr)) return { r: 0, c: Math.sign(dc) || 1 };
  return { r: Math.sign(dr) || 1, c: 0 };
}

function ownCells(s: GameState, p: number): Pos[] {
  const out: Pos[] = [];
  for (let k = 0; k < s.cells.length; k++) if (s.cells[k] === p + 1) out.push({ r: Math.floor(k / s.size), c: k % s.size });
  return out;
}

function isEmpty(s: GameState, q: Pos, taken: Set<number>): boolean {
  return inBounds(s, q.r, q.c) && s.cells[idx(s, q.r, q.c)] === 0 && !taken.has(idx(s, q.r, q.c));
}

export function classicCpuTurn(state: GameState): Action[] {
  const s = state;
  const p = s.current;
  const me = s.players[p]!;
  const rng = new Rng((s.rngSeed ^ 0x9e3779b9 ^ Math.imul(s.turn + 1, 0x85ebca6b)) >>> 0);
  const actions: Action[] = [];

  const opponents = s.players.flatMap((pl, i) => (pl.alive && i !== p ? [i] : []));
  if (opponents.length === 0) return [{ type: 'pass' }];
  const target = opponents[rng.int(opponents.length)]!;
  const th = s.players[target]!.head;
  const aim: Pos = {
    r: Math.max(0, Math.min(s.size - 1, th.r + rng.signedMod(5))),
    c: Math.max(0, Math.min(s.size - 1, th.c + rng.signedMod(5))),
  };

  const mine = ownCells(s, p);
  const frontier = mine.filter((q) => ORTHO.some((d) => isEmpty(s, { r: q.r + d.r, c: q.c + d.c }, new Set())));
  let start: Pos;
  if (rng.chance(10) || frontier.length === 0) {
    start = mine[rng.int(mine.length)]!;
  } else {
    start = frontier.reduce((best, q) =>
      Math.hypot(q.r - aim.r, q.c - aim.c) < Math.hypot(best.r - aim.r, best.c - aim.c) ? q : best,
    );
  }

  // Bite toward the target.
  if (me.bites > 0 && rng.chance(60)) {
    const d = dirToward(start, aim);
    const line: Pos[] = [];
    let q = { r: start.r + d.r, c: start.c + d.c };
    const level = biteLevel(s, p);
    while (line.length < level && inBounds(s, q.r, q.c)) {
      const o = ownerAt(s, q.r, q.c);
      if (o < 0 || o === p) break;
      if (s.players.some((pl) => pl.alive && pl.head.r === q.r && pl.head.c === q.c)) break;
      line.push(q);
      q = { r: q.r + d.r, c: q.c + d.c };
    }
    if (line.length && checkBite(s, p, line) === null) actions.push({ type: 'bite', cells: line });
  }

  // Grow a trail. Planned on the pre-bite board: a bite only empties enemy cells,
  // so every cell chosen here is still empty and connected when the grow is applied.
  const steps = s.config.classicCpuGrowMin + rng.int(s.config.classicCpuGrowMax - s.config.classicCpuGrowMin + 1);
  const trail: Pos[] = [];
  const taken = new Set<number>();
  let cur = start;
  let restarts = 0;
  while (trail.length < steps && restarts < 20) {
    const primary = dirToward(cur, aim);
    const perp: Pos[] = primary.r === 0 ? [{ r: 1, c: 0 }, { r: -1, c: 0 }] : [{ r: 0, c: 1 }, { r: 0, c: -1 }];
    if (rng.int(2)) perp.reverse();
    const back = { r: -primary.r, c: -primary.c };
    const order = rng.chance(15) ? [perp[0]!, primary, perp[1]!, back] : [primary, perp[0]!, perp[1]!, back];
    const d = order.find((o) => isEmpty(s, { r: cur.r + o.r, c: cur.c + o.c }, taken));
    if (d) {
      const q = { r: cur.r + d.r, c: cur.c + d.c };
      trail.push(q);
      taken.add(idx(s, q.r, q.c));
      cur = q;
      continue;
    }
    // Stuck: restart from any own/trail cell that still has an empty neighbour.
    restarts++;
    const pool = [...frontier, ...trail].filter((f) =>
      ORTHO.some((o) => isEmpty(s, { r: f.r + o.r, c: f.c + o.c }, taken)),
    );
    if (pool.length === 0) break;
    cur = pool[rng.int(pool.length)]!;
  }

  if (trail.length && checkGrow(s, p, trail) === null) actions.push({ type: 'grow', cells: trail });
  else actions.push({ type: 'pass' });
  return actions;
}
