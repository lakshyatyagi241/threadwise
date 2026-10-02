import { z } from 'zod';

/**
 * Locale rules shared by the API and the web app (WD-I18N-008, 011).
 *
 * `resolveLocale` is a pure function so the same precedence runs in the API
 * (when it answers "what language is this caller in") and in the Next.js
 * request config (which only has a cookie and what the API told it).
 */

export const TEXT_DIRECTIONS = ['ltr', 'rtl'] as const;
export const textDirectionSchema = z.enum(TEXT_DIRECTIONS);
export type TextDirection = z.infer<typeof textDirectionSchema>;

/** Case-sensitive BCP-47 style code; `zh-CN` keeps its region casing. */
export const localeCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(12)
  .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/, 'not a locale code');

/**
 * Languages a workspace may pick as its team language (WD-I18N-035). Base codes: translation providers understand
 * `zh`, not `zh-CN`.
 */
export const TEAM_LANGUAGE_CODES = [
  'en',
  'es',
  'pt',
  'fr',
  'de',
  'it',
  'ar',
  'hi',
  'zh',
  'id',
  'ms',
  'ru',
  'tr',
  'ja',
  'ko',
  'th',
  'vi',
  'nl',
  'bn',
  'ur',
  'ta',
  'tl',
] as const;
export type TeamLanguageCode = (typeof TEAM_LANGUAGE_CODES)[number];
export const teamLanguageSchema = z.enum(TEAM_LANGUAGE_CODES);

export interface ActiveLocale {
  code: string;
  direction: TextDirection;
}

export interface LocaleInputs {
  /** The signed-in user's saved choice (user_profiles.locale). */
  userLocale?: string | null;
  /** The cookie pick: the only choice a guest has. */
  cookieLocale?: string | null;
  /** The signed-in user's workspace default (workspace_settings.default_language). */
  workspaceDefault?: string | null;
  /** The platform default language. */
  platformDefault?: string | null;
  /** Active registry rows; only these may be chosen. */
  active: readonly ActiveLocale[];
}

export const FALLBACK_LOCALE = 'en';

/**
 * user choice, then cookie pick, then workspace default, then platform default, then English.
 *
 * Every step must name an ACTIVE language. WaDesk skipped that check for the platform default, which left the app in
 * a locale with no catalogue after the default was deactivated or deleted; here an unusable default falls through to
 * the first active language (and to `en` when the registry is empty).
 */
export function resolveLocale(input: LocaleInputs): string {
  const isActive = (code: string | null | undefined): code is string =>
    !!code && input.active.some((a) => a.code === code);

  for (const candidate of [
    input.userLocale,
    input.cookieLocale,
    input.workspaceDefault,
    input.platformDefault,
  ]) {
    if (isActive(candidate)) return candidate;
  }
  return input.active[0]?.code ?? FALLBACK_LOCALE;
}

/** `ltr` for an unknown or inactive code, as WaDesk did. */
export function directionOf(code: string, active: readonly ActiveLocale[]): TextDirection {
  return active.find((a) => a.code === code)?.direction ?? 'ltr';
}
