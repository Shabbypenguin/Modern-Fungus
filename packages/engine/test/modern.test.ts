import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZES,
  applyAction,
  biteStarts,
  checkBite,
  classicConfig,
  classicCpuTurn,
  createGame,
  hasAnyPlacement,
  layoutUnfairness,
  legalPlacements,
  minModernSize,
  modernConfig,
} from '../src/index.js';
import type { GameState, Pos } from '../src/index.js';

const players = (n: number, kind: 'human' | 'cpu-classic' = 'human') =>
  Array.from({ length: n }, (_, i) => ({ name: `p${i}`, kind }));
const dist = (a: Pos, b: Pos) => Math.hypot(a.r - b.r, a.c - b.c);

describe('modern layout', () => {
  for (let n = 2; n <= 16; n++) {
    const sizes = BOARD_SIZES.map((b) => b.size).filter((sz) => sz >= minModernSize(n));
    it(`${n} players: valid, regular and fair on every offered size (${sizes.join(', ')})`, () => {
      expect(sizes.length).toBeGreaterThan(0);
      for (const size of sizes) {
        const cfg = modernConfig(players(n), size);
        const s = createGame(cfg, 1);
        const heads = s.players.map((p) => p.head);
        const mid = (size - 1) / 2;
        // Regular polygon: every head the same distance from the centre (grid rounding ≤ 1 cell).
        const radii = heads.map((h) => dist(h, { r: mid, c: mid }));
        expect(Math.max(...radii) - Math.min(...radii)).toBeLessThanOrEqual(1.3);
        // Neighbours are spaced evenly and not cramped.
        if (n > 2) {
          const gaps = heads.map((h, i) => dist(h, heads[(i + 1) % n]!));
          expect(Math.min(...gaps)).toBeGreaterThanOrEqual(4.5);
          expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1.3);
        }
        // Teeth: none on a head, and every player sees the same distances to them.
        const teeth = cfg.teeth!;
        for (const t of teeth) {
          expect(heads.some((h) => h.r === t.r && h.c === t.c)).toBe(false);
          expect(t.r >= 0 && t.c >= 0 && t.r < size && t.c < size).toBe(true);
        }
        // Between-neighbour teeth sit outfield: further from the centre than the spawn ring.
        const outer = teeth.filter((t) => dist(t, { r: mid, c: mid }) > 2);
        expect(outer.length).toBe(n);
        for (const t of outer) expect(dist(t, { r: mid, c: mid })).toBeGreaterThan(Math.max(...radii) + 0.5);
        const profile = (h: Pos) => teeth.map((t) => dist(h, t)).sort((a, b) => a - b);
        const ref = profile(heads[0]!);
        for (const h of heads) profile(h).forEach((d, i) => expect(Math.abs(d - ref[i]!)).toBeLessThanOrEqual(1.3));
        expect(layoutUnfairness(heads, teeth, size)).toBeLessThanOrEqual(1.3);
      }
    });
  }

  it('a 4-player modern square matches the classic seat order (TL, TR, BR, BL)', () => {
    const h = modernConfig(players(4), 20).heads!;
    expect(h[0]!.r < 10 && h[0]!.c < 10).toBe(true);
    expect(h[1]!.r < 10 && h[1]!.c > 10).toBe(true);
    expect(h[2]!.r > 10 && h[2]!.c > 10).toBe(true);
    expect(h[3]!.r > 10 && h[3]!.c < 10).toBe(true);
  });

  it('bite step keeps the original ratio: 80 at 20×20 with 4 players', () => {
    expect(modernConfig(players(4), 20).biteStep).toBe(80);
    expect(modernConfig(players(16), 100).biteStep).toBe(500);
  });

  it('classic rules on a big board keep the original constants and corner teeth', () => {
    const s = createGame(classicConfig(players(4), { size: 100 }), 1);
    expect(s.config.biteStep).toBe(80);
    expect(s.teeth.reduce((a, b) => a + b, 0)).toBe(4);
    expect(s.players[0]!.head).toEqual({ r: 26, c: 26 });
  });

  it('16 players need at least the XL board', () => {
    expect(minModernSize(2)).toBe(20);
    expect(minModernSize(8)).toBe(20);
    expect(minModernSize(16)).toBe(50);
  });
});

describe('fast move checks agree with the slow ones', () => {
  it('biteStarts and hasAnyPlacement match checkBite / legalPlacements', () => {
    let s: GameState = createGame(modernConfig(players(6, 'cpu-classic'), 35), 3);
    for (let t = 0; t < 120 && s.winner === null; t++) {
      for (const a of classicCpuTurn(s)) {
        const r = applyAction(s, s.current, a);
        if (!r.ok) throw new Error(r.error);
        s = r.state;
        if (s.winner !== null) break;
      }
      if (t % 20 !== 0) continue;
      for (let p = 0; p < s.players.length; p++) {
        if (!s.players[p]!.alive) continue;
        const probe = structuredClone(s);
        probe.players[p]!.bites = 1;
        const slow: string[] = [];
        for (let r = 0; r < s.size; r++)
          for (let c = 0; c < s.size; c++) if (checkBite(probe, p, [{ r, c }]) === null) slow.push(`${r},${c}`);
        expect(biteStarts(probe, p).map((q) => `${q.r},${q.c}`)).toEqual(slow);
        expect(hasAnyPlacement(s, p)).toBe(legalPlacements(s, p).length > 0);
      }
    }
  });
});

