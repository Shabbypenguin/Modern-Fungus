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
        for (const t of teeth) expect(heads.some((h) => h.r === t.r && h.c === t.c)).toBe(false);
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
