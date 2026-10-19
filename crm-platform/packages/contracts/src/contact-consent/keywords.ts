/**
 * The STOP / START matching rule (spec docs/specs/contact-consent-ledger.md section 4). Pure, so the API listener, the settings
 * "test a message" box and the unit tests all run the same code.
 *
 * The WHOLE message must equal a keyword after normalisation. A long message is never a keyword: "don't stop" and "stop sending me
 * invoices please" do nothing.
 */

/** A text longer than this (after normalising) is never a keyword. */
export const CONSENT_KEYWORD_MAX_TEXT = 64;

const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u00AD]/gu;
const ARABIC_MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/gu;
const ALEF_VARIANTS = /[\u0622\u0623\u0625\u0671]/gu;
const INNER = /[^\p{L}\p{N}]+/gu;

/** Normal form used on both the keyword and the message. */
export function normaliseConsentText(input: string): string {
  return input
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(ARABIC_MARKS, '')
    .replace(ALEF_VARIANTS, 'ا')
    .toLowerCase()
    .replace(INNER, ' ')
    .trim();
}

export type ConsentKeywordAction = 'opt_out' | 'opt_in';

export interface ConsentKeywordSets {
  optOut: Record<string, string[]>;
  optIn: Record<string, string[]>;
}

/** Compiled lookup: normalised keyword to the language it came from. */
export interface CompiledKeywords {
  optOut: Map<string, string>;
  optIn: Map<string, string>;
}

export function compileConsentKeywords(sets: ConsentKeywordSets): CompiledKeywords {
  const build = (m: Record<string, string[]>): Map<string, string> => {
    const out = new Map<string, string>();
    // English first so a word shared by languages answers in English.
    const langs = Object.keys(m).sort((a, b) =>
      a === 'en' ? -1 : b === 'en' ? 1 : a.localeCompare(b),
    );
    for (const lang of langs) {
      for (const w of m[lang] ?? []) {
        const n = normaliseConsentText(w);
        if (n !== '' && !out.has(n)) out.set(n, lang);
      }
    }
    return out;
  };
  return { optOut: build(sets.optOut), optIn: build(sets.optIn) };
}

export interface ConsentKeywordMatch {
  action: ConsentKeywordAction;
  /** The normalised keyword that matched (what the ledger stores, never the customer's text). */
  keyword: string;
  lang: string;
}

/** Opt-out wins when a word is in both lists. */
export function matchConsentKeyword(
  text: string | null | undefined,
  compiled: CompiledKeywords,
): ConsentKeywordMatch | null {
  if (!text || text.length > 400) return null;
  // A line starting with ">" is a quote (email style), not what the sender typed.
  if (text.trimStart().startsWith('>')) return null;
  const n = normaliseConsentText(text);
  if (n === '' || n.length > CONSENT_KEYWORD_MAX_TEXT) return null;
  const out = compiled.optOut.get(n);
  if (out !== undefined) return { action: 'opt_out', keyword: n, lang: out };
  const inn = compiled.optIn.get(n);
  if (inn !== undefined) return { action: 'opt_in', keyword: n, lang: inn };
  return null;
}

/** A reply text with `{{name}}` filled with the first name; a missing name leaves no hole. */
export function fillConsentReply(template: string, vars: { name?: string | null }): string {
  const first = (vars.name ?? '').trim().split(/\s+/)[0] ?? '';
  return template
    .replace(/\{\{\s*name\s*\}\}/gi, first)
    .replace(/[ \t]+([,.!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** The text of `map[lang]`, else English, else the first value. */
export function pickByLang(map: Record<string, string>, lang: string | null | undefined): string {
  return (lang ? map[lang] : undefined) ?? map.en ?? Object.values(map)[0] ?? '';
}

const INSTRUCTION = [
  /\b(reply|send|text|type|respond)\s+["'“”]?\s*(stop|unsubscribe|end|quit|cancel)\b/i,
  /(ارسل|أرسل|رد)\s+["'“”]?\s*(إيقاف|ايقاف|توقف)/u,
];

/** Does a message already tell the reader how to opt out? */
export function hasOptOutInstruction(body: string, footers: string[] = []): boolean {
  const lower = body.toLowerCase();
  if (footers.some((f) => f.trim() !== '' && lower.includes(f.trim().toLowerCase()))) return true;
  return INSTRUCTION.some((re) => re.test(body));
}

/** Add the opt-out line under a marketing text, once. */
export function appendOptOutLine(body: string, line: string, allLines: string[] = []): string {
  const l = line.trim();
  if (l === '' || hasOptOutInstruction(body, [l, ...allLines])) return body;
  return `${body.trimEnd()}\n\n${l}`;
}
