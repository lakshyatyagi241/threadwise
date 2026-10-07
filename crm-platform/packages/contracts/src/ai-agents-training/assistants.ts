import { z } from 'zod';
import { AI_PROVIDERS } from '../ai-keys-usage-admin/catalog';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema, pageResponseSchema } from '../common/pagination';

/**
 * AI Training (AIAG): the trained chat assistants of a workspace (persona, model, safety) and the shapes behind
 * `/v2/ai-training`. Field names keep WaDesk's meaning, camelCase, every id a uuid.
 */

export const AIAG_ASSISTANT_STATUSES = ['active', 'paused'] as const;
export type AiagAssistantStatus = (typeof AIAG_ASSISTANT_STATUSES)[number];

/** The voice vendors of the catalogue are not text models: an assistant answers in chat. */
const TEXT_PROVIDERS = AI_PROVIDERS.filter((p) => p.group === 'llm').map((p) => p.slug) as [
  string,
  ...string[],
];
export const aiagProviderSchema = z.enum(TEXT_PROVIDERS);

/** WaDesk's limits, column for column. */
export const AIAG_LIMITS = {
  name: 120,
  greeting: 1000,
  systemPrompt: 8000,
  tone: 32,
  language: 16,
  model: 80,
  replyMaxTokensMin: 50,
  replyMaxTokensMax: 4000,
  temperatureMin: 0,
  temperatureMax: 2,
  fallbackMessage: 1000,
  handoffKeyword: 60,
  handoffMessage: 1000,
} as const;

/** What the builder starts a new assistant with (the wizard's own starting values; the API applies them too). */
export const AIAG_BUILDER_DEFAULTS = {
  name: '',
  status: 'active',
  greeting: 'Hi! How can I help today?',
  systemPrompt:
    "You are a helpful website assistant. Be concise, friendly, and accurate. If you don't know something, say so and offer to connect a teammate.",
  tone: 'helpful',
  language: 'en',
  aiProvider: 'openai',
  aiModel: 'gpt-4o-mini',
  replyMaxTokens: 400,
  temperature: 0.7,
  fallbackMessage: 'A teammate will follow up shortly — thanks for your patience.',
  handoffEnabled: true,
  handoffKeyword: 'talk to human',
  handoffMessage: 'Sure — pulling in a teammate now.',
} as const;

/** The tones the wizard offers; the column takes any text up to 32 characters, as in WaDesk. */
export const AIAG_TONES = ['helpful', 'friendly', 'formal', 'playful'] as const;

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().max(max).nullable().optional());

const assistantFields = {
  name: z.string().trim().min(1, 'Name your assistant.').max(AIAG_LIMITS.name),
  greeting: optionalText(AIAG_LIMITS.greeting),
  systemPrompt: optionalText(AIAG_LIMITS.systemPrompt),
  tone: z.string().trim().min(1).max(AIAG_LIMITS.tone).optional(),
  language: z.string().trim().min(1).max(AIAG_LIMITS.language).optional(),
  aiProvider: aiagProviderSchema.optional(),
  aiModel: z.string().trim().min(1).max(AIAG_LIMITS.model).optional(),
  replyMaxTokens: z
    .number()
    .int()
    .min(AIAG_LIMITS.replyMaxTokensMin, 'Reply length must be 50–4000 tokens.')
    .max(AIAG_LIMITS.replyMaxTokensMax, 'Reply length must be 50–4000 tokens.')
    .optional(),
  temperature: z
    .number()
    .min(AIAG_LIMITS.temperatureMin, 'Creativity must be between 0 and 2.')
    .max(AIAG_LIMITS.temperatureMax, 'Creativity must be between 0 and 2.')
    .optional(),
  fallbackMessage: optionalText(AIAG_LIMITS.fallbackMessage),
  handoffEnabled: z.boolean().optional(),
  handoffKeyword: optionalText(AIAG_LIMITS.handoffKeyword),
  handoffMessage: optionalText(AIAG_LIMITS.handoffMessage),
  status: z.enum(AIAG_ASSISTANT_STATUSES).optional(),
};

export const createAiagAssistantSchema = z.object(assistantFields).strict();
export type CreateAiagAssistantInput = z.infer<typeof createAiagAssistantSchema>;

/** The whole form plus the row version it was read at; a stale one is refused with 409 ROW_VERSION_CONFLICT. */
export const updateAiagAssistantSchema = z
  .object({ ...assistantFields, rowVersion: z.number().int().min(0) })
  .strict();
export type UpdateAiagAssistantInput = z.infer<typeof updateAiagAssistantSchema>;

export const aiagAssistantSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
  status: z.enum(AIAG_ASSISTANT_STATUSES),
  greeting: z.string().nullable(),
  systemPrompt: z.string().nullable(),
  tone: z.string(),
  language: z.string(),
  aiProvider: z.string(),
  aiModel: z.string(),
  replyMaxTokens: z.number().int(),
  temperature: z.number(),
  fallbackMessage: z.string().nullable(),
  handoffEnabled: z.boolean(),
  handoffKeyword: z.string().nullable(),
  handoffMessage: z.string().nullable(),
  /** Every source of the assistant, whatever its state (the "N entries" of the list). */
  sourceCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  rowVersion: z.number().int(),
});
export type AiagAssistant = z.infer<typeof aiagAssistantSchema>;

export const listAiagAssistantsQuerySchema = paginationQuerySchema.omit({ order: true }).extend({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListAiagAssistantsQuery = z.infer<typeof listAiagAssistantsQuerySchema>;

export const aiagStatsSchema = z.object({
  /** Assistants of the workspace. */
  all: z.number().int(),
  active: z.number().int(),
  /** Knowledge entries of the workspace, including workspace-wide ones. */
  sources: z.number().int(),
  /** Entries in the `ready` state (the "indexed" count). */
  ready: z.number().int(),
});
export type AiagStats = z.infer<typeof aiagStatsSchema>;

export const listAiagAssistantsResponseSchema = pageResponseSchema(aiagAssistantSchema).extend({
  stats: aiagStatsSchema,
});
export type ListAiagAssistantsResponse = z.infer<typeof listAiagAssistantsResponseSchema>;

/** `GET /ai-training/assistants/picker`: the active assistants a picker offers, by name, with their ready entry counts. */
export const aiagPickerItemSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  aiProvider: z.string(),
  aiModel: z.string(),
  /** Ready entries the assistant would answer from (its own plus workspace-wide ones), as the flow picker counts them. */
  sources: z.number().int(),
});
export type AiagPickerItem = z.infer<typeof aiagPickerItemSchema>;
export const aiagPickerResponseSchema = z.object({ data: z.array(aiagPickerItemSchema) });
export type AiagPickerResponse = z.infer<typeof aiagPickerResponseSchema>;
