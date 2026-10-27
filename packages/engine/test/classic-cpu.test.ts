import { describe, expect, it } from 'vitest';
import { applyAction, classicConfig, classicCpuTurn, createGame } from '../src/index.js';
import type { GameState } from '../src/index.js';

function playCpuGame(seed: number, n: number, maxTurns = 2000): GameState {
  let s = createGame(
    classicConfig(Array.from({ length: n }, (_, i) => ({ name: `cpu${i}`, kind: 'cpu-classic' as const }))),
    seed,
  );
  for (let t = 0; t < maxTurns && s.winner === null; t++) {
    for (const a of classicCpuTurn(s)) {
      const r = applyAction(s, s.current, a);
      if (!r.ok) throw new Error(`CPU produced illegal ${a.type}: ${r.error} (seed ${seed}, turn ${t})`);
      s = r.state;
      if (s.winner !== null) break;
    }
  }
  return s;
}

describe('classic CPU', () => {
  it('only ever produces legal actions, across many seeds', () => {
    for (let seed = 1; seed <= 25; seed++) playCpuGame(seed, 2 + (seed % 3));
  });
  it('games finish with a winner', () => {
    const finished = Array.from({ length: 10 }, (_, i) => playCpuGame(100 + i, 4)).filter((s) => s.winner !== null);
    expect(finished.length).toBeGreaterThanOrEqual(8);
  });
  it('grows 5–6 cells per turn on an open board', () => {
    const s = createGame(classicConfig([{ name: 'a', kind: 'cpu-classic' }, { name: 'b', kind: 'human' }]), 3);
    const grow = classicCpuTurn(s).find((a) => a.type === 'grow');
    expect(grow && grow.type === 'grow' && grow.cells.length).toBeGreaterThanOrEqual(5);
  });
  it('is deterministic for a given state', () => {
    const s = createGame(classicConfig([{ name: 'a', kind: 'cpu-classic' }, { name: 'b', kind: 'cpu-classic' }]), 8);
    expect(classicCpuTurn(s)).toEqual(classicCpuTurn(s));
  });
});
