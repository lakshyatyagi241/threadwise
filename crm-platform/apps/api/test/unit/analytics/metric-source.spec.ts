import { describe, expect, it, vi } from 'vitest';
import { deepEqual, serve, sourceOf } from '../../../src/modules/analytics/shadow/metric-source';

describe('sourceOf', () => {
  it('reads the source of a metric from the JSON map', () => {
    const raw = '{"msg_count":"shadow","dash":"rollup"}';
    expect(sourceOf('msg_count', raw)).toBe('shadow');
    expect(sourceOf('dash', raw)).toBe('rollup');
  });

  it('falls back to legacy for a missing key, a bad value or broken JSON', () => {
    expect(sourceOf('other', '{"msg_count":"shadow"}')).toBe('legacy');
    expect(sourceOf('msg_count', '{"msg_count":"on"}')).toBe('legacy');
    expect(sourceOf('msg_count', '{nope')).toBe('legacy');
    expect(sourceOf('msg_count', undefined)).toBe('legacy');
    expect(sourceOf('msg_count', '[]')).toBe('legacy');
  });
});

describe('deepEqual', () => {
  it('compares numbers, arrays and objects structurally', () => {
    expect(deepEqual({ a: [1, 2, { b: 3 }] }, { a: [1, 2, { b: 3 }] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(null, {})).toBe(false);
  });
});

describe('serve', () => {
  const legacy = () => vi.fn().mockResolvedValue({ total: 10 });

  it('runs only the legacy query in legacy mode', async () => {
    const l = legacy();
    const r = vi.fn().mockResolvedValue({ total: 10 });
    expect(await serve('m', l, r, { source: 'legacy' })).toEqual({ total: 10 });
    expect(r).not.toHaveBeenCalled();
  });

  it('runs only the rollup query in rollup mode', async () => {
    const l = legacy();
    const r = vi.fn().mockResolvedValue({ total: 11 });
    expect(await serve('m', l, r, { source: 'rollup' })).toEqual({ total: 11 });
    expect(l).not.toHaveBeenCalled();
  });

  it('in shadow mode answers with the legacy value and says nothing when the two agree', async () => {
    const onDiff = vi.fn();
    const out = await serve('m', legacy(), async () => ({ total: 10 }), {
      source: 'shadow',
      onDiff,
    });
    expect(out).toEqual({ total: 10 });
    expect(onDiff).not.toHaveBeenCalled();
  });

  it('in shadow mode reports a difference once, with both values, and still answers with legacy', async () => {
    const onDiff = vi.fn();
    const out = await serve('m', legacy(), async () => ({ total: 12 }), {
      source: 'shadow',
      onDiff,
    });
    expect(out).toEqual({ total: 10 });
    expect(onDiff).toHaveBeenCalledTimes(1);
    expect(onDiff).toHaveBeenCalledWith({ key: 'm', legacy: { total: 10 }, rollup: { total: 12 } });
  });

  it('uses the supplied comparison, for example a tolerance on money', async () => {
    const onDiff = vi.fn();
    const equal = (a: { total: number }, b: { total: number }) => Math.abs(a.total - b.total) <= 1;
    await serve('m', legacy(), async () => ({ total: 11 }), { source: 'shadow', onDiff, equal });
    expect(onDiff).not.toHaveBeenCalled();
  });

  it('in shadow mode never lets a failing rollup query fail the request', async () => {
    const onError = vi.fn();
    const out = await serve(
      'm',
      legacy(),
      async () => {
        throw new Error('rollup broke');
      },
      { source: 'shadow', onError },
    );
    expect(out).toEqual({ total: 10 });
    expect(onError).toHaveBeenCalledWith('m', expect.any(Error));
  });

  it('still fails the request when the legacy query fails, in any mode', async () => {
    const boom = async () => {
      throw new Error('legacy broke');
    };
    await expect(
      serve('m', boom, async () => ({ total: 1 }), { source: 'shadow' }),
    ).rejects.toThrow('legacy broke');
    await expect(
      serve('m', boom, async () => ({ total: 1 }), { source: 'legacy' }),
    ).rejects.toThrow('legacy broke');
  });

  it('reads the mode from the environment map when none is passed', async () => {
    const l = legacy();
    const r = vi.fn().mockResolvedValue({ total: 10 });
    const before = process.env.ANALYTICS_SOURCES;
    process.env.ANALYTICS_SOURCES = '{"m":"rollup"}';
    try {
      await serve('m', l, r);
    } finally {
      if (before === undefined) delete process.env.ANALYTICS_SOURCES;
      else process.env.ANALYTICS_SOURCES = before;
    }
    expect(r).toHaveBeenCalledTimes(1);
    expect(l).not.toHaveBeenCalled();
  });
});
