import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import {
  AI_USAGE_MAX_CUSTOM_DAYS,
  aiUsageResultWindowSchema,
  aiUsageWindowSchema,
} from './catalog';

/**
 * The AI usage screens (TW-AIADM-017, 019..027): one for a workspace (its own ledger rows) and one for the
 * platform operator (every row, plus the state of the keys). Money is a decimal string; the dollar figure is an
 * ESTIMATE from blended per-provider rates, never a bill.
 */

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const dayMs = (d: string): number => Date.parse(`${d}T00:00:00Z`);

/**
 * A preset `window`, or a custom range: `from` and `to` (inclusive UTC days) sent together override the preset.
 */
export const aiUsageQuerySchema = z
  .object({ window: aiUsageWindowSchema, from: isoDay.optional(), to: isoDay.optional() })
  .superRefine((q, ctx) => {
    if (q.from === undefined && q.to === undefined) return;
    if (q.from === undefined || q.to === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [q.from === undefined ? 'from' : 'to'],
        message: 'Send both from and to',
      });
      return;
    }
    const a = dayMs(q.from);
    const b = dayMs(q.to);
    if (Number.isNaN(a))
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'Not a valid date' });
    else if (Number.isNaN(b))
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Not a valid date' });
    else if (a > b)
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'End date is before the start date' });
    else if ((b - a) / 86_400_000 + 1 > AI_USAGE_MAX_CUSTOM_DAYS)
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `Range is longer than ${AI_USAGE_MAX_CUSTOM_DAYS} days`,
      });
  });
export type AiUsageQuery = z.infer<typeof aiUsageQuerySchema>;

const count = z.number().int();
const providerTotal = z.object({ provider: z.string(), tokens: count, calls: count });
const dailyPoint = z.object({ date: z.string(), tokens: count });
const modelRow = z.object({
  model: z.string().nullable(),
  provider: z.string(),
  tokens: count,
  calls: count,
});
const sourceSplit = z.object({ admin: count, workspace: count });

export const aiUsageResponseSchema = z.object({
  window: aiUsageResultWindowSchema,
  from: z.string(),
  /** The last day covered (inclusive, `YYYY-MM-DD`). */
  to: z.string(),
  kpis: z.object({
    tokens: count,
    calls: count,
    /** Tokens billed to the platform's key. */
    platformTokens: count,
    /** Tokens billed to the workspace's own key. */
    ownKeyTokens: count,
    estimatedCostUsd: z.string(),
    providers: count,
    models: count,
  }),
  daily: z.array(dailyPoint),
  byProvider: z.array(providerTotal),
  byModel: z.array(modelRow.extend({ promptTokens: count, completionTokens: count })),
  sourceSplit,
  /** Calendar-month platform-key tokens against the plan cap. */
  cap: z.object({
    used: count,
    limit: count.nullable(),
    percent: z.number().int().min(0).max(100),
    /** True once a cap exists and has been reached. */
    reached: z.boolean(),
  }),
});
export type AiUsageResponse = z.infer<typeof aiUsageResponseSchema>;

export const aiDashboardResponseSchema = z.object({
  window: aiUsageResultWindowSchema,
  from: z.string(),
  /** The last day covered (inclusive, `YYYY-MM-DD`). */
  to: z.string(),
  kpis: z.object({
    tokens: count,
    calls: count,
    platformTokens: count,
    ownKeyTokens: count,
    estimatedCostUsd: z.string(),
    providers: count,
    workspaces: count,
  }),
  daily: z.array(dailyPoint),
  byProvider: z.array(providerTotal),
  byModel: z.array(modelRow),
  topWorkspaces: z.array(
    z.object({
      id: uuidSchema,
      name: z.string(),
      tokens: count,
      calls: count,
      ownKeyTokens: count,
    }),
  ),
  sourceSplit,
  keys: z.object({
    platform: z.array(
      z.object({
        provider: z.string(),
        defaultModel: z.string().nullable(),
        /** Active and holding a readable key. */
        live: z.boolean(),
      }),
    ),
    byok: z.object({
      count,
      workspaces: count,
      byProvider: z.record(z.string(), count),
    }),
  }),
});
export type AiDashboardResponse = z.infer<typeof aiDashboardResponseSchema>;
