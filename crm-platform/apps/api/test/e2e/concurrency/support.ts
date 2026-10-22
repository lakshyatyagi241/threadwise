/**
 * Shared bits of the concurrency suite (QA Sheet3 #15).
 *
 * Every spec prints the seed it ran with and takes small random delays from it, so a different interleaving is tried each round and
 * a failing run can be replayed with `CONC_SEED=<n>`. The assertions never depend on who wins, only on the end state.
 */
export const SEED = Number(process.env.CONC_SEED ?? Math.floor(Math.random() * 2 ** 31));
export const ROUNDS = Number(process.env.CONC_ROUNDS ?? 5);

/** mulberry32: a small seeded generator, enough to vary delays. */
export function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rng = rngFrom(SEED);
// eslint-disable-next-line no-console
console.log(`[concurrency] seed=${SEED} rounds=${ROUNDS} (replay with CONC_SEED=${SEED})`);

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Starts `n` copies of `fn` at once, each after its own random 0..maxMs delay. */
export function race<T>(n: number, fn: (i: number) => Promise<T>, maxMs = 15): Promise<T[]> {
  return Promise.all(
    Array.from({ length: n }, async (_, i) => {
      await sleep(Math.floor(rng() * maxMs));
      return fn(i);
    }),
  );
}

/** The statuses of a batch of responses, sorted, for a failure message. */
export const statuses = (rs: Array<{ status: number }>) => rs.map((r) => r.status).sort();
