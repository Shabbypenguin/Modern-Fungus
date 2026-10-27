import { describe, expect, it } from 'vitest';
import { SHAPES, applyAction, biteLevel, classicConfig, createGame, legalPlacements, shapeCells } from '../src/index.js';
import type { ActionResult, GameState } from '../src/index.js';
import { board, render } from './helpers.js';

const ok = (r: ActionResult): GameState => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const EMPTY = '..........';
/** Pad a partial board to 10 rows; last row holds extra heads. */
const rows = (top: string[], last = '.........C'): string[] => [...top, ...Array(9 - top.length).fill(EMPTY), last];
const humans = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `p${i}`, kind: 'human' as const }));

describe('C1 setup', () => {
  it('classic 4-player board matches the original', () => {
    const s = createGame(classicConfig(humans(4)), 42);
    expect(s.size).toBe(20);
    expect(s.players.map((p) => p.head)).toEqual([
      { r: 5, c: 5 },
      { r: 5, c: 14 },
      { r: 14, c: 14 },
      { r: 14, c: 5 },
    ]);
    expect(s.players.every((p) => p.bites === 0)).toBe(true);
    expect(s.teeth.flatMap((t, i) => (t ? [i] : []))).toEqual([0, 19, 380, 399]);
    expect(s.nextToothRound).toBeGreaterThanOrEqual(9);
    expect(s.nextToothRound).toBeLessThanOrEqual(14);
  });

  it('supports up to 16 players with distinct heads', () => {
    const s = createGame(classicConfig(humans(16), { size: 40 }), 1);
    expect(new Set(s.players.map((p) => `${p.head.r},${p.head.c}`)).size).toBe(16);
  });
});

describe('C3 pieces', () => {
  it('has exactly the 11 original shapes', () => {
    expect(SHAPES).toHaveLength(11);
    expect(SHAPES.map((sh) => shapeCells(sh.id, 0).length)).toEqual([1, 2, 3, 3, 4, 4, 4, 4, 4, 4, 4]);
  });
  it('every rotation keeps the cell count', () => {
    for (const sh of SHAPES)
      for (let r = 0; r < sh.masks.length; r++) expect(shapeCells(sh.id, r)).toHaveLength(shapeCells(sh.id, 0).length);
  });
});

describe('C4 placement', () => {
  const s = board(rows(['', '', '', '...A......'].map((r) => r || EMPTY), '.........B'), { piece: 1 }); // domino
  it('must touch own fungus edge to edge', () => {
    expect(applyAction(s, 0, { type: 'place', rotation: 0, r: 3, c: 4 }).ok).toBe(true);
    expect(applyAction(s, 0, { type: 'place', rotation: 0, r: 4, c: 4 }).ok).toBe(false);
  });
  it('cannot overlap or leave the board', () => {
    expect(applyAction(s, 0, { type: 'place', rotation: 0, r: 3, c: 2 }).ok).toBe(false);
    expect(applyAction(s, 0, { type: 'place', rotation: 1, r: -1, c: 3 }).ok).toBe(false);
  });
  it('only the current player may act', () => {
    expect(applyAction(s, 1, { type: 'place', rotation: 0, r: 9, c: 7 }).ok).toBe(false);
  });
  it('placing ends the turn', () => {
    expect(ok(applyAction(s, 0, { type: 'place', rotation: 0, r: 3, c: 4 })).current).toBe(1);
  });
  it('growing onto a tooth gives +1 bite', () => {
    const t = board(rows(['A*........'], '.........B'), { piece: 0 });
    const n = ok(applyAction(t, 0, { type: 'place', rotation: 0, r: 0, c: 1 }));
    expect(n.players[0]!.bites).toBe(1);
    expect(n.teeth[1]).toBe(0);
  });
  it('legalPlacements agrees with applyAction', () => {
    const moves = legalPlacements(s, 0);
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) expect(applyAction(s, 0, { type: 'place', ...m }).ok).toBe(true);
  });
});