describe('performance', () => {
  it('a 16-player Massive (100×100) game runs 400 CPU turns quickly', () => {
    let s = createGame(modernConfig(players(16, 'cpu-classic'), 100), 11);
    const t0 = performance.now();
    for (let t = 0; t < 400 && s.winner === null; t++) {
      for (const a of classicCpuTurn(s)) {
        const r = applyAction(s, s.current, a);
        if (!r.ok) throw new Error(r.error);
        s = r.state;
        if (s.winner !== null) break;
      }
    }
    const perTurn = (performance.now() - t0) / 400;
    expect(perTurn).toBeLessThan(20); // ms per CPU turn, including validation and state copy
  });
});

describe('modern options', () => {
  it('New teeth speeds are ordered and Normal matches 1994', () => {
    const order = ['veryslow', 'slow', 'normal', 'fast', 'veryfast'] as const;
    const avg = order.map((sp) => {
      const c = modernConfig(players(4), 20, {}, { newTeeth: sp });
      return c.toothBase + (c.toothJitter - 1) / 2;
    });
    for (let i = 1; i < avg.length; i++) expect(avg[i]!).toBeLessThan(avg[i - 1]!);
    const normal = modernConfig(players(4), 20);
    expect([normal.toothBase, normal.toothJitter]).toEqual([8, 6]);
  });

  it('Bite growth speeds are ordered and Normal matches 1994', () => {
    const order = ['veryslow', 'slow', 'normal', 'fast', 'veryfast'] as const;
    const steps = order.map((sp) => modernConfig(players(4), 20, {}, { biteGrowth: sp }).biteStep);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeLessThan(steps[i - 1]!);
    expect(steps[2]).toBe(80);
  });

  it('fast new teeth actually arrive faster in play', () => {
    const firstToothRound = (sp: 'veryslow' | 'veryfast') => {
      let s = createGame(modernConfig(players(2), 20, { stalemateTurns: 0 }, { newTeeth: sp }), 5);
      while (s.players[0]!.bites === 0) {
        const r = applyAction(s, s.current, { type: 'pass' });
        if (!r.ok) throw new Error(r.error);
        s = r.state;
      }
      return s.round;
    };
    expect(firstToothRound('veryfast')).toBeLessThan(firstToothRound('veryslow'));
  });
});

describe('game speed presets', () => {
  it('Normal with 4 players is the classic feel: 20×20, normal teeth and bites', async () => {
    const { gameSpeedSettings } = await import('../src/index.js');
    expect(gameSpeedSettings('normal', 4)).toEqual({ boardSize: 20, newTeeth: 'normal', biteGrowth: 'normal' });
  });
  it('presets always fit the player count and round-trip through matchGameSpeed', async () => {
    const { GAME_SPEEDS, gameSpeedSettings, matchGameSpeed } = await import('../src/index.js');
    for (let n = 2; n <= 16; n++)
      for (const g of GAME_SPEEDS) {
        const set = gameSpeedSettings(g.id, n);
        expect(set.boardSize).toBeGreaterThanOrEqual(minModernSize(n));
        expect(matchGameSpeed(set, n)).toBe(g.id);
      }
  });
  it('slower presets never use a smaller board than faster ones', async () => {
    const { GAME_SPEEDS, gameSpeedSettings } = await import('../src/index.js');
    for (let n = 2; n <= 16; n++) {
      const sizes = GAME_SPEEDS.map((g) => gameSpeedSettings(g.id, n).boardSize);
      for (let i = 1; i < sizes.length; i++) expect(sizes[i]!).toBeLessThanOrEqual(sizes[i - 1]!);
    }
  });
});

describe('comfortable preset boards', () => {
  it('Normal never starts neighbours closer than the 1994 game', async () => {
    const { gameSpeedSettings, circleHeads } = await import('../src/index.js');
    for (let n = 2; n <= 16; n++) {
      const { boardSize } = gameSpeedSettings('normal', n);
      const h = circleHeads(n, boardSize);
      const gap = Math.min(...h.map((p, i) => Math.hypot(p.r - h[(i + 1) % n]!.r, p.c - h[(i + 1) % n]!.c)));
      if (boardSize < 100) expect(gap).toBeGreaterThanOrEqual(8.5);
    }
  });
  it('6 players get Large on Normal; Fastest may squeeze to Classic', async () => {
    const { gameSpeedSettings } = await import('../src/index.js');
    expect(gameSpeedSettings('normal', 6).boardSize).toBe(35);
    expect(gameSpeedSettings('fastest', 6).boardSize).toBe(20);
    expect(gameSpeedSettings('normal', 4).boardSize).toBe(20);
  });
});
