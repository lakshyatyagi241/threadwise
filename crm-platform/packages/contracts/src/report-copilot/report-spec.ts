import { z } from 'zod';

/**
 * The report the assistant hands the screen to draw (the `render_report` action). The model fills it in; the web validates it with
 * this same schema before drawing, so a malformed answer is an error card, never a broken page.
 */
export const reportChartSchema = z.object({
  type: z.enum(['bar', 'line', 'pie']),
  title: z.string().max(120).optional(),
  xLabel: z.string().max(60).optional(),
  yLabel: z.string().max(60).optional(),
  series: z
    .array(
      z.object({
        name: z.string().max(80),
        points: z
          .array(z.object({ label: z.string().max(80), value: z.number() }))
          .min(1)
          .max(60),
      }),
    )
    .min(1)
    .max(6),
});
export type ReportChart = z.infer<typeof reportChartSchema>;

export const reportTableSchema = z.object({
  columns: z.array(z.string().max(80)).min(1).max(10),
  rows: z
    .array(z.array(z.union([z.string(), z.number(), z.null()])).max(10))
    .min(1)
    .max(50),
});
export type ReportTable = z.infer<typeof reportTableSchema>;

export const reportKpiSchema = z.object({
  label: z.string().max(80),
  value: z.string().max(40),
  /** A short change note such as "+12% vs last period". */
  delta: z.string().max(60).optional(),
  tone: z.enum(['good', 'bad', 'neutral']).optional(),
});
export type ReportKpi = z.infer<typeof reportKpiSchema>;

export const reportSectionSchema = z.object({
  heading: z.string().max(120),
  /** Markdown: paragraphs, lists, bold. No HTML. */
  body: z.string().max(6000),
  chart: reportChartSchema.optional(),
  table: reportTableSchema.optional(),
});
export type ReportSection = z.infer<typeof reportSectionSchema>;

export const reportSpecSchema = z.object({
  title: z.string().min(1).max(160),
  summary: z.string().max(2000),
  kpis: z.array(reportKpiSchema).max(8).default([]),
  sections: z.array(reportSectionSchema).min(1).max(12),
  /** What the report rests on: document names and the dashboard figures it used. */
  sources: z.array(z.string().max(200)).max(30).default([]),
});
export type ReportSpec = z.infer<typeof reportSpecSchema>;
