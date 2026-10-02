/** Test helpers (not exported from the package index). A tiny seeded PRNG so property-style tests are reproducible. */
export function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randInt = (r: () => number, lo: number, hi: number): number =>
  lo + Math.floor(r() * (hi - lo + 1));
export const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
