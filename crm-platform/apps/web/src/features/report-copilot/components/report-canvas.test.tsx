import { describe, expect, it } from 'vitest';
import { reportSpecSchema } from '@crm/contracts';
import { ReportCanvas } from './report-canvas';
import { html } from './test-utils';

const spec = reportSpecSchema.parse({
  title: 'Performance, last 30 days',
  summary: 'Sends are up.',
  kpis: [
    { label: 'Sent', value: '12k', delta: '+12% vs last period', tone: 'good' },
    { label: 'Failed', value: '40', delta: '+3', tone: 'bad' },
  ],
  sections: [
    {
      heading: 'Volume',
      body: 'Sent **12k** messages.\n\n- first\n- second',
      chart: {
        type: 'bar',
        title: 'Sends by week',
        series: [
          {
            name: 'Sent',
            points: [
              { label: 'W1', value: 3 },
              { label: 'W2', value: 4 },
            ],
          },
        ],
      },
    },
    {
      heading: 'Trend',
      body: '',
      chart: {
        type: 'line',
        title: 'Reads',
        series: [
          {
            name: 'Read',
            points: [
              { label: 'W1', value: 1 },
              { label: 'W2', value: 4 },
            ],
          },
        ],
      },
    },
    {
      heading: 'Mix',
      body: '',
      chart: {
        type: 'pie',
        title: 'Message types',
        series: [
          {
            name: 'Share',
            points: [
              { label: 'Text', value: 7 },
              { label: 'Media', value: 3 },
            ],
          },
        ],
      },
      table: {
        columns: ['Type', 'Count'],
        rows: [
          ['Text', 1234],
          ['Media', null],
        ],
      },
    },
  ],
  sources: ['plan.pdf', 'Dashboard, last 30 days'],
});

describe('ReportCanvas', () => {
  const out = html(<ReportCanvas spec={spec} />);

  it('draws title, summary, key figures, sections and sources', () => {
    expect(out).toContain('Performance, last 30 days');
    expect(out).toContain('Sends are up.');
    expect(out).toContain('Key figures');
    expect(out.match(/data-testid="report-kpi"/g)).toHaveLength(2);
    expect(out).toContain('+12% vs last period');
    expect(out).toContain('Volume');
    expect(out).toContain('<strong>12k</strong>');
    expect(out).toContain('<li>first</li>');
    expect(out).toContain('Sources');
    expect(out).toContain('plan.pdf');
  });

  it('draws a chart for each type through the dashboard chart components', () => {
    expect(out).toContain('aria-label="Sends by week"');
    expect(out).toContain('aria-label="Reads"');
    expect(out).toContain('aria-label="Message types"');
    expect(out).toContain('Text');
  });

  it('draws a table with its columns and rows', () => {
    expect(out).toContain('<th scope="col"');
    expect(out).toContain('1,234');
  });

  it('never lets model text become markup', () => {
    const hostile = reportSpecSchema.parse({
      title: '<img src=x onerror=alert(1)>',
      summary: '<script>alert(1)</script>',
      kpis: [{ label: '<b>L</b>', value: '<i>1</i>' }],
      sections: [
        {
          heading: '<h1>H</h1>',
          body: '<script>alert(2)</script> [x](javascript:alert(3)) **ok**\n\n<div onclick="evil()">d</div>',
          table: { columns: ['<u>c</u>'], rows: [['<script>alert(4)</script>']] },
        },
      ],
      sources: ['<a href="javascript:alert(5)">s</a>'],
    });
    const h = html(<ReportCanvas spec={hostile} />);
    expect(h).not.toContain('<script');
    expect(h).not.toContain('<img');
    expect(h).not.toContain('<div onclick');
    expect(h).not.toContain('href="javascript');
    expect(h).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(h).toContain('<strong>ok</strong>');
  });

  it('opens a safe link in a new tab without leaking the opener', () => {
    const linked = reportSpecSchema.parse({
      title: 'T',
      summary: '',
      sections: [{ heading: 'H', body: 'See [docs](https://example.com/a).' }],
    });
    const h = html(<ReportCanvas spec={linked} />);
    expect(h).toContain('href="https://example.com/a"');
    expect(h).toContain('rel="noopener noreferrer nofollow"');
    expect(h).toContain('target="_blank"');
  });
});
