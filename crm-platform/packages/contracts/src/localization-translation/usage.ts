import { z } from 'zod';

const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** GET /v2/platform/i18n/translation-usage?from&to (TW-I18N-030). Dates are YYYY-MM-DD, both ends inclusive. */
export const translationUsageQuerySchema = z
  .object({ from: dayString.optional(), to: dayString.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'from must not be after to',
    path: ['from'],
  });
export type TranslationUsageQuery = z.infer<typeof translationUsageQuerySchema>;

/** Cost fields are strings: the ledger counts millionths of a dollar and a bigint must not round through a JS number. */
const microsSchema = z.string().regex(/^\d+$/);

export const translationUsageResponseSchema = z.object({
  range: z.object({ from: z.string().datetime(), to: z.string().datetime() }),
  totals: z.object({
    calls: z.number().int(),
    charsIn: z.number().int(),
    charsOut: z.number().int(),
    costMicros: microsSchema,
    fallbackHits: z.number().int(),
  }),
  byProvider: z.array(
    z.object({
      providerSlug: z.string(),
      calls: z.number().int(),
      charsIn: z.number().int(),
      costMicros: microsSchema,
      ratePerMillionChars: microsSchema,
    }),
  ),
  timeline: z.array(
    z.object({ date: z.string(), charsIn: z.number().int(), costMicros: microsSchema }),
  ),
  topWorkspaces: z.array(
    z.object({
      workspaceId: z.string().uuid(),
      name: z.string(),
      calls: z.number().int(),
      charsIn: z.number().int(),
      costMicros: microsSchema,
    }),
  ),
});
export type TranslationUsageResponse = z.infer<typeof translationUsageResponseSchema>;
