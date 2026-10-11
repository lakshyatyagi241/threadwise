import { z } from 'zod';
import { FAQ_LIMITS } from './entries';

/** The platform operator's control of the FAQ engine (super admins). Stored in platform_settings under `faq.config`. */

/**
 * The embedding models a platform operator can pick. Every one answers in FAQ_EMBEDDING_DIMENSIONS (3072) dimensions, the width of
 * `faq_variations.embedding`; the evaluation that picked the default is docs/threadwise-port/faq-knowledge/embedding-eval.md.
 */
export const FAQ_EMBEDDING_MODELS = [
  {
    id: 'openai/text-embedding-3-large',
    label: 'OpenAI text-embedding-3-large',
    dimensions: 3072,
    pricePerMillionTokens: 0.13,
    /** Where precision held at 97% or more on the evaluation set while still answering most paraphrases (scores run low on this model). */
    recommendedThreshold: 0.5,
    note: 'Best result in our test: the right FAQ first for every phrasing. Its scores run low, so a good threshold is around 0.5.',
  },
  {
    id: 'google/gemini-embedding-2',
    label: 'Google Gemini Embedding 2',
    dimensions: 3072,
    pricePerMillionTokens: 0.2,
    /** On this model 0.45 would answer wrongly 3 times in 10; it only separates right from wrong from about 0.7 up. */
    recommendedThreshold: 0.72,
    note: 'Close second. Its scores run high, so it needs a much higher threshold (around 0.72); the same 0.5 would give wrong answers.',
  },
] as const;
export type FaqEmbeddingModelId = (typeof FAQ_EMBEDDING_MODELS)[number]['id'];
export const FAQ_DEFAULT_EMBEDDING_MODEL: FaqEmbeddingModelId = 'openai/text-embedding-3-large';
export const FAQ_EMBEDDING_MODEL_IDS = FAQ_EMBEDDING_MODELS.map((m) => m.id) as [
  FaqEmbeddingModelId,
  ...FaqEmbeddingModelId[],
];

/** The chat model that writes variation suggestions: cheap, and any OpenRouter slug is allowed. */
export const FAQ_DEFAULT_GENERATION_MODEL = 'openai/gpt-4o-mini';

/** The threshold a model needs: scores are not comparable between models, so the default follows the model in use. */
export const faqRecommendedThreshold = (modelId: string): number =>
  FAQ_EMBEDDING_MODELS.find((m) => m.id === modelId)?.recommendedThreshold ?? 0.5;

export const FAQ_PLATFORM_DEFAULTS = {
  engineEnabled: true,
  embeddingModel: FAQ_DEFAULT_EMBEDDING_MODEL,
  generationModel: FAQ_DEFAULT_GENERATION_MODEL,
  maxFaqs: 500,
  maxVariationsPerFaq: 60,
  /** Semantic matches one workspace may run an hour; past it the matcher uses trigram only (an abuse and cost guard). */
  semanticPerHour: 600,
} as const;

export const updateFaqPlatformConfigSchema = z
  .object({
    engineEnabled: z.boolean(),
    embeddingModel: z.enum(FAQ_EMBEDDING_MODEL_IDS),
    generationModel: z
      .string()
      .trim()
      .min(3)
      .max(120)
      .regex(/^[A-Za-z0-9._:/-]+$/, 'Use an OpenRouter model id such as openai/gpt-4o-mini.'),
    /** A number fixes the default for workspaces that never saved their own; `null` makes it follow the embedding model again. */
    defaultThreshold: z
      .number()
      .min(FAQ_LIMITS.thresholdMin)
      .max(FAQ_LIMITS.thresholdMax)
      .nullable(),
    maxFaqs: z.number().int().min(1).max(20_000),
    maxVariationsPerFaq: z.number().int().min(1).max(500),
    semanticPerHour: z.number().int().min(0).max(100_000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change.' });
export type UpdateFaqPlatformConfigInput = z.infer<typeof updateFaqPlatformConfigSchema>;

export const faqPlatformWorkspacesQuerySchema = z.object({
  search: z.string().trim().max(FAQ_LIMITS.searchLength).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type FaqPlatformWorkspacesQuery = z.infer<typeof faqPlatformWorkspacesQuerySchema>;

export const faqPlatformReindexSchema = z.object({
  /** `all` re-embeds everything with the current model; `failed` retries the rows that gave up. */
  scope: z.enum(['all', 'failed']),
});
export type FaqPlatformReindexInput = z.infer<typeof faqPlatformReindexSchema>;

export interface FaqPlatformConfig {
  engineEnabled: boolean;
  embeddingModel: string;
  generationModel: string;
  /** What a workspace that never saved its own threshold uses: the operator's number, else the model's recommended one. */
  defaultThreshold: number;
  /** False while the default simply follows the embedding model (it moves when the model changes). */
  defaultThresholdCustom: boolean;
  maxFaqs: number;
  maxVariationsPerFaq: number;
  semanticPerHour: number;
  allowedModels: ReadonlyArray<{
    id: string;
    label: string;
    dimensions: number;
    pricePerMillionTokens: number;
    recommendedThreshold: number;
    note: string;
  }>;
}

export interface FaqPlatformOverview {
  config: FaqPlatformConfig;
  /** Is a platform OpenRouter key saved and active (the fallback every workspace without its own key uses). */
  platformKeyReady: boolean;
  stats: {
    workspacesEnabled: number;
    faqs: number;
    variations: number;
    ready: number;
    pending: number;
    failed: number;
    /** Variations whose vector belongs to an older model (they match nothing until re-embedded). */
    staleModel: number;
    matches30d: number;
    answered30d: number;
    embeddingTokens30d: number;
  };
}

export interface FaqPlatformWorkspace {
  workspaceId: string;
  name: string;
  enabled: boolean;
  faqs: number;
  variations: number;
  pending: number;
  failed: number;
  matches30d: number;
  answered30d: number;
}

export interface FaqPlatformWorkspacesResponse {
  data: FaqPlatformWorkspace[];
}

export interface FaqPlatformReindexResult {
  queued: number;
}
