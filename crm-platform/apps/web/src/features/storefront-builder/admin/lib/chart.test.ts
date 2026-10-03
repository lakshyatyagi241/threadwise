import { describe, expect, it } from 'vitest';
import { buildSalesChart, labelIndexes, niceMax, niceScale, smoothPath, ticks } from './chart';

const BOX = { width: 600, height: 260, left: 40, right: 30, top: 10, bottom: 30 };

describe('niceMax and ticks', () => {
  it('rounds up to 1, 2, 2.5, 5, 10 times a power of ten', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(120)).toBe(200);
    expect(niceMax(2200)).toBe(2500);
    expect(niceMax(5000)).toBe(5000);
  });
  it('spaces ticks evenly from zero', () => {
    expect(ticks(100, 4)).toEqual([0, 25, 50, 75, 100]);
  });
});

describe('niceScale', () => {
  it('ends on a round multiple with at most six intervals', () => {
    expect(niceScale(5998)).toEqual({ top: 6000, step: 1000, count: 6 });
    expect(niceScale(1440)).toEqual({ top: 1500, step: 500, count: 3 });
    expect(niceScale(0)).toEqual({ top: 1, step: 1, count: 1 });
  });
  it('keeps an orders axis on whole numbers', () => {
    expect(niceScale(2, 1)).toEqual({ top: 2, step: 1, count: 2 });
    expect(niceScale(1, 1)).toEqual({ top: 1, step: 1, count: 1 });
  });
});

describe('labelIndexes', () => {
  it('prints every label when there are few', () => {
    expect(labelIndexes(5)).toEqual([0, 1, 2, 3, 4]);
  });
  it('caps at 10 labels and keeps the first and last of 30 days', () => {
    const idx = labelIndexes(30);
    expect(idx.length).toBeLessThanOrEqual(10);
    expect(idx[0]).toBe(0);
    expect(idx.at(-1)).toBe(29);
  });
  it('handles empty', () => {
    expect(labelIndexes(0)).toEqual([]);
  });
});

describe('buildSalesChart', () => {
  const revenue = Array.from({ length: 30 }, (_, i) => (i === 29 ? 1000 : 0));
  const orders = Array.from({ length: 30 }, (_, i) => (i === 29 ? 4 : 0));
  const model = buildSalesChart(revenue, orders, BOX);

  it('draws one column and one point per day', () => {
    expect(model.bars).toHaveLength(30);
    expect(model.points).toHaveLength(30);
  });
  it('gives empty days no height and the busiest day the full plot height', () => {
    expect(model.bars[0]!.height).toBe(0);
    expect(model.bars[29]!.height).toBeCloseTo(model.plot.height);
    expect(model.bars[29]!.y).toBeCloseTo(model.plot.y);
  });
  it('keeps every shape inside the plot', () => {
    for (const b of model.bars) {
      expect(b.x).toBeGreaterThanOrEqual(model.plot.x);
      expect(b.x + b.width).toBeLessThanOrEqual(model.plot.x + model.plot.width + 0.001);
    }
    for (const p of model.points) {
      expect(p.y).toBeLessThanOrEqual(model.plot.y + model.plot.height);
      expect(p.y).toBeGreaterThanOrEqual(model.plot.y);
    }
  });
  it('scales each axis on its own', () => {
    expect(model.revenueTop).toBe(1000);
    expect(model.ordersTop).toBe(4);
  });
  it('survives an all-zero series', () => {
    const flat = buildSalesChart([0, 0], [0, 0], BOX);
    expect(flat.revenueTop).toBe(1);
    expect(flat.bars.every((b) => b.height === 0)).toBe(true);
  });
});

describe('smoothPath', () => {
  it('is empty without points and starts with a move otherwise', () => {
    expect(smoothPath([])).toBe('');
    expect(smoothPath([{ x: 1, y: 2 }])).toBe('M1 2');
    expect(
      smoothPath([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]),
    ).toMatch(/^M0 0 C/);
  });
});
