import { z } from 'zod';
import { TEAM_LANGUAGE_CODES, teamLanguageSchema } from './locale';
import { dataResidencySchema } from './providers';

/** GET /v2/workspace/translation-settings: the Account > Translation tab (TW-I18N-035). */
export const translationSettingsSchema = z.object({
  /** The plan includes real-time translation (`access_translation`). When false the screen shows the upgrade prompt. */
  planAllows: z.boolean(),
  /** Auto-translate conversations. */
  enabled: z.boolean(),
  /** The language the team works in. */
  teamLanguage: z.string(),
  teamLanguageOptions: z.array(teamLanguageSchema).default([...TEAM_LANGUAGE_CODES]),
  /** Name of the provider a translation would try first (display only). */
  engineName: z.string().nullable(),
  residency: dataResidencySchema,
  usageThisMonth: z.object({ characters: z.number().int(), calls: z.number().int() }),
  /** 0 when the workspace has no settings row yet. */
  rowVersion: z.number().int(),
});
export type TranslationSettings = z.infer<typeof translationSettingsSchema>;

export const updateTranslationSettingsRequestSchema = z.object({
  teamLanguage: teamLanguageSchema.optional(),
  enabled: z.boolean().optional(),
  rowVersion: z.number().int().min(0),
});
export type UpdateTranslationSettingsRequest = z.infer<
  typeof updateTranslationSettingsRequestSchema
>;
