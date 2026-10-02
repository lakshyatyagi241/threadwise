import { z } from 'zod';
import { uuidSchema } from '../common/ids';

export const TRANSLATION_PROVIDER_SLUGS = [
  'mymemory',
  'google_gtx',
  'libretranslate',
  'deepl',
  'google_cloud',
] as const;
export const translationProviderSlugSchema = z.enum(TRANSLATION_PROVIDER_SLUGS);
export type TranslationProviderSlug = z.infer<typeof translationProviderSlugSchema>;

/** Providers that send customer text to an unofficial or uncontracted endpoint; the lockdown removes them (TW-I18N-018). */
export const UNOFFICIAL_PROVIDER_SLUGS: readonly TranslationProviderSlug[] = [
  'google_gtx',
  'mymemory',
  'libretranslate',
];

export const dataResidencySchema = z.enum(['any', 'eu_only', 'local']);
export type DataResidency = z.infer<typeof dataResidencySchema>;

/**
 * Where a provider may receive text under a workspace's data-residency mode (TW-I18N-020). `any` has no entry:
 * it is no restriction.
 */
export const RESIDENCY_ALLOWED_PROVIDERS: Readonly<
  Record<'eu_only' | 'local', readonly TranslationProviderSlug[]>
> = {
  eu_only: ['deepl', 'libretranslate'],
  local: ['libretranslate'],
};

/** One input of a provider's credential form. The server builds it from the driver, the screen only renders it. */
export const credentialFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'password']),
  required: z.boolean(),
  hint: z.string().nullable(),
  placeholder: z.string().nullable(),
  /** Never set for a password field: secrets are not sent back. */
  value: z.string().nullable(),
  hasValue: z.boolean(),
});
export type CredentialField = z.infer<typeof credentialFieldSchema>;

export const translationProviderItemSchema = z.object({
  id: uuidSchema,
  slug: translationProviderSlugSchema,
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  isDefault: z.boolean(),
  sortOrder: z.number().int(),
  official: z.boolean(),
  /** True when the lockdown is on and this provider is one it removes. */
  skippedByLockdown: z.boolean(),
  credentialFields: z.array(credentialFieldSchema),
  rowVersion: z.number().int(),
});
export type TranslationProviderItem = z.infer<typeof translationProviderItemSchema>;

export const translationProviderListResponseSchema = z.object({
  data: z.array(translationProviderItemSchema),
  lockdown: z.object({ enabled: z.boolean() }),
});
export type TranslationProviderListResponse = z.infer<typeof translationProviderListResponseSchema>;

/**
 * TW-I18N-015. A blank or missing credential keeps the stored value; `clear` names keys to remove (Reference had no way
 * to drop a stored credential).
 */
export const updateTranslationProviderRequestSchema = z.object({
  credentials: z.record(z.string().trim().max(1024)).optional(),
  clear: z.array(z.string().max(64)).max(10).optional(),
  sortOrder: z.number().int().min(0).max(32767).optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateTranslationProviderRequest = z.infer<
  typeof updateTranslationProviderRequestSchema
>;

export const providerVersionRequestSchema = z.object({
  rowVersion: z.number().int().positive(),
});
export type ProviderVersionRequest = z.infer<typeof providerVersionRequestSchema>;

export const lockdownRequestSchema = z.object({ enabled: z.boolean() });
export type LockdownRequest = z.infer<typeof lockdownRequestSchema>;

/** Estimated price per provider, in millionths of a US dollar per input character (TW-I18N-029). */
export const PROVIDER_COST_MICROS_PER_CHAR: Readonly<Record<TranslationProviderSlug, number>> = {
  deepl: 20,
  google_cloud: 20,
  mymemory: 0,
  libretranslate: 0,
  google_gtx: 0,
};
