/**
 * Script-based language detection (TW-I18N-031): free, offline and instant, the first pass before any paid call.
 *
 * It classifies by Unicode block, so it can tell Korean from Hindi but never Spanish from French. For Latin-script
 * text the caller supplies a fallback (the workspace language) or asks a provider to detect.
 *
 * Fixes over Reference, each deliberate:
 *   - any kana makes the text Japanese (Reference counted characters, so a sentence with more kanji than kana became
 *     Chinese);
 *   - Arabic-script text containing letters only Urdu uses is `ur` (Reference could never return the `ur` that the UI
 *     language pack includes);
 *   - Cyrillic text with Ukrainian-only letters is `uk`.
 */

type Range = readonly [number, number];
interface Script {
  lang: string;
  ranges: readonly Range[];
}

// Checked in this order; the first matching block wins.
const SCRIPTS: readonly Script[] = [
  {
    lang: 'ko',
    ranges: [
      [0xac00, 0xd7af],
      [0x1100, 0x11ff],
      [0x3130, 0x318f],
    ],
  },
  {
    lang: 'ja',
    ranges: [
      [0x3040, 0x309f],
      [0x30a0, 0x30ff],
    ],
  },
  { lang: 'hi', ranges: [[0x0900, 0x097f]] },
  { lang: 'bn', ranges: [[0x0980, 0x09ff]] },
  { lang: 'pa', ranges: [[0x0a00, 0x0a7f]] },
  { lang: 'gu', ranges: [[0x0a80, 0x0aff]] },
  { lang: 'or', ranges: [[0x0b00, 0x0b7f]] },
  { lang: 'ta', ranges: [[0x0b80, 0x0bff]] },
  { lang: 'te', ranges: [[0x0c00, 0x0c7f]] },
  { lang: 'kn', ranges: [[0x0c80, 0x0cff]] },
  { lang: 'ml', ranges: [[0x0d00, 0x0d7f]] },
  { lang: 'si', ranges: [[0x0d80, 0x0dff]] },
  {
    lang: 'ar',
    ranges: [
      [0x0600, 0x06ff],
      [0x0750, 0x077f],
      [0xfb50, 0xfdff],
      [0xfe70, 0xfeff],
    ],
  },
  { lang: 'he', ranges: [[0x0590, 0x05ff]] },
  { lang: 'ar', ranges: [[0x0700, 0x074f]] }, // Syriac, folded to Arabic as Reference did
  { lang: 'th', ranges: [[0x0e00, 0x0e7f]] },
  { lang: 'lo', ranges: [[0x0e80, 0x0eff]] },
  { lang: 'my', ranges: [[0x1000, 0x109f]] },
  { lang: 'km', ranges: [[0x1780, 0x17ff]] },
  { lang: 'su', ranges: [[0x1a00, 0x1a1f]] },
  {
    lang: 'ru',
    ranges: [
      [0x0400, 0x04ff],
      [0x0500, 0x052f],
    ],
  },
  { lang: 'el', ranges: [[0x0370, 0x03ff]] },
  { lang: 'hy', ranges: [[0x0530, 0x058f]] },
  { lang: 'ka', ranges: [[0x10a0, 0x10ff]] },
  { lang: 'am', ranges: [[0x1200, 0x137f]] },
  {
    lang: 'zh',
    ranges: [
      [0x4e00, 0x9fff],
      [0x3400, 0x4dbf],
    ],
  },
];

const inRange = (cp: number, [lo, hi]: Range) => cp >= lo && cp <= hi;
// Latin, Latin-1 and Latin Extended-A/B are ignored by the tally.
const isLatinBlock = (cp: number) => cp < 0x0250;
const URDU_ONLY = /[ٹڈڑںےھہ]/;
const UKRAINIAN_ONLY = /[іїєґІЇЄҐ]/;

export function detectScriptLanguage(text: string, fallback: string | null = 'en'): string {
  const base = fallback ?? 'en';
  const trimmed = text.trim();
  if (!trimmed) return base;

  const tally = new Map<string, number>();
  for (const ch of trimmed) {
    const cp = ch.codePointAt(0)!;
    if (isLatinBlock(cp)) continue;
    const script = SCRIPTS.find((s) => s.ranges.some((r) => inRange(cp, r)));
    if (script) tally.set(script.lang, (tally.get(script.lang) ?? 0) + 1);
  }
  if (tally.size === 0) return base;

  // Kana is unique to Japanese, so any of it settles the question even when kanji outnumber it.
  if (tally.has('ja')) return 'ja';

  let best = base;
  let bestCount = 0;
  for (const [lang, count] of tally) {
    if (count > bestCount) {
      best = lang;
      bestCount = count;
    }
  }
  if (best === 'ar' && URDU_ONLY.test(trimmed)) return 'ur';
  if (best === 'ru' && UKRAINIAN_ONLY.test(trimmed)) return 'uk';
  return best;
}

/** True for empty text and for text made only of Latin letters, digits, punctuation and whitespace. */
export function isLatin(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x0250 && !/[\s\p{P}\p{S}\p{N}]/u.test(ch)) return false;
  }
  return true;
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  pl: 'Polish',
  ru: 'Russian',
  uk: 'Ukrainian',
  tr: 'Turkish',
  ar: 'Arabic',
  he: 'Hebrew',
  fa: 'Persian',
  hi: 'Hindi',
  bn: 'Bengali',
  pa: 'Punjabi',
  gu: 'Gujarati',
  or: 'Odia',
  ta: 'Tamil',
  te: 'Telugu',
  kn: 'Kannada',
  ml: 'Malayalam',
  si: 'Sinhala',
  mr: 'Marathi',
  ne: 'Nepali',
  ur: 'Urdu',
  th: 'Thai',
  lo: 'Lao',
  my: 'Burmese',
  km: 'Khmer',
  vi: 'Vietnamese',
  id: 'Indonesian',
  ms: 'Malay',
  tl: 'Filipino',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  el: 'Greek',
  hy: 'Armenian',
  ka: 'Georgian',
  am: 'Amharic',
  sw: 'Swahili',
  su: 'Sundanese',
  af: 'Afrikaans',
  cs: 'Czech',
  sk: 'Slovak',
  hu: 'Hungarian',
  ro: 'Romanian',
  bg: 'Bulgarian',
  sr: 'Serbian',
  hr: 'Croatian',
  sv: 'Swedish',
  no: 'Norwegian',
  da: 'Danish',
  fi: 'Finnish',
};

export function languageDisplayName(code: string): string {
  return LANGUAGE_NAMES[code.toLowerCase()] ?? code.toUpperCase();
}
