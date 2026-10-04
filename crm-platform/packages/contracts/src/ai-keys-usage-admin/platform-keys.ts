import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { AI_TEXT_EXTRA_KEYS, aiProviderSlugSchema } from './catalog';

/**
 * The platform's own AI keys (WD-AIADM-001..004, 009), edited by operators. The secret is write-only:
 * no response ever carries it, only whether one is saved and its last four characters.
 */

export const platformAiKeyItemSchema = z.object({
  id: uuidSchema,
  provider: aiProviderSlugSchema,
  name: z.string(),
  group: z.enum(['llm', 'voice']),
  isActive: z.boolean(),
  /** A key is saved AND readable. A stored value that no longer decrypts counts as no key. */
  hasKey: z.boolean(),
  /** A value is stored but cannot be read (the encryption key changed): paste it again. */
  keyUnreadable: z.boolean(),
  keyLast4: z.string().nullable(),
  defaultModel: z.string().nullable(),
  sortOrder: z.number().int(),
  /** Ceiling on output tokens per request; null = none. Only on providers that carry the field. */
  maxTokens: z.number().int().nullable(),
  supportsMaxTokens: z.boolean(),
  /** Hint under the key field, in WaDesk's words. */
  keyHint: z.string(),
  /** The optional text field some cards carry (Organization ID, Project ID, Default voice ID); null on the rest. */
  textExtra: z
    .object({
      key: z.enum(AI_TEXT_EXTRA_KEYS),
      label: z.string(),
      hint: z.string(),
      value: z.string(),
    })
    .nullable(),
  /** Extra model ids offered next to the default in the pickers. */
  extraModels: z.array(z.string()),
  modelChoices: z.array(z.string()),
  rowVersion: z.number().int(),
  updatedAt: z.string(),
});
export type PlatformAiKeyItem = z.infer<typeof platformAiKeyItemSchema>;

export const platformAiKeysResponseSchema = z.object({
  data: z.array(platformAiKeyItemSchema),
  summary: z.object({
    providers: z.number().int(),
    active: z.number().int(),
    /** Active and holding a readable key. */
    ready: z.number().int(),
    noKey: z.number().int(),
  }),
});
export type PlatformAiKeysResponse = z.infer<typeof platformAiKeysResponseSchema>;

const modelId = z.string().trim().min(1).max(80);

export const updatePlatformAiKeySchema = z
  .object({
    rowVersion: z.number().int().min(1),
    /** Blank or absent keeps the saved key; a value replaces it. */
    apiKey: z.string().max(1024).optional(),
    /** Explicitly remove the saved key (WaDesk had no way to); the provider is switched off with it. */
    removeKey: z.boolean().optional(),
    defaultModel: modelId.nullable().optional(),
    sortOrder: z.number().int().min(0).max(32767).optional(),
    /** Positive whole number, or null to clear the ceiling. */
    maxTokens: z.number().int().min(1).max(10_000_000).nullable().optional(),
    extraModels: z.array(modelId).max(40).optional(),
    /** The card's optional text field; blank clears it. Ignored on providers without one. */
    textExtra: z.string().trim().max(200).optional(),
  })
  .refine((v) => !(v.removeKey && v.apiKey?.trim()), {
    message: 'Send either a new key or removeKey, not both.',
    path: ['removeKey'],
  });
export type UpdatePlatformAiKeyInput = z.infer<typeof updatePlatformAiKeySchema>;

export const setAiKeyActiveSchema = z.object({ isActive: z.boolean() });
export type SetAiKeyActiveInput = z.infer<typeof setAiKeyActiveSchema>;
