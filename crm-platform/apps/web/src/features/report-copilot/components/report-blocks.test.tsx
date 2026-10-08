import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import {
  SHOW_CHART,
  SHOW_KPIS,
  SHOW_SUMMARY,
  SHOW_TABLE,
  parseBlock,
  type Block,
} from '../lib/blocks';
import { BlockView, BlocksCanvas, LiveContext } from './report-blocks';
import { html } from './test-utils';

const block = (tool: Parameters<typeof parseBlock>[0], args: unknown): Block => {
  const o = parseBlock(tool, `id-${tool}`, args);
  if (!o.ok) throw new Error(o.issues.join(', '));
  return o.block;
};
const wrap = (el: ReactElement) => (
  <QueryClientProvider client={new QueryClient()}>{el}</QueryClientProvider>
);
const show = (b: Block) => html(wrap(<BlockView block={b} />));

const bar = (over: Record<string, unknown> = {}) =>
  block(SHOW_CHART, {
    type: 'bar',
    title: 'Sends by week',
    source: 'Dashboard, last 30 days',
    series: [
      {
        name: 'Sent',
        points: [
          { label: 'W1', value: 1200 },
          { label: 'W2', value: 1800 },
        ],
      },
      {
        name: 'Read',
        points: [
          { label: 'W1', value: 700 },
          { label: 'W2', value: 1100 },
        ],
      },
    ],
    ...over,
  });

describe('chart blocks', () => {
  it('draws a multi-series bar chart with a colour per series, a legend and an accessible table', () => {
    const out = show(bar());
    expect(out).toContain('Sends by week');
    expect(out).toContain('fill="var(--rc-1)"');
    expect(out).toContain('fill="var(--rc-2)"');
    expect(out).toContain('data-testid="chart-legend"');
    expect(out).toContain('Sent');
    expect(out).toContain('Read');
    expect(out).toContain('<caption>Sends by week</caption>');
    expect(out).toContain('1,200');
  });

  it('colours each bar of a single series by its own label, with the labels as the legend', () => {
    const out = show(
      bar({
        series: [
          {
            name: 'Sent',
            points: [
              { label: 'A', value: 1 },
              { label: 'B', value: 2 },
              { label: 'C', value: 3 },
            ],
          },
        ],
      }),
    );
    for (const n of [1, 2, 3]) expect(out).toContain(`fill="var(--rc-${n})"`);
  });

  it('draws line and area charts with markers in series colours, area with a soft fill', () => {
    const line = show(bar({ type: 'line' }));
    expect(line).toContain('stroke="var(--rc-1)"');
    expect(line).toContain('<circle');
    const area = show(bar({ type: 'area' }));
    expect(area).toContain('opacity="0.18"');
  });

  it('draws a donut with the total in the middle and a legend of value and share', () => {
    const out = show(
      block(SHOW_CHART, {
        type: 'donut',
        unit: 'msgs',
        series: [
          {
            name: 'Mix',
            points: [
              { label: 'Text', value: 750 },
              { label: 'Media', value: 250 },
            ],
          },
        ],
      }),
    );
    expect(out).toContain('Total');
    expect(out).toContain('1,000 msgs');
    expect(out).toContain('75%');
    expect(out).toContain('25%');
    expect(out).toContain('var(--rc-1)');
    expect(out).toContain('var(--rc-2)');
  });

  it('draws a pie without a centre figure', () => {
    const out = show(
      block(SHOW_CHART, {
        type: 'pie',
        series: [
          {
            name: 'S',
            points: [
              { label: 'A', value: 1 },
              { label: 'B', value: 1 },
            ],
          },
        ],
      }),
    );
    expect(out).not.toContain('Total');
    expect(out).toContain('50%');
  });

  it('formats by the unit, prefix and suffix', () => {
    const out = show(
      bar({ prefix: '$', series: [{ name: 'Revenue', points: [{ label: 'Q1', value: 1500 }] }] }),
    );
    expect(out).toContain('$1,500');
  });

  it('says there is no data instead of drawing a blank plot', () => {
    for (const type of ['bar', 'pie', 'donut']) {
      const out = show(
        block(SHOW_CHART, { type, series: [{ name: 'S', points: [{ label: 'A', value: 0 }] }] }),
      );
      // zero is a real point for an axis chart, but a pie of zeros has nothing to show
      if (type !== 'bar') expect(out).toContain('There is no data to draw for this chart.');
    }
  });

  it('never prints NaN', () => {
    const out = show(
      bar({
        series: [
          {
            name: 'S',
            points: [
              { label: 'A', value: 0 },
              { label: 'B', value: 0 },
            ],
          },
        ],
      }),
    );
    expect(out).not.toContain('NaN');
    expect(out).not.toContain('Infinity');
  });
});

