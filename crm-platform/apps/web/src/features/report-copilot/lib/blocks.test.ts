import { describe, expect, it } from 'vitest';
import {
  SHOW_CHART,
  SHOW_KPIS,
  SHOW_SUMMARY,
  SHOW_TABLE,
  blockResult,
  parseBlock,
  sameBlock,
  sourcesOf,
} from './blocks';

const chart = {
  type: 'bar',
  title: 'Sends by week',
  series: [{ name: 'Sent', points: [{ label: 'W1', value: 3 }] }],
  source: 'Dashboard, last 30 days',
};

describe('parseBlock', () => {
  it('accepts a block of each kind and keeps the id and the tool', () => {
    const ok = [
      parseBlock(SHOW_SUMMARY, 'a', { title: 'T', markdown: 'Hello **x**' }),
      parseBlock(SHOW_KPIS, 'b', {
        items: [
          { label: 'Sent', value: 1200, unit: 'msgs', tone: 'good', delta: 12, source: 'a.pdf' },
        ],
      }),
      parseBlock(SHOW_CHART, 'c', chart),
      parseBlock(SHOW_TABLE, 'd', { columns: ['A'], rows: [['x'], [2], [null]] }),
    ];
    expect(ok.map((o) => o.ok)).toEqual([true, true, true, true]);
    expect(ok.map((o) => (o.ok ? `${o.block.id}:${o.block.tool}` : ''))).toEqual([
      'a:show_summary',
      'b:show_kpis',
      'c:show_chart',
      'd:show_table',
    ]);
  });

  it('takes every chart type, including area and donut', () => {
    for (const type of ['bar', 'line', 'area', 'pie', 'donut'])
      expect(parseBlock(SHOW_CHART, 'c', { ...chart, type }).ok).toBe(true);
    expect(parseBlock(SHOW_CHART, 'c', { ...chart, type: 'radar' }).ok).toBe(false);
  });

  it('never lets a value that is not a finite number into a chart, a table or a key figure', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        parseBlock(SHOW_CHART, 'c', {
          ...chart,
          series: [{ name: 'S', points: [{ label: 'a', value: bad }] }],
        }).ok,
      ).toBe(false);
      expect(parseBlock(SHOW_TABLE, 'd', { columns: ['A'], rows: [[bad]] }).ok).toBe(false);
      expect(parseBlock(SHOW_KPIS, 'b', { items: [{ label: 'x', value: bad }] }).ok).toBe(false);
    }
  });

  it('reports what is wrong as short issues, never throws', () => {
    for (const junk of [null, undefined, 'x', 3, []]) {
      const o = parseBlock(SHOW_CHART, 'c', junk);
      expect(o.ok).toBe(false);
    }
    const o = parseBlock(SHOW_KPIS, 'b', { items: [] });
    expect(!o.ok && o.issues.join(' ')).toContain('items');
    const many = parseBlock(SHOW_CHART, 'c', {
      type: 1,
      series: 2,
      title: 3,
      xLabel: 4,
      yLabel: 5,
      unit: 6,
    });
    expect(!many.ok && many.issues.length).toBeLessThanOrEqual(5);
  });

  it('limits series, points and rows so a block stays drawable', () => {
    const series = Array.from({ length: 7 }, (_, i) => ({
      name: `s${i}`,
      points: [{ label: 'a', value: 1 }],
    }));
    expect(parseBlock(SHOW_CHART, 'c', { ...chart, series }).ok).toBe(false);
    const points = Array.from({ length: 61 }, (_, i) => ({ label: `${i}`, value: i }));
    expect(parseBlock(SHOW_CHART, 'c', { ...chart, series: [{ name: 's', points }] }).ok).toBe(
      false,
    );
    expect(
      parseBlock(SHOW_KPIS, 'b', {
        items: Array.from({ length: 9 }, () => ({ label: 'l', value: 1 })),
      }).ok,
    ).toBe(false);
  });

  it('takes a live key as plain text: an unknown key does not fail the block, the screen just ignores it', () => {
    expect(
      parseBlock(SHOW_KPIS, 'b', { items: [{ label: 'Sent', value: 1, live: 'messages.sent' }] })
        .ok,
    ).toBe(true);
    expect(
      parseBlock(SHOW_KPIS, 'b', { items: [{ label: 'x', value: 1, live: 'secrets.everything' }] })
        .ok,
    ).toBe(true);
  });

  it('takes the source as one name or a list, and lists them once', () => {
    const one = parseBlock(SHOW_KPIS, 'b', {
      source: 'a.pdf',
      items: [
        { label: 'x', value: 1, source: 'a.pdf' },
        { label: 'y', value: 2, source: 'Dashboard' },
      ],
    });
    const many = parseBlock(SHOW_TABLE, 'd', {
      columns: ['A'],
      rows: [['x']],
      source: ['a.pdf', 'b.pdf'],
    });
    expect(one.ok && sourcesOf(one.block)).toEqual(['a.pdf', 'Dashboard']);
    expect(many.ok && sourcesOf(many.block)).toEqual(['a.pdf', 'b.pdf']);
    const none = parseBlock(SHOW_TABLE, 'd', { columns: ['A'], rows: [['x']] });
    expect(none.ok && sourcesOf(none.block)).toEqual([]);
  });

  it('knows when two blocks say the same thing', () => {
    const a = parseBlock(SHOW_TABLE, '1', { columns: ['A'], rows: [['x']] });
    const b = parseBlock(SHOW_TABLE, '2', { columns: ['A'], rows: [['x']] });
    const c = parseBlock(SHOW_TABLE, '3', { columns: ['A'], rows: [['y']] });
    if (!a.ok || !b.ok || !c.ok) throw new Error('setup');
    expect(sameBlock(a.block, b.block)).toBe(true);
    expect(sameBlock(a.block, c.block)).toBe(false);
  });
});

describe('blockResult', () => {
  it('hands the model ok, or the issues and a hint to send the block again', () => {
    expect(JSON.parse(blockResult(parseBlock(SHOW_SUMMARY, 'a', { markdown: 'x' })))).toEqual({
      ok: true,
    });
    const bad = JSON.parse(blockResult(parseBlock(SHOW_SUMMARY, 'a', {})));
    expect(bad.ok).toBe(false);
    expect(bad.issues.length).toBeGreaterThan(0);
    expect(bad.hint).toContain('call the tool again');
  });
});
