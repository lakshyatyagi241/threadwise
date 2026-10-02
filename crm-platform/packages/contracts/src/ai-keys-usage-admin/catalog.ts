import { z } from 'zod';

/**
 * The provider catalogue (TW-AIADM-001, 002, 005): which AI vendors a key can be stored for, which
 * model ids are offered for each, and which optional setting a card carries. A constant shared by
 * the API (validation, seeding, model pickers) and the web (the admin cards, the agent pickers) so
 * they cannot drift. Model ids are identifiers: re-verify them against the vendors before relying on
 * one, and an admin may store any id (the API does not check a stored model against this list).
 *
 * Order here is the display order: language-model brands first, voice vendors last.
 */

export const AI_PROVIDER_GROUPS = ['llm', 'voice'] as const;
export type AiProviderGroup = (typeof AI_PROVIDER_GROUPS)[number];

export interface AiProviderDef {
  slug: string;
  /** Brand name, shown as is (a proper noun, not translated). */
  name: string;
  group: AiProviderGroup;
  /** Whether the card carries the "max tokens per request" ceiling (TW-AIADM-009). */
  maxTokensField: boolean;
  /** Newest first, legacy last. */
  models: readonly string[];
  /** What a freshly seeded row starts with; null = the admin picks one. */
  seedModel: string | null;
}

const llm = (
  slug: string,
  name: string,
  models: readonly string[],
  extra: Partial<Pick<AiProviderDef, 'maxTokensField' | 'seedModel'>> = {},
): AiProviderDef => ({
  slug,
  name,
  group: 'llm',
  maxTokensField: false,
  seedModel: null,
  models,
  ...extra,
});

