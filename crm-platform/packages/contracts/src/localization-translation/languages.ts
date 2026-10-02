import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { localeCodeSchema, textDirectionSchema } from './locale';

/** One row of the platform language registry as the operator sees it (TW-I18N-001). */
export const languageItemSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  name: z.string(),
  nativeName: z.string().nullable(),
  direction: textDirectionSchema,
  isActive: z.boolean(),
  isDefault: z.boolean(),
  sortOrder: z.number().int(),
  rowVersion: z.number().int(),
});
export type LanguageItem = z.infer<typeof languageItemSchema>;

/** The registry is a fixed, small catalogue (about 21 rows): it is returned whole, not paged. */
export const languageListResponseSchema = z.object({
  data: z.array(languageItemSchema),
  stats: z.object({
    total: z.number().int(),
    active: z.number().int(),
    defaultCode: z.string(),
  }),
});
export type LanguageListResponse = z.infer<typeof languageListResponseSchema>;

/** TW-I18N-002. `isActive` is explicit: Reference deactivated a language when the field was simply left out. */
export const updateLanguageRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  nativeName: z.string().trim().max(80).nullable(),
  direction: textDirectionSchema,
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(32767),
  rowVersion: z.number().int().positive(),
});
export type UpdateLanguageRequest = z.infer<typeof updateLanguageRequestSchema>;

/** Toggle, set-default and delete carry the version the operator saw, so a stale page cannot act on a newer state. */
export const languageVersionRequestSchema = z.object({
  rowVersion: z.number().int().positive(),
});
export type LanguageVersionRequest = z.infer<typeof languageVersionRequestSchema>;

/** The public face of an active language: what a language switcher needs. */
export const activeLanguageSchema = z.object({
  code: z.string(),
  name: z.string(),
  nativeName: z.string().nullable(),
  direction: textDirectionSchema,
});
export type ActiveLanguage = z.infer<typeof activeLanguageSchema>;

/** GET /v2/i18n/languages (public). */
export const activeLanguagesResponseSchema = z.object({
  data: z.array(activeLanguageSchema),
  defaultLocale: z.string(),
});
export type ActiveLanguagesResponse = z.infer<typeof activeLanguagesResponseSchema>;

/** PATCH /v2/me/locale (TW-I18N-009). */
export const setMyLocaleRequestSchema = z.object({ code: localeCodeSchema });
export type SetMyLocaleRequest = z.infer<typeof setMyLocaleRequestSchema>;

export const setMyLocaleResponseSchema = z.object({
  ok: z.literal(true),
  locale: z.string(),
  direction: textDirectionSchema,
});
export type SetMyLocaleResponse = z.infer<typeof setMyLocaleResponseSchema>;

/** GET /v2/me/locale: the inputs the web app feeds into `resolveLocale` for a signed-in user. */
export const myLocaleResponseSchema = z.object({
  userLocale: z.string().nullable(),
  workspaceDefault: z.string().nullable(),
});
export type MyLocaleResponse = z.infer<typeof myLocaleResponseSchema>;
