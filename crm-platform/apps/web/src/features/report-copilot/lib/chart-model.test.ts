import { describe, expect, it } from 'vitest';
import type { ReportChart } from '@crm/contracts';
import { CHART_COLORS, toAxisChart, toPieSlices } from './chart-model';

const chart = (series: ReportChart['series'], type: ReportChart['type'] = 'bar'): ReportChart => ({
  type,
  series,
});

describe('toAxisChart', () => {
  it('lines up series that name different labels and reads a gap as zero', () => {
    const out = toAxisChart(
      chart([
        {
          name: 'Sent',
          points: [
            { label: 'Mon', value: 5 },
            { label: 'Tue', value: 7 },
          ],
        },
        {
          name: 'Read',
          points: [
            { label: 'Tue', value: 3 },
            { label: 'Wed', value: 2 },
          ],
        },
      ]),
    );
    expect(out.labels).toEqual(['Mon', 'Tue', 'Wed']);
    expect(out.series[0]?.values).toEqual([5, 7, 0]);
    expect(out.series[1]?.values).toEqual([0, 3, 2]);
  });

  it('gives each series a token colour and cycles past the palette', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      name: `s${i}`,
      points: [{ label: 'a', value: 1 }],
    }));
    const out = toAxisChart(chart(many));
    expect(out.series.map((s) => s.color)).toEqual([...CHART_COLORS]);
    expect(out.series.every((s) => s.color.startsWith('var(--'))).toBe(true);
  });
});

describe('toPieSlices', () => {
  it('uses the first series and leaves out slices that cannot be drawn', () => {
    const out = toPieSlices(
      chart(
        [
          {
            name: 'Share',
            points: [
              { label: 'A', value: 3 },
              { label: 'B', value: 0 },
              { label: 'C', value: -2 },
              { label: 'D', value: 1 },
            ],
          },
          { name: 'ignored', points: [{ label: 'Z', value: 9 }] },
        ],
        'pie',
      ),
    );
    expect(out.map((s) => s.name)).toEqual(['A', 'D']);
  });
});
