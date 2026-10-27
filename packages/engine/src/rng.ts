/**
 * Deterministic, serializable PRNG (mulberry32).
 * The state is a single uint32 stored inside GameState, so a game can be
 * saved, sent over the network, and replayed exactly.
 */
export function rngNext(seed: number): [value: number, nextSeed: number] {
  let t = (seed + 0x6d2b79f5) >>> 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next];
}

/** Mutable cursor over a seed, used inside a single (already cloned) state update. */
export class Rng {
  constructor(public seed: number) {
    this.seed = seed >>> 0;
  }
  /** Float in [0, 1). */
  next(): number {
    const [v, s] = rngNext(this.seed);
    this.seed = s;
    return v;
  }
  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  /** Integer in [-(n-1), n-1], mimicking C `Random() % n` on a signed value. */
  signedMod(n: number): number {
    const v = this.int(2 * n - 1);
    return v - (n - 1);
  }
  /** True with probability pct/100. */
  chance(pct: number): boolean {
    return this.int(100) < pct;
  }
}