describe('C5 capture', () => {
  it('flips a whole row like Othello (chain reaction)', () => {
    const s = board(rows(['aaaaa.....', 'Abbb......'], '.........B'), { piece: 0 });
    const n = ok(applyAction(s, 0, { type: 'place', rotation: 0, r: 1, c: 4 }));
    expect(render(n)[1]).toBe('Aaaaa.....');
  });

  it('a diagonal capture edge-connected to our head survives', () => {
    const s = board(rows(['Aaaa......', 'ab.a......', '...a......'], '.........B'), { piece: 0 });
    const n = ok(applyAction(s, 0, { type: 'place', rotation: 0, r: 2, c: 2 }));
    expect(render(n)[1]).toBe('aa.a......');
  });

  it('a diagonal capture NOT edge-connected to our head is destroyed', () => {
    const s = board(rows(['Aaaaaa....', '..a..a....', '..a..a....', '...b.a....', '.....a....'], 'B.........'), {
      piece: 0,
    });
    const res = applyAction(s, 0, { type: 'place', rotation: 0, r: 4, c: 4 });
    expect(render(ok(res))[3]).toBe('.....a....');
    expect(res.ok && res.events.some((e) => e.type === 'died')).toBe(true);
  });

  it('capturing a head eliminates the player and inherits its bites', () => {
    const s = board(rows(['aBbb......', 'a...a.....', 'Aaaaa.....']), { piece: 0, bites: [0, 2, 0] });
    const n = ok(applyAction(s, 0, { type: 'place', rotation: 0, r: 0, c: 4 }));
    expect(n.players[1]!.alive).toBe(false);
    expect(n.players[0]!.bites).toBe(2);
    expect(n.players[1]!.bites).toBe(0);
    expect(render(n)[0]).toBe('aaaaa.....');
    expect(n.winner).toBeNull(); // C still alive
    expect(n.current).toBe(2); // dead seat skipped
  });

  it('last player alive wins and the game stops', () => {
    const s = board(rows(['aBbb......', 'a...a.....', 'Aaaaa.....'], EMPTY), { piece: 0 });
    const n = ok(applyAction(s, 0, { type: 'place', rotation: 0, r: 0, c: 4 }));
    expect(n.winner).toBe(0);
    expect(applyAction(n, 0, { type: 'pass' }).ok).toBe(false);
  });

  it('diagonal capture can be disabled', () => {
    const s = board(rows(['Aaaa......', 'ab.a......', '...a......'], '.........B'), { piece: 0 });
    s.config.diagonalCapture = false;
    const n = ok(applyAction(s, 0, { type: 'place', rotation: 0, r: 2, c: 2 }));
    expect(render(n)[1]).toBe('ab.a......');
  });
});

describe('C6 disconnection', () => {
  it('a bite that leaves the rest attached removes only the bitten cell', () => {
    const s = board(rows(['A.........', 'a.........', 'abbbbB....']), { bites: [1, 0, 0] });
    const n = ok(applyAction(s, 0, { type: 'bite', cells: [{ r: 2, c: 1 }] }));
    expect(render(n)[2]).toBe('a.bbbB....');
  });
  it('a bite that severs the body kills everything past the cut', () => {
    const s = board(rows(['Aaa.......', '..a.......', 'Bbbbbb....']), { bites: [1, 0, 0] });
    const n = ok(applyAction(s, 0, { type: 'bite', cells: [{ r: 2, c: 2 }] }));
    expect(render(n)[2]).toBe('Bb........');
  });
});

describe('C7 tooth regrowth', () => {
  it('every living player gets +1 bite every 8–13 rounds', () => {
    let s = createGame(classicConfig(humans(2), { stalemateTurns: 0 }), 7);
    const gotAt: number[] = [];
    let before = 0;
    for (let i = 0; i < 400; i++) {
      s = ok(applyAction(s, s.current, { type: 'pass' }));
      if (s.players[0]!.bites > before) {
        gotAt.push(s.round);
        before = s.players[0]!.bites;
      }
    }
    expect(s.players[0]!.bites).toBe(s.players[1]!.bites);
    expect(gotAt.length).toBeGreaterThan(10);
    expect(gotAt[0]!).toBeGreaterThanOrEqual(9);
    expect(gotAt[0]!).toBeLessThanOrEqual(14);
    for (let i = 1; i < gotAt.length; i++) {
      expect(gotAt[i]! - gotAt[i - 1]!).toBeGreaterThanOrEqual(8);
      expect(gotAt[i]! - gotAt[i - 1]!).toBeLessThanOrEqual(13);
    }
  });
});

