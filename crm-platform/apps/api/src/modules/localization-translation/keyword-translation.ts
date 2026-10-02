import { detectScriptLanguage } from './language-detector';

/**
 * Pure rules for multilingual auto-reply (WD-I18N-032, 034). Nothing here touches a database or a provider:
 * `keyword-translation.service.ts` composes these with the translator and a rule store.
 */

/**
 * Every language a keyword is translated into when the workspace has not chosen its own list (WaDesk's
 * `DEFAULT_TARGETS`, 111 codes). It contains codes some providers do not accept (`zh-tw`, `jw`, `ceb`, `hmn`, `haw`);
 * those targets simply fail and are left out of the map, as in WaDesk.
 */
export const DEFAULT_TARGETS: readonly string[] = [
  // Indic
  'hi',
  'bn',
  'ur',
  'pa',
  'gu',
  'mr',
  'or',
  'ne',
  'si',
  'as',
  'sd',
  'sa',
  // Iranian
  'fa',
  'ps',
  'tg',
  'ku',
  // Dravidian
  'ta',
  'te',
  'kn',
  'ml',
  // East Asian
  'zh',
  'zh-tw',
  'ja',
  'ko',
  'mn',
  // South-East Asian
  'vi',
  'th',
  'lo',
  'km',
  'my',
  'id',
  'ms',
  'tl',
  'jw',
  'su',
  'ceb',
  // Semitic and Middle East
  'ar',
  'he',
  'am',
  'ti',
  'so',
  'mt',
  // Turkic
  'tr',
  'az',
  'kk',
  'ky',
  'uz',
  'tt',
  'tk',
  // Romance
  'es',
  'pt',
  'fr',
  'it',
  'ro',
  'ca',
  'gl',
  'co',
  // Germanic
  'en',
  'de',
  'nl',
  'sv',
  'no',
  'da',
  'is',
  'af',
  'fy',
  'lb',
  'yi',
  // Slavic
  'ru',
  'uk',
  'pl',
  'cs',
  'sk',
  'sr',
  'hr',
  'bs',
  'sl',
  'mk',
  'bg',
  'be',
  // Other European
  'el',
  'sq',
  'hu',
  'fi',
  'et',
  'lt',
  'lv',
  'ga',
  'gd',
  'cy',
  'eu',
  // African
  'sw',
  'ha',
  'yo',
  'ig',
  'zu',
  'xh',
  'st',
  'sn',
  'ny',
  'mg',
  'sm',
  // Caucasus
  'ka',
  'hy',
  // Misc
  'eo',
  'la',
  'ht',
  'haw',
  'mi',
  'hmn',
  'ug',
];

/**
 * Parses `workspace_settings.auto_translate_languages`, stored as text: a JSON array, or (hand-edited) a comma list.
 * Null for anything that yields no code, so the caller falls back to the default list.
 */
export function parseTargetList(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    list = raw.split(',');
  }
  if (!Array.isArray(list)) return null;
  const codes = list.map((c) => String(c).trim().toLowerCase()).filter(Boolean);
  return codes.length > 0 ? [...new Set(codes)] : null;
}

/** The workspace's own list when it has one (unique, order kept), else the default list. */
export function targetsFor(raw: string | null | undefined): string[] {
  return parseTargetList(raw) ?? [...DEFAULT_TARGETS];
}

export type TranslationMap = Record<string, string>;

/** A keyword or a reply text with its canonical form first, then every language that translated. */
export function withCanonical(
  text: string,
  from: string,
  translated: Readonly<Record<string, string>>,
): TranslationMap {
  const clean = text.trim();
  return clean === '' ? {} : { [from]: clean, ...translated };
}

export interface TranslatedKeyword {
  keywordTranslations: TranslationMap | null;
  matchingMethod: string;
}

/**
 * Stage 1.5a of the inbound lookup: the code of the first stored language whose keyword equals the message
 * (case-insensitive, trimmed), or, when the rule matches by `contains`, is found inside it.
 */
export function matchesTranslation(rule: TranslatedKeyword, message: string): string | null {
  const map = rule.keywordTranslations;
  if (!map) return null;
  const needle = message.trim().toLowerCase();
  const contains = rule.matchingMethod === 'contains';
  for (const [lang, value] of Object.entries(map)) {
    const v = String(value).trim().toLowerCase();
    if (v === '') continue;
    if (v === needle || (contains && needle.includes(v))) return lang;
  }
  return null;
}

/**
 * Which language a fired reply is logged and answered in: the language that matched when one did (a Latin-script
 * "hola" matched through its Spanish form), otherwise the script detector with the workspace language as the fallback.
 */
export function replyLanguage(
  matchedLanguage: string | null,
  message: string,
  workspaceDefault: string | null,
): string {
  return matchedLanguage ?? detectScriptLanguage(message, workspaceDefault || 'en');
}
