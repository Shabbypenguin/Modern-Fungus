/**
 * A CPU that plays by human rules (places the dealt piece, bites in lines).
 * Used to stand in for a disconnected online player, and the base for the
 * modern difficulty ladder later.
 *
 * Each turn:
 *   1. If it has bites, take the single bite that kills the most enemy cells
 *      (bitten + cut off), if that's worth at least `minBiteGain` cells.
 *   2. Place the piece where it gains the most cells (growth + captures),
 *      breaking ties by moving toward the nearest enemy head.
 * Pure and deterministic; big boards evaluate a deterministic sample.
 */
import { applyAction, biteStarts, cellCount, legalPlacements } from '../game.js';
import { Rng } from '../rng.js';
import type { Action, GameState, Pos } from '../types.js';

const MAX_CANDIDATES = 260;
const MIN_BITE_GAIN = 3;

function enemyCells(s: GameState, p: number): number {
  let n = 0;
  for (const v of s.cells) if (v && v !== p + 1) n++;
  return n;
}

function nearestEnemyHead(s: GameState, p: number, from: Pos): number {
  let best = Infinity;
  s.players.forEach((pl, i) => {
    if (i !== p && pl.alive) best = Math.min(best, Math.hypot(pl.head.r - from.r, pl.head.c - from.c));
  });
  return best === Infinity ? 0 : best;
}

function sample<T>(items: T[], n: number, rng: Rng): T[] {
  if (items.length <= n) return items;
  const out = items.slice();
  for (let i = 0; i < n; i++) {
    const j = i + rng.int(out.length - i);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out.slice(0, n);
}

export function greedyCpuTurn(state: GameState): Action[] {
  const p = state.current;
  const rng = new Rng((state.rngSeed ^ 0x5bd1e995 ^ Math.imul(state.turn + 7, 0x27d4eb2d)) >>> 0);
  const actions: Action[] = [];
  let s = state;

  // 1. Best single-cell bite.
  if (s.players[p]!.bites > 0) {
    const before = enemyCells(s, p);
    let best: { cell: Pos; gain: number } | null = null;
    for (const cell of sample(biteStarts(s, p), 80, rng)) {
      const r = applyAction(s, p, { type: 'bite', cells: [cell] });
      if (!r.ok) continue;
      const gain = before - enemyCells(r.state, p);
      if (!best || gain > best.gain) best = { cell, gain };
    }
    if (best && best.gain >= MIN_BITE_GAIN) {
      const r = applyAction(s, p, { type: 'bite', cells: [best.cell] });
      if (r.ok) {
        actions.push({ type: 'bite', cells: [best.cell] });
        s = r.state;
      }
    }
  }

  // 2. Best placement.
  const moves = sample(legalPlacements(s, p), MAX_CANDIDATES, rng);
  if (moves.length === 0) return [...actions, { type: 'pass' }];
  const mine = cellCount(s, p);
  let bestMove = moves[0]!;
  let bestScore = -Infinity;
  for (const m of moves) {
    const r = applyAction(s, p, { type: 'place', ...m });
    if (!r.ok) continue;
    const won = r.state.winner === p ? 1e6 : 0;
    const gain = cellCount(r.state, p) - mine;
    const kills = r.events.filter((e) => e.type === 'killed').length;
    const toward = -nearestEnemyHead(s, p, { r: m.r + 1, c: m.c + 1 }) * 0.05;
    const score = won + kills * 500 + gain * 10 + toward + rng.next() * 0.01;
    if (score > bestScore) {
      bestScore = score;
      bestMove = m;
    }
  }
  actions.push({ type: 'place', ...bestMove });
  return actions;
}
