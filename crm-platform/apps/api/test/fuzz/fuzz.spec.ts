import { describe, expect, it } from 'vitest';
import { execute, freshSeed } from './run';

/**
 * The fuzz run itself, started by `tools/quality/fuzz.mjs` (which sets the environment). It is not part of `pnpm test`: that runs the
 * small profile in test/unit/security/fuzz-ci.spec.ts.
 *   FUZZ_SEED, FUZZ_PROFILE (ci|full|smoke), FUZZ_TOTAL, FUZZ_SHARD (k/n), FUZZ_TARGET, FUZZ_ITER, FUZZ_REPORT, FUZZ_PROGRESS
 */
const env = process.env;
describe('fuzz', () => {
  it('runs the profile and finds nothing', async () => {
    const seed = env.FUZZ_SEED ? Number(env.FUZZ_SEED) >>> 0 : freshSeed();
    const [k, n] = (env.FUZZ_SHARD ?? '0/1').split('/').map(Number);
    console.log(`FUZZ seed=${seed}`);
    const report = await execute({
      seed,
      profile: env.FUZZ_PROFILE ?? 'smoke',
      total: env.FUZZ_TOTAL ? Number(env.FUZZ_TOTAL) : undefined,
      only: env.FUZZ_TARGET,
      iter: env.FUZZ_ITER ? Number(env.FUZZ_ITER) : undefined,
      shard: { index: k!, of: n! },
      progressFile: env.FUZZ_PROGRESS,
      reportFile: env.FUZZ_REPORT,
    });
    console.log(
      `FUZZ executed=${report.executed} ms=${report.durationMs} failures=${report.failures.length}`,
    );
    for (const f of report.failures)
      console.log(
        `FUZZ FAIL ${f.target} [${f.kind}] x${f.count} ${f.message}\n  input: ${f.input}\n  minimal: ${f.minimal ?? '-'}`,
      );
    expect(report.failures).toEqual([]);
  }, 3_600_000);
});
