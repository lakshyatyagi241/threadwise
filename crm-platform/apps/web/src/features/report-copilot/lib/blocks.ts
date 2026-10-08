import { z } from 'zod';

/**
 * The report's building blocks, as the model fills them in (CopilotKit "controlled generative UI"): each block is a typed React
 * component the model calls like a tool. The same schemas validate what arrives, so a malformed block is an error card, never a
 * broken page, and a number that is not a finite number never reaches a chart.
 */

const num = z.number().finite();
const source = z
  .union([z.string().max(200), z.array(z.string().max(200)).max(10)])
  .optional()
  .describe(
    'Where the figures came from: a document name, or the dashboard figure and its period, for example "Dashboard, last 30 days". Always fill it in.',
  );
const unitFields = {
  unit: z
    .string()
    .max(12)
    .optional()
    .describe('Unit shown after the number, for example "%" or "msgs".'),
  prefix: z.string().max(6).optional().describe('Shown before the number, for example "$".'),
  suffix: z.string().max(12).optional().describe('Shown after the number, for example "k".'),
};

export const SHOW_SUMMARY = 'show_summary';
export const SHOW_KPIS = 'show_kpis';
export const SHOW_CHART = 'show_chart';
export const SHOW_TABLE = 'show_table';

export const summaryBlockSchema = z.object({
  title: z.string().max(160).optional().describe('Heading of the report or section.'),
  markdown: z.string().max(4000).describe('Short markdown: paragraphs, lists, **bold**. No HTML.'),
  source,
});

export const kpiSchema = z.object({
  label: z.string().max(80),
  value: z
    .union([num, z.string().max(40)])
    .describe("A number (preferred, drawn with the reader's number format) or a short text."),
  ...unitFields,
  delta: z
    .union([num, z.string().max(60)])
    .optional()
    .describe(
      'Change against the previous period: a number of percent, or short text such as "+12% vs last period".',
    ),
  tone: z
    .enum(['good', 'bad', 'neutral'])
    .optional()
    .describe('Is the change good news, bad news or neither.'),
  source,
  // A plain string, not an enum: a key the screen does not know is ignored and the figure written here is shown as it is.
  live: z
    .string()
    .max(80)
    .optional()
    .describe(
      'Optional. A live metric key from the list you were given; the screen then keeps this figure current without asking you again. Write the value you read as well.',
    ),
});
export type Kpi = z.infer<typeof kpiSchema>;

export const kpisBlockSchema = z.object({
  title: z.string().max(160).optional(),
  items: z.array(kpiSchema).min(1).max(8),
  source,
});

export const CHART_TYPES = ['bar', 'line', 'area', 'pie', 'donut'] as const;

export const chartBlockSchema = z.object({
  title: z.string().max(160).optional(),
  type: z.enum(CHART_TYPES),
  xLabel: z.string().max(60).optional(),
  yLabel: z.string().max(60).optional(),
  ...unitFields,
  stacked: z.boolean().optional().describe('Bar charts only: stack the series.'),
  series: z
    .array(
      z.object({
        name: z.string().max(80),
        points: z
          .array(z.object({ label: z.string().max(80), value: num }))
          .min(1)
          .max(60),
      }),
    )
    .min(1)
    .max(6)
    .describe('One or more series. A pie or donut uses the first series: one point per slice.'),
  source,
});
export type ChartBlock = z.infer<typeof chartBlockSchema>;

export const tableBlockSchema = z.object({
  title: z.string().max(160).optional(),
  columns: z.array(z.string().max(80)).min(1).max(10),
  rows: z
    .array(z.array(z.union([z.string().max(400), num, z.null()])).max(10))
    .min(1)
    .max(50),
  source,
});

export type BlockTool =
  typeof SHOW_SUMMARY | typeof SHOW_KPIS | typeof SHOW_CHART | typeof SHOW_TABLE;

export type Block =
  | { id: string; tool: typeof SHOW_SUMMARY; data: z.infer<typeof summaryBlockSchema> }
  | { id: string; tool: typeof SHOW_KPIS; data: z.infer<typeof kpisBlockSchema> }
  | { id: string; tool: typeof SHOW_CHART; data: ChartBlock }
  | { id: string; tool: typeof SHOW_TABLE; data: z.infer<typeof tableBlockSchema> };

const SCHEMAS = {
  [SHOW_SUMMARY]: summaryBlockSchema,
  [SHOW_KPIS]: kpisBlockSchema,
  [SHOW_CHART]: chartBlockSchema,
  [SHOW_TABLE]: tableBlockSchema,
} as const;

export type BlockOutcome = { ok: true; block: Block } | { ok: false; issues: string[] };

/** Checks what the model sent for one block. Never throws; a bad block comes back as short, readable issues. */
export function parseBlock(tool: BlockTool, id: string, args: unknown): BlockOutcome {
  const parsed = SCHEMAS[tool].safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues
        .slice(0, 5)
        .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)),
    };
  }
  return { ok: true, block: { id, tool, data: parsed.data } as Block };
}

/** The text a block tool hands back to the model: ok, or the issues so it can send the block again. */
export const blockResult = (o: BlockOutcome): string =>
  o.ok
    ? JSON.stringify({ ok: true })
    : JSON.stringify({
        ok: false,
        issues: o.issues,
        hint: 'The block was not drawn. Fix these fields and call the tool again.',
      });

/** Where a block says its figures came from: the block's own source and those of its key figures, each once. */
export function sourcesOf(block: Block): string[] {
  const out: string[] = [];
  const add = (s: string | string[] | undefined) => {
    for (const x of Array.isArray(s) ? s : s ? [s] : [])
      if (x.trim() && !out.includes(x.trim())) out.push(x.trim());
  };
  add(block.data.source);
  if (block.tool === SHOW_KPIS) for (const k of block.data.items) add(k.source);
  return out;
}

/** True when two blocks say exactly the same thing: the model sometimes sends one twice in a row. */
export function sameBlock(a: Block, b: Block): boolean {
  return a.tool === b.tool && JSON.stringify(a.data) === JSON.stringify(b.data);
}
