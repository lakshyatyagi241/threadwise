import { describe, expect, it } from 'vitest';
import type { ChartBlock } from './blocks';
import { arcPath, axisModel, hasData, niceCeil, sliceModel } from './chart-geometry';

const chart = (over: Partial<ChartBlock> & Pick<ChartBlock, 'series'>): ChartBlock => ({
  type: 'bar',
  ...over,
});
const pts = (...v: Array<[string, number]>) => v.map(([label, value]) => ({ label, value }));

describe('niceCeil', () => {
  it('rounds up to a tidy axis maximum', () => {
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(7)).toBe(10);
    expect(niceCeil(23)).toBe(25);
    expect(niceCeil(480)).toBe(500);
  });
});

describe('axisModel', () => {
  it('lines series up on one list of labels and leaves a gap, not a zero, where a series has no point', () => {
    const m = axisModel(
      chart({
        series: [
          { name: 'A', points: pts(['Mon', 5], ['Tue', 7]) },
          { name: 'B', points: pts(['Tue', 3], ['Wed', 2]) },
        ],
      }),
    );
    expect(m.labels).toEqual(['Mon', 'Tue', 'Wed']);
    expect(m.series[0]?.values).toEqual([5, 7, null]);
    expect(m.series[1]?.values).toEqual([null, 3, 2]);
  });

  it('gives each series its own colour by position', () => {
    const m = axisModel(
      chart({ series: [1, 2, 3].map((n) => ({ name: `s${n}`, points: pts(['a', n]) })) }),
    );
    expect(m.series.map((s) => s.color)).toEqual(['var(--rc-1)', 'var(--rc-2)', 'var(--rc-3)']);
  });

  it('starts at zero and ends at a tidy maximum, with five ticks', () => {
    const m = axisModel(chart({ series: [{ name: 'A', points: pts(['a', 23]) }] }));
    expect([m.lo, m.hi]).toEqual([0, 25]);
    expect(m.ticks).toEqual([0, 6.25, 12.5, 18.75, 25]);
  });

  it('stacks bars on the sum of a column, and keeps negatives below the baseline', () => {
    const stacked = axisModel(
      chart({
        stacked: true,
        series: [
          { name: 'A', points: pts(['a', 4]) },
          { name: 'B', points: pts(['a', 3]) },
        ],
      }),
    );
    expect(stacked.hi).toBe(10);
    const neg = axisModel(chart({ series: [{ name: 'A', points: pts(['a', -30], ['b', 8]) }] }));
    expect(neg.lo).toBe(-50);
    expect(neg.hi).toBe(10);
  });

  it('still has a usable range when everything is zero', () => {
    const m = axisModel(chart({ series: [{ name: 'A', points: pts(['a', 0]) }] }));
    expect(m.hi).toBeGreaterThan(m.lo);
    expect(m.ticks.every(Number.isFinite)).toBe(true);
  });
});

describe('hasData', () => {
  it('is true with a real point', () => {
    expect(hasData(chart({ series: [{ name: 'A', points: pts(['a', 0]) }] }))).toBe(true);
  });
  it('is false with nothing to draw', () => {
    expect(hasData(chart({ series: [] }))).toBe(false);
    expect(hasData(chart({ series: [{ name: 'A', points: [] }] }))).toBe(false);
  });
});

describe('sliceModel', () => {
  it('works out each share and the angles of the slices, going round once', () => {
    const { slices, total } = sliceModel(
      chart({ type: 'pie', series: [{ name: 'S', points: pts(['A', 1], ['B', 3]) }] }),
      'Other',
    );
    expect(total).toBe(4);
    expect(slices.map((s) => s.share)).toEqual([0.25, 0.75]);
    expect(slices[0]!.start).toBeCloseTo(-Math.PI / 2);
    expect(slices[1]!.end - slices[0]!.start).toBeCloseTo(Math.PI * 2);
    expect(slices.map((s) => s.color)).toEqual(['var(--rc-1)', 'var(--rc-2)']);
  });
  it('leaves out slices that cannot be drawn and uses the first series only', () => {
    const { slices } = sliceModel(
      chart({
        type: 'donut',
        series: [
          { name: 'S', points: pts(['A', 2], ['B', 0], ['C', -4]) },
          { name: 'ignored', points: pts(['Z', 9]) },
        ],
      }),
      'Other',
    );
    expect(slices.map((s) => s.label)).toEqual(['A']);
  });
  it('is empty when nothing is positive', () => {
    expect(
      sliceModel(chart({ type: 'pie', series: [{ name: 'S', points: pts(['A', 0]) }] }), 'Other')
        .slices,
    ).toEqual([]);
  });
  it('folds past eight slices into Other', () => {
    const many = Array.from({ length: 11 }, (_, i): [string, number] => [`s${i}`, i + 1]);
    const { slices } = sliceModel(
      chart({ type: 'pie', series: [{ name: 'S', points: pts(...many) }] }),
      'Other',
    );
    expect(slices).toHaveLength(8);
    expect(slices.at(-1)?.label).toBe('Other');
    expect(slices.at(-1)?.color).toBe('var(--rc-8)');
  });
});

describe('arcPath', () => {
  it('draws a ring segment as a closed path with only finite numbers', () => {
    const d = arcPath(110, 110, 100, 58, 0, Math.PI / 2);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).not.toContain('NaN');
  });
  it('draws a whole circle too (one slice at 100%)', () => {
    const d = arcPath(110, 110, 100, 0, -Math.PI / 2, (3 * Math.PI) / 2);
    expect(d).not.toContain('NaN');
    expect(d).toContain('A 100 100');
  });
});
