import type { GameState } from './types.js';

/**
 * Fast fingerprint of everything that affects play (FNV-1a, 32-bit). The server
 * sends it with every move; a client whose replayed state disagrees asks for a
 * full resync instead of silently drifting.
 */
export function stateHash(s: GameState): number {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  for (const v of s.cells) mix(v);
  for (const v of s.teeth) mix(v);
  for (const p of s.players) {
    mix(p.alive ? 1 : 0);
    mix(p.bites);
    mix(p.head.r);
    mix(p.head.c);
  }
  mix(s.current);
  mix(s.piece);
  mix(s.round);
  mix(s.nextToothRound);
  mix(s.turn);
  mix(s.winner ?? 0xffff);
  mix(s.rngSeed & 0xffff);
  mix(s.rngSeed >>> 16);
  return h >>> 0;
}