describe('kpi blocks', () => {
  const kpis = block(SHOW_KPIS, {
    title: 'Key figures',
    source: 'report.pdf',
    items: [
      { label: 'Sent', value: 12345, delta: 12.5, tone: 'good' },
      { label: 'Failed', value: 40, delta: '+3 vs last week', tone: 'bad' },
      { label: 'Rate', value: 91.7, unit: '%' },
      { label: 'Note', value: 'n/a' },
    ],
  });

  it('draws each figure exactly as read, grouped by locale and with its unit, never rounded or shortened', () => {
    const out = show(kpis);
    expect(out).toContain('12,345');
    expect(out).not.toContain('12.3K');
    expect(out).toContain('91.7%');
    expect(out).toContain('n/a');
    expect(out.match(/data-testid="report-kpi"/g)).toHaveLength(4);
  });

  it('colours the change by tone, with a glyph and a word so colour is never the only cue', () => {
    const out = show(kpis);
    expect(out).toContain('text-success');
    expect(out).toContain('text-danger');
    expect(out).toContain('▲');
    expect(out).toContain('▼');
    expect(out).toContain('Good news');
    expect(out).toContain('Bad news');
    expect(out).toContain('+12.5%');
  });

  it('keeps the figure the model wrote when a live figure cannot load yet, and marks no "Live" label', () => {
    const live = block(SHOW_KPIS, {
      items: [{ label: 'Sent', value: 500, live: 'messages.sent' }],
    });
    const out = html(
      wrap(
        <LiveContext.Provider value={{ scope: 'workspace', window: '30d' }}>
          <BlockView block={live} />
        </LiveContext.Provider>,
      ),
    );
    expect(out).toContain('500');
    expect(out).not.toContain('>Live<');
  });

  it('does not ask the dashboard for a 90-day window, which it has no range for, nor for the platform', () => {
    const live = block(SHOW_KPIS, {
      items: [{ label: 'Sent', value: 500, live: 'messages.sent' }],
    });
    for (const ctx of [
      { scope: 'workspace', window: '90d' },
      { scope: 'platform', window: '30d' },
    ] as const) {
      const out = html(
        wrap(
          <LiveContext.Provider value={ctx}>
            <BlockView block={live} />
          </LiveContext.Provider>,
        ),
      );
      expect(out).toContain('500');
    }
  });
});

describe('summary and table blocks', () => {
  it('draws a summary safely: markdown becomes text nodes, never markup', () => {
    const out = show(
      block(SHOW_SUMMARY, { title: 'Q3', markdown: '**Up** <script>alert(1)</script>' }),
    );
    expect(out).toContain('<strong>Up</strong>');
    expect(out).not.toContain('<script');
  });

  it('draws a table with locale numbers and blanks for missing cells', () => {
    const out = show(
      block(SHOW_TABLE, {
        columns: ['Type', 'Count'],
        rows: [
          ['Text', 1234],
          ['Media', null],
        ],
      }),
    );
    expect(out).toContain('1,234');
    expect(out).toContain('Media');
    expect(out).not.toContain('null');
  });
});

describe('lossless numbers', () => {
  it('keeps every digit the model gave, in the locale grouping', () => {
    const out = show(
      block(SHOW_KPIS, {
        items: [
          { label: 'A', value: 1234567.891 },
          { label: 'B', value: 0.125 },
        ],
      }),
    );
    expect(out).toContain('1,234,567.891');
    expect(out).toContain('0.125');
  });
  it('keeps the unit the model gave, as written', () => {
    const out = show(
      block(SHOW_KPIS, {
        items: [
          { label: 'A', value: 4, unit: 'tickets' },
          { label: 'B', value: 5, unit: '%' },
        ],
      }),
    );
    expect(out).toContain('4 tickets');
    expect(out).toContain('5%');
  });
});

describe('sources', () => {
  it('shows under each block where its figures came from', () => {
    expect(show(bar())).toContain('Source: Dashboard, last 30 days');
  });
  it('says so when a block names no source', () => {
    expect(show(block(SHOW_TABLE, { columns: ['A'], rows: [['x']] }))).toContain(
      'No source stated',
    );
  });
});

describe('BlocksCanvas', () => {
  it('draws the blocks in the order they were shown and carries the colour variables', () => {
    const out = html(
      wrap(
        <BlocksCanvas blocks={[block(SHOW_SUMMARY, { title: 'First', markdown: 'a' }), bar()]} />,
      ),
    );
    expect(out.indexOf('First')).toBeLessThan(out.indexOf('Sends by week'));
    expect(out).toContain('--rc-1:#2a78d6');
    expect(out).toContain("data-theme='dark'");
  });
});
