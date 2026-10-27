import { describe, expect, it } from 'vitest';
import { applyAction, classicConfig, createGame, greedyCpuTurn, modernConfig, stateHash } from '../src/index.js';
import type { GameState } from '../src/index.js';

const run = (s: GameState, turns: number, pick: (s: GameState) => ReturnType<typeof greedyCpuTurn>) => {
  for (let t = 0; t < turns && s.winner === null; t++)
    for (const a of pick(s)) {
      const r = applyAction(s, s.current, a);
      if (!r.ok) throw new Error(`illegal ${a.type}: ${r.error}`);
      s = r.state;
      if (s.winner !== null) break;
    }
  return s;
};

describe('greedy (stand-in) CPU', () => {
  it('only produces legal human-rule actions', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const s = createGame(classicConfig(Array.from({ length: 4 }, (_, i) => ({ name: `h${i}`, kind: 'human' as const }))), seed);
      run(s, 200, greedyCpuTurn);
    }
  });
  it('beats a passive opponent', () => {
    let s = createGame(classicConfig([{ name: 'cpu', kind: 'human' }, { name: 'idle', kind: 'human' }]), 3);
    for (let t = 0; t < 400 && s.winner === null; t++) {
      const acts = s.current === 0 ? greedyCpuTurn(s) : [{ type: 'pass' as const }];
      for (const a of acts) {
        const r = applyAction(s, s.current, a);
        if (!r.ok) throw new Error(r.error);
        s = r.state;
      }
    }
    expect(s.winner).toBe(0);
  });
  it('is fast enough on a Massive board', () => {
    let s = createGame(modernConfig(Array.from({ length: 16 }, (_, i) => ({ name: `h${i}`, kind: 'human' as const })), 100), 2);
    const t0 = performance.now();
    s = run(s, 32, greedyCpuTurn);
    expect((performance.now() - t0) / 32).toBeLessThan(150);
  });
});

describe('stateHash', () => {
  it('is stable for equal states and changes after a move', () => {
    const s = createGame(classicConfig([{ name: 'a', kind: 'human' }, { name: 'b', kind: 'human' }]), 9);
    expect(stateHash(s)).toBe(stateHash(structuredClone(s)));
    const r = applyAction(s, 0, { type: 'pass' });
    expect(r.ok && stateHash(r.state)).not.toBe(stateHash(s));
  });
});
