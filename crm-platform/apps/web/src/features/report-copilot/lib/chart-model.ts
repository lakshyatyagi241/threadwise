import type { ReportChart } from '@crm/contracts';

/** Series colours, as the page's own tokens so light, dark and a re-branded theme recolour the report. */
export const CHART_COLORS = [
  'var(--primary)',
  'var(--success)',
  'var(--warning)',
  'var(--danger)',
  'var(--brand)',
  'var(--muted-foreground)',
] as const;

const colorAt = (i: number) => CHART_COLORS[i % CHART_COLORS.length] as string;

/**
 * The model's series may name different labels. The axis lists every label once, in the order first seen, and a series with no
 * point for a label reads as zero there.
 */
export function toAxisChart(chart: ReportChart): {
  labels: string[];
  series: Array<{ name: string; values: number[]; color: string }>;
} {
  const labels: string[] = [];
  for (const s of chart.series)
    for (const p of s.points) if (!labels.includes(p.label)) labels.push(p.label);
  return {
    labels,
    series: chart.series.map((s, i) => ({
      name: s.name,
      color: colorAt(i),
      values: labels.map((l) => s.points.find((p) => p.label === l)?.value ?? 0),
    })),
  };
}

/** A pie shows one series: the first. Slices of zero or less cannot be drawn and are left out. */
export function toPieSlices(
  chart: ReportChart,
): Array<{ name: string; value: number; color: string }> {
  const first = chart.series[0];
  if (!first) return [];
  return first.points
    .filter((p) => p.value > 0)
    .map((p, i) => ({ name: p.label, value: p.value, color: colorAt(i) }));
}
