import { describe, expect, it } from 'vitest';
import { execute } from '../../fuzz/run';

/**
 * Security fuzz, CI-sized profile (QA sheet 3, item 38): 20 000 generated malicious or invalid inputs against every Zod schema in
 * @crm/contracts, the URL and address guards, the webhook signature verifiers and the text parsers and sanitizers. The seed is fixed so
 * `pnpm test` gives the same answer every time; the scheduled run (`node tools/quality/fuzz.mjs`, 1.3 million inputs, a new seed) is
 * what explores. A failure prints its seed, target and iteration, and `node tools/quality/fuzz.mjs --seed S --target T --iter I`
 * replays that one input.
 */
const SEED = 20261019;

describe('security fuzz (ci profile)', () => {
  it('runs 20 000 hostile inputs and every invariant holds', async () => {
    const report = await execute({ seed: SEED, profile: 'ci', budgetScale: 8 });
    const lines = report.failures.map(
      (f) =>
        `${f.target} [${f.kind}] x${f.count}: ${f.message}\n  minimal: ${f.minimal ?? f.input}\n  replay: ${f.replay}`,
    );
    expect(lines.join('\n')).toBe('');
    expect(report.executed).toBeGreaterThanOrEqual(20_000);
    // Every group ran: a target list that silently shrank would otherwise pass.
    expect(Object.keys(report.perGroup).sort()).toEqual([
      'contract-helpers',
      'net',
      'schemas',
      'signatures',
      'text',
    ]);
    expect(report.perGroup.schemas!.targets).toBeGreaterThan(3000);
  }, 180_000);
});
