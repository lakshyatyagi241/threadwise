import { describe, expect, it } from 'vitest';
import { reportSpecSchema } from '@crm/contracts';
import { blocksToMarkdown, reportFileName, reportToMarkdown } from './report-export';

const spec = reportSpecSchema.parse({
  title: 'Q3 report',
  summary: 'Up and to the right.',
  kpis: [
    { label: 'Sent', value: '12k', delta: '+12% vs last period', tone: 'good' },
    { label: 'Failed', value: '40' },
  ],
  sections: [
    {
      heading: 'Volume',
      body: 'Sent **12k** messages.',
      chart: {
        type: 'bar',
        title: 'By week',
        xLabel: 'Week',
        series: [
          {
            name: 'Sent',
            points: [
              { label: 'W1', value: 3 },
              { label: 'W2', value: 4 },
            ],
          },
          { name: 'Read', points: [{ label: 'W2', value: 2 }] },
        ],
      },
      table: {
        columns: ['Name', 'Note'],
        rows: [
          ['a|b', 'x\ny'],
          ['c', null],
        ],
      },
    },
  ],
  sources: ['plan.pdf', 'Dashboard, last 30 days'],
});
const labels = { keyFigures: 'Key figures', sources: 'Sources' };

describe('reportToMarkdown', () => {
  const md = reportToMarkdown(spec, labels);
  it('writes the title, summary, key figures, sections and sources', () => {
    expect(md).toContain('# Q3 report');
    expect(md).toContain('Up and to the right.');
    expect(md).toContain('## Key figures');
    expect(md).toContain('- **Sent:** 12k (+12% vs last period)');
    expect(md).toContain('- **Failed:** 40');
    expect(md).toContain('## Volume');
    expect(md).toContain('Sent **12k** messages.');
    expect(md).toContain('## Sources');
    expect(md).toContain('- plan.pdf');
  });
  it('writes a chart as its data table', () => {
    expect(md).toContain('| Week | Sent | Read |');
    expect(md).toContain('| W1 | 3 |  |');
    expect(md).toContain('| W2 | 4 | 2 |');
  });
  it('escapes pipes and flattens line breaks in table cells', () => {
    expect(md).toContain('| a\\|b | x y |');
    expect(md).toContain('| c |  |');
  });
});

describe('reportFileName', () => {
  it('slugs the title and never comes out empty', () => {
    expect(reportFileName(spec, 'json')).toBe('q3-report.json');
    expect(reportFileName({ ...spec, title: 'Café: résumé / 2026!' }, 'json')).toBe(
      'cafe-resume-2026.json',
    );
    expect(reportFileName({ ...spec, title: '???' }, 'json')).toBe('report.json');
  });
});

describe('blocksToMarkdown', () => {
  const blocks = [
    { id: '1', tool: 'show_summary', data: { title: 'Q3', markdown: 'Up **12%**.' } },
    {
      id: '2',
      tool: 'show_kpis',
      data: {
        items: [{ label: 'Sent', value: 1200, unit: 'msgs', delta: 12 }],
        source: 'plan.pdf',
      },
    },
    {
      id: '3',
      tool: 'show_chart',
      data: {
        type: 'bar',
        title: 'By week',
        series: [{ name: 'Sent', points: [{ label: 'W1', value: 3 }] }],
        source: 'Dashboard, last 30 days',
      },
    },
    { id: '4', tool: 'show_table', data: { columns: ['A'], rows: [['x']] } },
  ] as never;
  const md = blocksToMarkdown(blocks, { source: 'Source' });
  it('writes each block in order with the sources it names', () => {
    expect(md).toContain('## Q3');
    expect(md).toContain('- **Sent:** 1200 msgs (12)');
    expect(md).toContain('*Source: plan.pdf*');
    expect(md).toContain('| W1 | 3 |'.replace('W1 | 3', 'W1 | 3'));
    expect(md).toContain('*Source: Dashboard, last 30 days*');
    expect(md.indexOf('Q3')).toBeLessThan(md.indexOf('By week'));
  });
});