export const AI_PROVIDERS = [
  llm(
    'openai',
    'OpenAI',
    [
      'gpt-5.6',
      'gpt-5.6-pro',
      'gpt-5.6-mini',
      'gpt-5.5',
      'gpt-5.5-pro',
      'gpt-5.4',
      'gpt-5.4-pro',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5-mini',
      'gpt-5-nano',
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4o',
      'gpt-4o-mini',
    ],
    { maxTokensField: true, seedModel: 'gpt-5.4-mini' },
  ),
  llm(
    'anthropic',
    'Anthropic',
    [
      'claude-opus-5',
      'claude-fable-5',
      'claude-sonnet-5',
      'claude-haiku-4-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-sonnet-4-6',
    ],
    { maxTokensField: true, seedModel: 'claude-opus-4-8' },
  ),
  llm(
    'gemini',
    'Google Gemini',
    [
      'gemini-3.5-flash',
      'gemini-3.1-pro-preview',
      'gemini-3.1-flash-lite',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ],
    { maxTokensField: true, seedModel: 'gemini-3.5-flash' },
  ),
  llm(
    'mistral',
    'Mistral',
    [
      'mistral-large-latest',
      'mistral-medium-latest',
      'mistral-small-latest',
      'codestral-latest',
      'ministral-3-14b-25-12',
      'ministral-3-8b-25-12',
      'devstral-2-25-12',
      'magistral-medium-1-2-25-09',
    ],
    { maxTokensField: true, seedModel: 'mistral-large-latest' },
  ),
  llm(
    'openrouter',
    'OpenRouter',
    [
      'anthropic/claude-opus-5',
      'anthropic/claude-sonnet-5',
      'anthropic/claude-haiku-4.5',
      'openai/gpt-5.6',
      'openai/gpt-5.6-mini',
      'openai/gpt-5.5',
      'openai/gpt-4.1',
      'openai/gpt-4o-mini',
      'google/gemini-3.5-flash',
      'google/gemini-2.5-pro',
      'google/gemini-2.5-flash',
      'meta-llama/llama-4-maverick',
      'meta-llama/llama-3.3-70b-instruct',
      'deepseek/deepseek-chat',
      'deepseek/deepseek-r1',
      'qwen/qwen-2.5-72b-instruct',
      'mistralai/mistral-large',
      'mistralai/mistral-small',
      'x-ai/grok-4',
      'z-ai/glm-4.6',
    ],
    { maxTokensField: true },
  ),
  llm('deepseek', 'DeepSeek', ['deepseek-chat', 'deepseek-reasoner']),
  llm('xai', 'xAI (Grok)', ['grok-4', 'grok-4-fast', 'grok-3']),
  llm('perplexity', 'Perplexity', ['sonar-pro', 'sonar', 'sonar-reasoning-pro']),
  llm('groq', 'Groq', [
    'llama-3.3-70b-versatile',
    'llama-4-maverick-17b-128e-instruct',
    'moonshotai/kimi-k2-instruct',
  ]),
  llm('qwen', 'Alibaba Qwen', ['qwen-max', 'qwen-plus', 'qwen-turbo']),
  llm('moonshot', 'Moonshot (Kimi)', [
    'kimi-k2-0905-preview',
    'moonshot-v1-128k',
    'moonshot-v1-32k',
  ]),
  llm('zai', 'Z.ai (GLM)', ['glm-4.6', 'glm-4.5', 'glm-4.5-air']),
  llm('cohere', 'Cohere', ['command-a-03-2025', 'command-r-plus', 'command-r']),
  llm('nvidia', 'NVIDIA', ['meta/llama-3.3-70b-instruct', 'deepseek-ai/deepseek-r1']),
  llm('llama', 'Meta Llama', ['Llama-4-Maverick-17B-128E-Instruct-FP8', 'Llama-3.3-70B-Instruct']),
  llm('huggingface', 'Hugging Face', [
    'meta-llama/Llama-3.3-70B-Instruct',
    'deepseek-ai/DeepSeek-V3',
  ]),
  llm('baidu', 'Baidu (Ernie)', ['ernie-4.5-turbo-128k', 'ernie-4.5-8k']),
  llm('ai21', 'AI21 (Jamba)', ['jamba-large', 'jamba-mini']),
  llm('reka', 'Reka', ['reka-core', 'reka-flash']),
  llm('yi', '01.AI (Yi)', ['yi-lightning', 'yi-large']),
  {
    slug: 'elevenlabs',
    name: 'ElevenLabs',
    group: 'voice',
    maxTokensField: false,
    models: ['eleven_v3', 'eleven_multilingual_v2', 'eleven_turbo_v2_5', 'eleven_flash_v2_5'],
    seedModel: 'eleven_v3',
  },
  {
    slug: 'deepgram',
    name: 'Deepgram',
    group: 'voice',
    maxTokensField: false,
    models: ['nova-3', 'nova-2'],
    seedModel: 'nova-2',
  },
] as const satisfies readonly AiProviderDef[];

export type AiProviderSlug = (typeof AI_PROVIDERS)[number]['slug'];
export const AI_PROVIDER_SLUGS = AI_PROVIDERS.map((p) => p.slug) as AiProviderSlug[];

export const aiProviderSlugSchema = z.enum(
  AI_PROVIDER_SLUGS as [AiProviderSlug, ...AiProviderSlug[]],
);

/** The catalogue entry for a slug (trimmed and lower-cased first, as the resolver does), or undefined. */
export function findAiProvider(slug: string): AiProviderDef | undefined {
  const s = slug.trim().toLowerCase();
  return AI_PROVIDERS.find((p) => p.slug === s);
}

/** The time windows of the usage screens (TW-AIADM-020, 025). */
export const AI_USAGE_WINDOWS = ['7d', '30d', '90d', '1y'] as const;
export type AiUsageWindow = (typeof AI_USAGE_WINDOWS)[number];
export const AI_USAGE_WINDOW_DAYS: Record<AiUsageWindow, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
};
export const aiUsageWindowSchema = z.enum(AI_USAGE_WINDOWS).default('30d');

/** Which side pays for a call's tokens (the ledger's `billed_against`, or `none` when no key resolves). */
export const AI_KEY_SOURCES = ['workspace', 'admin', 'none'] as const;
export type AiKeySource = (typeof AI_KEY_SOURCES)[number];
