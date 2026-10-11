import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema } from '../common/pagination';

/** FAQ entries: a question, what answers it, and the variations that should reach it. Every id on the wire is a uuid. */

export const FAQ_ANSWER_TYPES = ['text', 'flow'] as const;
export type FaqAnswerType = (typeof FAQ_ANSWER_TYPES)[number];
export const FAQ_STATUSES = ['active', 'paused'] as const;
export type FaqStatus = (typeof FAQ_STATUSES)[number];
/** `question` is the FAQ's own question kept as a variation; `learned` came from an unanswered customer message. */
export const FAQ_VARIATION_SOURCES = ['question', 'manual', 'ai', 'import', 'learned'] as const;
export type FaqVariationSource = (typeof FAQ_VARIATION_SOURCES)[number];
export const FAQ_EMBED_STATES = ['pending', 'ready', 'failed'] as const;
export type FaqEmbedState = (typeof FAQ_EMBED_STATES)[number];

export const FAQ_LIMITS = {
  question: 500,
  answerText: 4096,
  category: 60,
  variation: 500,
  /** Variations accepted in one add request. */
  variationsPerRequest: 50,
  /** Variations the generator is asked for in one go. */
  generateMin: 3,
  generateMax: 20,
  generateDefault: 8,
  /** Rows a bulk action takes. */
  bulkMax: 200,
  searchLength: 200,
  /** The threshold the screens offer. */
  thresholdMin: 0.05,
  thresholdMax: 0.99,
  marginMax: 0.5,
  /** A message longer than this is cut before it is embedded. */
  queryMax: 1000,
} as const;

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

export const faqQuestionSchema = z
  .string()
  .trim()
  .min(1, 'Write the question customers ask.')
  .max(FAQ_LIMITS.question);
export const faqVariationTextSchema = z
  .string()
  .trim()
  .min(1, 'A variation cannot be empty.')
  .max(FAQ_LIMITS.variation);
const thresholdSchema = z.number().min(FAQ_LIMITS.thresholdMin).max(FAQ_LIMITS.thresholdMax);
const categorySchema = z.preprocess(
  blankToNull,
  z.string().trim().max(FAQ_LIMITS.category).nullable(),
);

const answerFields = {
  answerType: z.enum(FAQ_ANSWER_TYPES),
  answerText: z
    .preprocess(blankToNull, z.string().max(FAQ_LIMITS.answerText).nullable())
    .optional(),
  /** The flow to start, when `answerType` is `flow`. */
  flowId: uuidSchema.nullable().optional(),
};

/** A text answer needs its text, a flow answer needs its flow. */
const answerRule = (v: {
  answerType: FaqAnswerType;
  answerText?: string | null;
  flowId?: string | null;
}) =>
  v.answerType === 'text'
    ? typeof v.answerText === 'string' && v.answerText.trim() !== ''
    : typeof v.flowId === 'string';

export const createFaqEntrySchema = z
  .object({
    question: faqQuestionSchema,
    ...answerFields,
    category: categorySchema.optional(),
    status: z.enum(FAQ_STATUSES).default('active'),
    thresholdOverride: thresholdSchema.nullable().optional(),
    variations: z.array(faqVariationTextSchema).max(FAQ_LIMITS.variationsPerRequest).default([]),
    /** The unanswered log row this FAQ answers: it is marked handled in the same save. */
    resolveLogId: uuidSchema.optional(),
  })
  .refine(answerRule, {
    message: 'A text answer needs its text; a flow answer needs a flow.',
    path: ['answerText'],
  });
export type CreateFaqEntryInput = z.infer<typeof createFaqEntrySchema>;

export const updateFaqEntrySchema = z
  .object({
    question: faqQuestionSchema,
    ...answerFields,
    category: categorySchema.optional(),
    status: z.enum(FAQ_STATUSES),
    thresholdOverride: thresholdSchema.nullable().optional(),
    rowVersion: z.number().int().positive(),
  })
  .refine(answerRule, {
    message: 'A text answer needs its text; a flow answer needs a flow.',
    path: ['answerText'],
  });
export type UpdateFaqEntryInput = z.infer<typeof updateFaqEntrySchema>;

export const listFaqEntriesQuerySchema = paginationQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(FAQ_LIMITS.searchLength).optional(),
  status: z.enum(FAQ_STATUSES).optional(),
  category: z.string().trim().max(FAQ_LIMITS.category).optional(),
  /** Only the FAQs that have at least one variation still waiting for its vector (or failed). */
  indexing: z.enum(['pending', 'failed']).optional(),
});
export type ListFaqEntriesQuery = z.infer<typeof listFaqEntriesQuerySchema>;

export const bulkFaqEntriesSchema = z.object({
  action: z.enum(['delete', 'pause', 'activate']),
  ids: z.array(uuidSchema).min(1).max(FAQ_LIMITS.bulkMax),
});
export type BulkFaqEntriesInput = z.infer<typeof bulkFaqEntriesSchema>;

export const addFaqVariationsSchema = z.object({
  texts: z.array(faqVariationTextSchema).min(1).max(FAQ_LIMITS.variationsPerRequest),
  source: z.enum(['manual', 'ai', 'import']).default('manual'),
});
export type AddFaqVariationsInput = z.infer<typeof addFaqVariationsSchema>;

export const updateFaqVariationSchema = z.object({
  text: faqVariationTextSchema,
  rowVersion: z.number().int().positive(),
});
export type UpdateFaqVariationInput = z.infer<typeof updateFaqVariationSchema>;

export const generateFaqVariationsSchema = z.object({
  count: z
    .number()
    .int()
    .min(FAQ_LIMITS.generateMin)
    .max(FAQ_LIMITS.generateMax)
    .default(FAQ_LIMITS.generateDefault),
});
export type GenerateFaqVariationsInput = z.infer<typeof generateFaqVariationsSchema>;

// --- responses --------------------------------------------------------------------------------------------------------

export interface FaqVariation {
  id: string;
  text: string;
  source: FaqVariationSource;
  /** `pending` is waiting for its vector (the FAQ still matches by its other variations and by trigram); `failed` gave up. */
  embedState: FaqEmbedState;
  embedError: string | null;
  createdAt: string;
  rowVersion: number;
}

export interface FaqEntrySummary {
  id: string;
  question: string;
  answerType: FaqAnswerType;
  /** The first 160 characters of a text answer (the list shows a preview; the editor loads the whole entry). */
  answerPreview: string | null;
  flowId: string | null;
  flowName: string | null;
  category: string | null;
  status: FaqStatus;
  thresholdOverride: number | null;
  /** Messages this FAQ answered in the last 90 days (counted from the match log, which is swept after that). */
  hitCount: number;
  lastHitAt: string | null;
  /** Counts include the question itself. */
  variationCount: number;
  readyCount: number;
  pendingCount: number;
  failedCount: number;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

export interface FaqEntry extends Omit<FaqEntrySummary, 'answerPreview'> {
  answerText: string | null;
  variations: FaqVariation[];
}

export interface FaqListStats {
  total: number;
  active: number;
  paused: number;
  variations: number;
  pending: number;
  failed: number;
  categories: string[];
}

export interface FaqEntryListResponse {
  data: FaqEntrySummary[];
  page: { nextCursor: string | null; hasMore: boolean; limit: number };
  stats: FaqListStats;
}

export interface FaqBulkResult {
  affected: number;
}

export interface FaqGenerateResult {
  /** Not saved: the person picks which to add. Duplicates of what the FAQ already has are left out. */
  suggestions: string[];
  model: string;
}
