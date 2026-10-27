import { z } from 'zod';

const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** GET /v2/platform/i18n/translation-usage?from&to (TW-I18N-030). Dates are YYYY-MM-DD, both ends inclusive. */
export const translationUsageQuerySchema = z
  .object({ from: dayString.optional(), to: dayString.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    path: ['from'],
    error: 'from must not be after to',
  });
export type TranslationUsageQuery = z.infer<typeof translationUsageQuerySchema>;

/** Cost fields are strings: the ledger counts millionths of a dollar and a bigint must not round through a JS number. */
const microsSchema = z.string().regex(/^\d+$/);

export const translationUsageResponseSchema = z.object({
  range: z.object({ from: z.iso.datetime(), to: z.iso.datetime() }),
  totals: z.object({
    calls: z.int(),
    charsIn: z.int(),
    charsOut: z.int(),
    costMicros: microsSchema,
    fallbackHits: z.int(),
  }),
  byProvider: z.array(
    z.object({
      providerSlug: z.string(),
      calls: z.int(),
      charsIn: z.int(),
      costMicros: microsSchema,
      ratePerMillionChars: microsSchema,
    }),
  ),
  timeline: z.array(z.object({ date: z.string(), charsIn: z.int(), costMicros: microsSchema })),
  topWorkspaces: z.array(
    z.object({
      workspaceId: z.guid(),
      name: z.string(),
      calls: z.int(),
      charsIn: z.int(),
      costMicros: microsSchema,
    }),
  ),
});
export type TranslationUsageResponse = z.infer<typeof translationUsageResponseSchema>;