describe('C8 bites', () => {
  const base = rows(['A.........', 'a.........', 'abbbbB....']);
  it('requires a bite', () => {
    expect(applyAction(board(base), 0, { type: 'bite', cells: [{ r: 2, c: 1 }] }).ok).toBe(false);
  });
  it('does not end the turn and costs exactly 1', () => {
    const n = ok(applyAction(board(base, { bites: [2, 0, 0] }), 0, { type: 'bite', cells: [{ r: 2, c: 1 }] }));
    expect(n.current).toBe(0);
    expect(n.players[0]!.bites).toBe(1);
  });
  it('bite then place in the same turn', () => {
    const s = board(base, { bites: [1, 0, 0], piece: 0 });
    const a = ok(applyAction(s, 0, { type: 'bite', cells: [{ r: 2, c: 1 }] }));
    const b = ok(applyAction(a, 0, { type: 'place', rotation: 0, r: 2, c: 1 }));
    expect(b.current).toBe(1);
  });
  it('heads cannot be bitten', () => {
    const s = board(rows(['A.........', 'aB........']), { bites: [1, 0, 0] });
    expect(applyAction(s, 0, { type: 'bite', cells: [{ r: 1, c: 1 }] }).ok).toBe(false);
  });
  it('must start next to own fungus', () => {
    expect(applyAction(board(base, { bites: [1, 0, 0] }), 0, { type: 'bite', cells: [{ r: 2, c: 3 }] }).ok).toBe(false);
  });
  it('length is limited by bite level', () => {
    const two = [
      { r: 2, c: 1 },
      { r: 2, c: 2 },
    ];
    expect(applyAction(board(base, { bites: [1, 0, 0] }), 0, { type: 'bite', cells: two }).ok).toBe(false);
    const big = board(base, { bites: [1, 0, 0] });
    big.config.biteStep = 2; // A has 3 cells → level 2
    expect(ok(applyAction(big, 0, { type: 'bite', cells: two })).players[0]!.bites).toBe(0);
  });
  it('must be a straight orthogonal line', () => {
    const s = board(rows(['A.........', 'abb.......', 'ab..B.....']), { bites: [1, 0, 0] });
    s.config.biteStep = 1;
    const bent = [
      { r: 1, c: 1 },
      { r: 2, c: 1 },
      { r: 1, c: 2 },
    ];
    expect(applyAction(s, 0, { type: 'bite', cells: bent }).ok).toBe(false);
  });
  it('bite level = 1 + cells/80, capped at 3', () => {
    const s = createGame(classicConfig(humans(2)), 1);
    const fill = (n: number) => {
      const t = structuredClone(s);
      let placed = 1; // the head
      for (let k = 0; k < t.cells.length && placed < n; k++)
        if (t.cells[k] === 0) {
          t.cells[k] = 1;
          placed++;
        }
      return t;
    };
    expect(biteLevel(fill(79), 0)).toBe(1);
    expect(biteLevel(fill(80), 0)).toBe(2);
    expect(biteLevel(fill(159), 0)).toBe(2);
    expect(biteLevel(fill(160), 0)).toBe(3);
    expect(biteLevel(fill(390), 0)).toBe(3);
  });
});

describe('stalemate [ours]', () => {
  it('ends after N consecutive passes; largest fungus wins', () => {
    let s = board(rows(['Aa........'], '.........B'));
    s.config.stalemateTurns = 4;
    for (let i = 0; i < 4; i++) s = ok(applyAction(s, s.current, { type: 'pass' }));
    expect(s.winner).toBe(0);
  });
});

describe('purity & determinism', () => {
  it('same seed and actions → identical state', () => {
    const run = () => {
      let s = createGame(classicConfig(humans(2)), 1234);
      for (let i = 0; i < 30; i++) {
        const m = legalPlacements(s, s.current)[0];
        s = ok(applyAction(s, s.current, m ? { type: 'place', ...m } : { type: 'pass' }));
      }
      return s;
    };
    expect(run()).toEqual(run());
  });
  it('applyAction never mutates its input', () => {
    const s = createGame(classicConfig(humans(2)), 5);
    const copy = structuredClone(s);
    applyAction(s, 0, { type: 'place', ...legalPlacements(s, 0)[0]! });
    expect(s).toEqual(copy);
  });
  it('state survives a JSON round-trip (network/save)', () => {
    const s = createGame(classicConfig(humans(3)), 9);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
