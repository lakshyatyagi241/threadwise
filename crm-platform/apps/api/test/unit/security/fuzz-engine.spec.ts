import { describe, expect, it } from 'vitest';
import * as contracts from '@crm/contracts';
import { Rng, perturb, text } from '../../fuzz/gen';
import { Violation, runFuzz, shrink, type Target } from '../../fuzz/engine';
import { TEXT_HELPERS } from '../../fuzz/targets/contract-helpers';
import { exportedSchemas } from '../../fuzz/targets/schemas';

/** The fuzz tooling itself: it must be reproducible, and it must be able to find, shrink and replay a bug. */
describe('fuzz generator', () => {
  it('is a pure function of (seed, target, iteration)', () => {
    const a = Array.from({ length: 200 }, (_, i) => text(Rng.for(42, 't', i)));
    const b = Array.from({ length: 200 }, (_, i) => text(Rng.for(42, 't', i)));
    expect(a).toEqual(b);
    expect(new Set(a).size).toBeGreaterThan(100);
    expect(a).not.toEqual(Array.from({ length: 200 }, (_, i) => text(Rng.for(43, 't', i))));
  });

  it('produces the hostile classes it promises', () => {
    const all = Array.from({ length: 20_000 }, (_, i) => text(Rng.for(7, 'classes', i)));
    const has = (re: RegExp) => all.some((s) => re.test(s));
    // eslint-disable-next-line no-control-regex
    expect(has(/\u0000/)).toBe(true);
    expect(has(new RegExp('\\u202e'))).toBe(true);
    expect(has(/[\ud800-\udbff](?![\udc00-\udfff])/)).toBe(true); // a lone surrogate
    expect(has(/😀/)).toBe(true);
    expect(has(/union select/i)).toBe(true);
    expect(has(/\$ne/)).toBe(true);
    expect(has(/\{\{7\*7\}\}/)).toBe(true);
    expect(has(/\.\.\/\.\./)).toBe(true);
    expect(has(/169\.254\.169\.254/)).toBe(true);
    expect(has(/__proto__/)).toBe(true);
    expect(all.some((s) => s.length > 100_000)).toBe(true);
    expect(all.some((s) => s === '')).toBe(true);
  });

  it('carries __proto__ as an own key, the way JSON.parse does', () => {
    const sample = { a: 1, b: { c: 'x' } };
    const seen = Array.from(
      { length: 3000 },
      (_, i) => perturb(Rng.for(1, 'p', i), sample) as object,
    );
    expect(
      seen.some(
        (o) =>
          o !== null &&
          typeof o === 'object' &&
          Object.prototype.hasOwnProperty.call(o, '__proto__'),
      ),
    ).toBe(true);
    expect(sample).toEqual({ a: 1, b: { c: 'x' } }); // the sample is never changed
  });
});

describe('fuzz engine', () => {
  const planted = (): Target => ({
    name: 'planted:nul-bug',
    group: 'self',
    weight: 1,
    gen: (r) => ({ pad: text(r).slice(0, 50), list: [1, 2, text(r).slice(0, 20)], n: r.int(10) }),
    run: (v) => {
      if (JSON.stringify(v).includes('\\u0000')) throw new Violation('a NUL got through');
    },
  });

  it('finds a planted bug, shrinks it to the NUL, and the replay command reproduces it', async () => {
    const first = await runFuzz({ seed: 5, profile: 'self', targets: [planted()], total: 20_000 });
    expect(first.executed).toBe(20_000);
    expect(first.failures).toHaveLength(1);
    const f = first.failures[0]!;
    expect(f.minimal).toContain('\\u0000');
    expect(f.minimal!.length).toBeLessThan(40);
    expect(f.replay).toContain(`--seed 5 --target 'planted:nul-bug' --iter ${f.iter}`);
    const again = await runFuzz({
      seed: 5,
      profile: 'self',
      targets: [planted()],
      total: 1,
      only: f.target,
      iter: f.iter,
    });
    expect(again.executed).toBe(1);
    expect(again.failures).toHaveLength(1);
    // The same seed gives the same run.
    const twin = await runFuzz({ seed: 5, profile: 'self', targets: [planted()], total: 20_000 });
    expect(twin.failures[0]!.iter).toBe(f.iter);
  });

  it('reports an unexpected throw, accepts the allowed error, and flags a prototype change', async () => {
    class Expected extends Error {}
    const targets: Target[] = [
      {
        name: 'self:allowed',
        group: 'self',
        weight: 1,
        gen: () => 1,
        allow: (e) => e instanceof Expected,
        run: () => {
          throw new Expected('fine');
        },
      },
      {
        name: 'self:type-error',
        group: 'self',
        weight: 1,
        gen: () => 1,
        allow: (e) => e instanceof Expected,
        run: () => {
          throw new TypeError('boom');
        },
      },
      {
        name: 'self:pollutes',
        group: 'self',
        weight: 1,
        gen: () => 1,
        run: () => {
          (Object.prototype as Record<string, unknown>).fuzzPolluted = 1;
        },
      },
    ];
    const rep = await runFuzz({ seed: 1, profile: 'self', targets, total: 30 });
    expect(rep.failures.map((f) => `${f.target}:${f.kind}`).sort()).toEqual([
      'self:pollutes:prototype',
      'self:type-error:throw',
    ]);
    expect(({} as Record<string, unknown>).fuzzPolluted).toBeUndefined(); // the engine put the prototype back
  });

  it('flags an input that takes too long', async () => {
    const slow: Target = {
      name: 'self:slow',
      group: 'self',
      weight: 1,
      budgetMs: 20,
      gen: () => 1,
      run: () => {
        const t = Date.now();
        while (Date.now() - t < 60);
      },
    };
    const rep = await runFuzz({ seed: 1, profile: 'self', targets: [slow], total: 2 });
    expect(rep.failures[0]?.kind).toBe('slow');
  });

  it('shrinks strings, arrays and objects', async () => {
    const out = await shrink({ a: 'xxxxZxxxx', b: [1, 2, 3], c: { d: 'e' } }, async (v) =>
      JSON.stringify(v).includes('Z'),
    );
    expect(JSON.stringify(out)).toBe('{"a":"Z"}');
  });
});

describe('fuzz targets are discovered, not listed by hand', () => {
  it('finds every schema @crm/contracts exports', () => {
    const exported = Object.values(contracts).filter(
      (v) => typeof (v as { safeParse?: unknown })?.safeParse === 'function',
    );
    expect(exportedSchemas().length).toBeGreaterThan(3000);
    expect(exportedSchemas().length).toBeLessThanOrEqual(exported.length);
    // Only a second export of the same object is dropped.
    expect(new Set(exported).size).toBe(exportedSchemas().length);
  });

  it('names only contract helpers that still exist', () => {
    const missing = TEXT_HELPERS.filter(
      (n) => typeof (contracts as Record<string, unknown>)[n] !== 'function',
    );
    expect(missing).toEqual([]);
  });
});
