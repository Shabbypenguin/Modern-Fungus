import { classicConfig, createGame } from '../src/index.js';
import type { GameState, PlayerKind } from '../src/index.js';

/**
 * Build a state from an ASCII board.
 *   .  empty      a–p  body of player 0–15      A–P  head of player 0–15      *  tooth
 * Every player needs exactly one head.
 */
export function board(rows: string[], opts: { kinds?: PlayerKind[]; bites?: number[]; piece?: number } = {}): GameState {
  const size = rows.length;
  rows.forEach((row) => {
    if (row.length !== size) throw new Error('board must be square');
  });
  const heads: { r: number; c: number }[] = [];
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      if (ch >= 'A' && ch <= 'P') heads[ch.charCodeAt(0) - 65] = { r, c };
    }),
  );
  const n = heads.length;
  const kinds = opts.kinds ?? Array.from({ length: n }, () => 'human' as PlayerKind);
  const cfg = classicConfig(
    kinds.map((kind, i) => ({ name: `P${i}`, kind })),
    { size: Math.max(size, 10), heads, teeth: [] },
  );
  if (size < 10) throw new Error('test boards must be ≥10 wide');
  const s = createGame(cfg, 1);
  s.cells.fill(0);
  s.teeth.fill(0);
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      const k = r * size + c;
      if (ch >= 'a' && ch <= 'p') s.cells[k] = ch.charCodeAt(0) - 96;
      else if (ch >= 'A' && ch <= 'P') s.cells[k] = ch.charCodeAt(0) - 64;
      else if (ch === '*') s.teeth[k] = 1;
    }),
  );
  opts.bites?.forEach((b, i) => (s.players[i]!.bites = b));
  if (opts.piece !== undefined) s.piece = opts.piece;
  return s;
}

/** Render a state back to ASCII (heads uppercase). */
export function render(s: GameState): string[] {
  const rows: string[] = [];
  for (let r = 0; r < s.size; r++) {
    let row = '';
    for (let c = 0; c < s.size; c++) {
      const v = s.cells[r * s.size + c]!;
      if (v === 0) row += s.teeth[r * s.size + c] ? '*' : '.';
      else {
        const pl = s.players[v - 1]!;
        const head = pl.head.r === r && pl.head.c === c && pl.alive;
        row += String.fromCharCode((head ? 64 : 96) + v);
      }
    }
    rows.push(row);
  }
  return rows;
}
