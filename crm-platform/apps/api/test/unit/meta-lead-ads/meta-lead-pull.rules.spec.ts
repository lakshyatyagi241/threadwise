import { describe, expect, it } from 'vitest';
import {
  PULL_MIN_WINDOW_MS,
  PULL_REACH_MS,
  PULL_WINDOW_MS,
  backoffMs,
  canSplit,
  clampRange,
  halves,
  inWindow,
  isRateLimited,
  sinceOf,
  untilOf,
  windowsOf,
} from '../../../src/modules/meta-lead-ads/meta-lead-pull.rules';

const DAY = 86_400_000;
const T0 = Date.parse('2026-10-01T00:00:00Z');

describe('windowsOf', () => {
  it('cuts a range into weeks, oldest first, with no gap and no overlap', () => {
    const w = windowsOf(T0, T0 + 20 * DAY);
    expect(w).toHaveLength(3);
    expect(w[0]).toEqual({ from: T0, to: T0 + PULL_WINDOW_MS });
    expect(w[1]!.from).toBe(w[0]!.to);
    expect(w[2]).toEqual({ from: T0 + 2 * PULL_WINDOW_MS, to: T0 + 20 * DAY });
  });

  it('a short range is one window, an empty or reversed range has none', () => {
    expect(windowsOf(T0, T0 + 3600_000)).toHaveLength(1);
    expect(windowsOf(T0, T0)).toEqual([]);
    expect(windowsOf(T0 + 5, T0)).toEqual([]);
  });

  it('ninety days is thirteen windows', () => {
    expect(windowsOf(T0, T0 + 90 * DAY)).toHaveLength(13);
  });
});

describe('cutting a window again', () => {
  it('halves meet at a whole second and cover the window', () => {
    const w = { from: T0 + 250, to: T0 + 7 * DAY + 999 };
    const [a, b] = halves(w);
    expect(a.from).toBe(w.from);
    expect(b.to).toBe(w.to);
    expect(a.to).toBe(b.from);
    expect(a.to % 1000).toBe(0);
  });

  it('a window of an hour or less is not cut again', () => {
    expect(canSplit({ from: T0, to: T0 + PULL_MIN_WINDOW_MS })).toBe(false);
    expect(canSplit({ from: T0, to: T0 + PULL_MIN_WINDOW_MS + 1 })).toBe(true);
  });
});

describe('the bounds Meta is asked for', () => {
  const at = (iso: string) => Date.parse(iso);

  it('select exactly the leads created in [from, to) at whole seconds', () => {
    const w = { from: at('2026-10-01T10:00:00.000Z'), to: at('2026-10-02T10:00:00.000Z') };
    const since = sinceOf(w);
    const until = untilOf(w);
    const took = (iso: string) => {
      const t = Math.floor(Date.parse(iso) / 1000);
      return t > since && t < until;
    };
    expect(took('2026-10-01T09:59:59Z')).toBe(false);
    expect(took('2026-10-01T10:00:00Z')).toBe(true);
    expect(took('2026-10-02T09:59:59Z')).toBe(true);
    expect(took('2026-10-02T10:00:00Z')).toBe(false);
  });

  it('a window that starts or ends between seconds still takes the whole seconds inside it', () => {
    const w = { from: at('2026-10-01T10:00:00.400Z'), to: at('2026-10-01T10:00:03.200Z') };
    const took = (s: number) => s > sinceOf(w) && s < untilOf(w);
    const base = Math.floor(at('2026-10-01T10:00:00Z') / 1000);
    expect([0, 1, 2, 3, 4].map((n) => took(base + n))).toEqual([false, true, true, true, false]);
  });

  it('inWindow keeps a lead with no usable time (Meta already chose it) and drops one outside', () => {
    const w = { from: T0, to: T0 + DAY };
    expect(inWindow(null, w)).toBe(true);
    expect(inWindow('not a date', w)).toBe(true);
    expect(inWindow(new Date(T0).toISOString(), w)).toBe(true);
    expect(inWindow(new Date(T0 + DAY).toISOString(), w)).toBe(false);
    expect(inWindow(new Date(T0 - 1).toISOString(), w)).toBe(false);
  });
});

describe('Meta slowing us down', () => {
  it('knows the rate limit codes', () => {
    for (const c of [4, 17, 32, 341, 613, 80000, 80004, 80014])
      expect(isRateLimited(c), String(c)).toBe(true);
    for (const c of [undefined, 1, 2, 10, 100, 190, 200, 80015])
      expect(isRateLimited(c), String(c)).toBe(false);
  });

  it('waits longer for a rate limit than for a request that merely failed, and grows with each try', () => {
    expect([0, 1, 2, 3].map((n) => backoffMs(613, n))).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect([0, 1, 2, 3].map((n) => backoffMs(2, n))).toEqual([2_000, 5_000, 15_000, 30_000]);
    expect(backoffMs(undefined, 0)).toBe(2_000);
    // past the last step it stays there
    expect(backoffMs(4, 9)).toBe(240_000);
    expect(backoffMs(4, -1)).toBe(30_000);
  });
});

describe('clampRange', () => {
  const now = new Date('2026-10-16T12:00:00Z');

  it('keeps a range inside what Meta keeps', () => {
    const r = clampRange(new Date('2026-10-01T00:00:00Z'), new Date('2026-10-10T00:00:00Z'), now);
    expect(r).toEqual({
      from: Date.parse('2026-10-01T00:00:00Z'),
      to: Date.parse('2026-10-10T00:00:00Z'),
    });
  });

  it('cuts the start to ninety days back and the end to now', () => {
    const r = clampRange(new Date('2026-01-01T00:00:00Z'), new Date('2027-01-01T00:00:00Z'), now)!;
    expect(r.from).toBe(now.getTime() - PULL_REACH_MS);
    expect(r.to).toBe(now.getTime());
  });

  it('is null when nothing is left of it', () => {
    expect(
      clampRange(new Date('2026-01-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'), now),
    ).toBeNull();
    expect(
      clampRange(new Date('2026-10-16T12:00:00Z'), new Date('2026-10-16T12:00:00.500Z'), now),
    ).toBeNull();
  });
});
