import type { ReportChart, ReportSpec } from '@crm/contracts';
import { sourcesOf, type Block, type ChartBlock } from './blocks';

export interface ExportLabels {
  keyFigures: string;
  sources: string;
}

const cell = (v: string | number | null): string =>
  v === null
    ? ''
    : String(v)
        .replace(/\|/g, '\\|')
        .replace(/\s*\n\s*/g, ' ');

function table(columns: string[], rows: Array<Array<string | number | null>>): string[] {
  const width = columns.length;
  return [
    `| ${columns.map(cell).join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map(
      (r) => `| ${Array.from({ length: width }, (_, i) => cell(r[i] ?? null)).join(' | ')} |`,
    ),
  ];
}

/** A chart in a markdown file is its data as a table: one row per label, one column per series. */
function chartAsTable(chart: ReportChart): string[] {
  const labels: string[] = [];
  for (const s of chart.series)
    for (const p of s.points) if (!labels.includes(p.label)) labels.push(p.label);
  const lines = chart.title ? [`**${chart.title}** (${chart.type})`, ''] : [];
  return [
    ...lines,
    ...table(
      [chart.xLabel ?? '', ...chart.series.map((s) => s.name)],
      labels.map((l) => [
        l,
        ...chart.series.map((s) => s.points.find((p) => p.label === l)?.value ?? null),
      ]),
    ),
  ];
}

/** The report as markdown text, for "Copy as Markdown". The model's own markdown bodies are kept as written. */
export function reportToMarkdown(spec: ReportSpec, labels: ExportLabels): string {
  const out: string[] = [`# ${spec.title}`, ''];
  if (spec.summary) out.push(spec.summary, '');
  if (spec.kpis.length) {
    out.push(`## ${labels.keyFigures}`, '');
    for (const k of spec.kpis)
      out.push(`- **${k.label}:** ${k.value}${k.delta ? ` (${k.delta})` : ''}`);
    out.push('');
  }
  for (const s of spec.sections) {
    out.push(`## ${s.heading}`, '');
    if (s.body.trim()) out.push(s.body.trim(), '');
    if (s.chart) out.push(...chartAsTable(s.chart), '');
    if (s.table) out.push(...table(s.table.columns, s.table.rows), '');
  }
  if (spec.sources.length) {
    out.push(`## ${labels.sources}`, '');
    for (const s of spec.sources) out.push(`- ${s}`);
    out.push('');
  }
  return out.join('\n').trimEnd() + '\n';
}

/** A file name from the report title: lower case, letters and digits joined by dashes, never empty. */
export function reportFileName(spec: ReportSpec, extension: string): string {
  const slug = spec.title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'report'}.${extension}`;
}

const withUnit = (
  v: number,
  c: { unit?: string | undefined; prefix?: string | undefined; suffix?: string | undefined },
) => `${c.prefix ?? ''}${v}${c.suffix ?? ''}${c.unit ? ` ${c.unit}` : ''}`;

function blockChartTable(chart: ChartBlock): string[] {
  const labels: string[] = [];
  for (const s of chart.series)
    for (const p of s.points) if (!labels.includes(p.label)) labels.push(p.label);
  const lines = chart.title ? [`**${chart.title}** (${chart.type})`, ''] : [];
  return [
    ...lines,
    ...table(
      [chart.xLabel ?? '', ...chart.series.map((s) => s.name)],
      labels.map((l) => [
        l,
        ...chart.series.map((s) => {
          const v = s.points.find((p) => p.label === l)?.value;
          return v === undefined ? null : withUnit(v, chart);
        }),
      ]),
    ),
  ];
}

/** A report made of blocks as markdown: each block in order, each followed by the sources it names. */
export function blocksToMarkdown(blocks: readonly Block[], labels: { source: string }): string {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.tool === 'show_summary') {
      if (b.data.title) out.push(`## ${b.data.title}`, '');
      out.push(b.data.markdown.trim(), '');
    } else if (b.tool === 'show_kpis') {
      if (b.data.title) out.push(`## ${b.data.title}`, '');
      for (const k of b.data.items)
        out.push(
          `- **${k.label}:** ${typeof k.value === 'number' ? withUnit(k.value, k) : k.value}${k.delta !== undefined ? ` (${k.delta})` : ''}`,
        );
      out.push('');
    } else if (b.tool === 'show_chart') {
      out.push(...blockChartTable(b.data), '');
    } else {
      if (b.data.title) out.push(`## ${b.data.title}`, '');
      out.push(...table(b.data.columns, b.data.rows), '');
    }
    const src = sourcesOf(b);
    if (src.length) out.push(`*${labels.source}: ${src.join(', ')}*`, '');
  }
  return out.join('\n').trimEnd() + '\n';
}
