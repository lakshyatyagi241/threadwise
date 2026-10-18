import { WORKSPACE_VOCAB_NOUNS, isSafeNoun, type WorkspaceVocabNoun } from '@crm/contracts';

/**
 * The noun engine of "dynamic object naming" (BL-310; docs/specs/persona-profiles.md, 7.4). Given the words the product uses for a noun in
 * one language (`defaults`, from the message slice `persona-vocabulary.defaults`) and the words a workspace uses instead (`overrides`),
 * `localizeText` rewrites an already translated sentence: "Add Contact" becomes "Add Patient".
 *
 * Why a rewrite of the translated text and not an ICU placeholder in 1,450 messages: the nouns need case, gender and plural forms in
 * `ru`, `pl`, `ar`, `he`, `hi`, `tr`, and every sentence would have to be re-translated in 21 languages. This works on the wording the
 * product already has, and falls back, sentence by sentence, to that wording whenever it cannot be sure.
 *
 * Honest limits (also in docs/api/persona-vocabulary.md):
 *  - It replaces the product's exact word forms (singular and plural, as the message slice lists them). A form the language inflects
 *    differently inside a sentence (a German dative, a Russian genitive, a Finnish case) is not recognised and stays as it was.
 *  - There is no grammatical agreement: an article, adjective or verb next to the noun is not changed (English "a" / "an" is the one
 *    exception). A workspace that names a noun in Spanish, French, German... gets the word it typed, in the gender it has.
 *  - It only runs where the workspace typed a word for that language; nothing is machine-translated.
 */

export type NounKey = WorkspaceVocabNoun;
export interface NounForms {
  one: string;
  other: string;
}
export type NounDefaults = Record<NounKey, NounForms>;
export type NounOverrides = Partial<Record<NounKey, NounForms>>;

/** Languages written without spaces between words: the product's word is matched anywhere in a run of text, not only as a whole word. */
const UNSPACED = new Set(['ja', 'zh-CN', 'th', 'ko']);
/** Clitic prefixes glued to a word (Arabic "al-", "wa-", "bi-", "li-"; Hebrew "ha-", "ve-", "be-", "le-", "me-"); kept as they are. */
const PREFIXES: Record<string, string> = {
  ar: 'وال|بال|لل|ال|و|ب|ل',
  he: 'ה|ו|ב|ל|מ',
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const norm = (s: string, locale: string) => s.toLocaleLowerCase(locale);

/** The nouns of a language whose product word is also another noun's (Polish and Russian use one word for appointment and meeting). */
export function ambiguousNouns(defaults: NounDefaults, locale: string): Set<NounKey> {
  const owner = new Map<string, NounKey>();
  const bad = new Set<NounKey>();
  for (const noun of WORKSPACE_VOCAB_NOUNS) {
    const forms = new Set([norm(defaults[noun].one, locale), norm(defaults[noun].other, locale)]);
    for (const f of forms) {
      const other = owner.get(f);
      if (other && other !== noun) {
        bad.add(other);
        bad.add(noun);
      } else owner.set(f, noun);
    }
  }
  return bad;
}

/** The overrides that are safe to use: a known noun, both forms present and free of anything an ICU message would read as syntax. */
export function safeOverrides(raw: unknown): NounOverrides {
  const out: NounOverrides = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const noun of WORKSPACE_VOCAB_NOUNS) {
    const f = (raw as Record<string, unknown>)[noun];
    if (typeof f !== 'object' || f === null) continue;
    const { one, other } = f as Record<string, unknown>;
    if (
      typeof one === 'string' &&
      typeof other === 'string' &&
      isSafeNoun(one) &&
      isSafeNoun(other)
    ) {
      out[noun] = { one, other };
    }
  }
  return out;
}

/** A compiled rewrite for one language and one set of overrides. */
export interface LocalizePlan {
  locale: string;
  regex: RegExp;
  byForm: Map<string, { one: string; other: string; isPlural: boolean }>;
  english: boolean;
}

/**
 * Builds the rewrite, or `null` when there is nothing to rewrite (no override, or every overridden noun is ambiguous in this language).
 * A noun whose override equals the product's own words is skipped, so "no change" never costs a regex pass.
 */
export function buildPlan(
  locale: string,
  defaults: NounDefaults | null,
  overrides: NounOverrides,
): LocalizePlan | null {
  if (!defaults) return null;
  const skip = ambiguousNouns(defaults, locale);
  const byForm = new Map<string, { one: string; other: string; isPlural: boolean }>();
  for (const noun of WORKSPACE_VOCAB_NOUNS) {
    const own = overrides[noun];
    if (!own || skip.has(noun)) continue;
    const d = defaults[noun];
    if (!d.one || !d.other) continue;
    // A language with one word for both numbers (Japanese, Vietnamese...) is rewritten with the singular.
    if (norm(d.one, locale) === norm(d.other, locale)) {
      byForm.set(norm(d.one, locale), { ...own, isPlural: false });
    } else {
      byForm.set(norm(d.other, locale), { ...own, isPlural: true });
      byForm.set(norm(d.one, locale), { ...own, isPlural: false });
    }
  }
  if (byForm.size === 0) return null;

  // Longest first, so "Contacts" is tried before "Contact".
  const forms = [...byForm.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const word = `(${forms.join('|')})`;
  const prefix = PREFIXES[locale];
  const english = locale === 'en';
  let source: string;
  if (UNSPACED.has(locale)) {
    source = word;
  } else {
    const pre = prefix ? `(${prefix})?` : '()';
    // "a contact" / "an appointment": the article is part of the match so it can follow the new noun's first letter.
    const art = english ? '(?:\\b(an?)(\\s+))?' : '';
    source = `${art}(?<![\\p{L}\\p{M}\\p{N}])${pre}${word}(?![\\p{L}\\p{M}\\p{N}])`;
  }
  return { locale, regex: new RegExp(source, 'giu'), byForm, english };
}

/** `{name}` and `{count, plural, ...` argument names, and `<b>` / `</b>` tags: never rewritten, whatever they spell. */
const PROTECTED = /\{\s*[A-Za-z_][\w]*\s*(?=[,}])|<\/?[A-Za-z][\w-]*[^<>]*>/g;

function protectedRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const m of text.matchAll(PROTECTED)) out.push([m.index!, m.index! + m[0].length]);
  return out;
}

function adaptCase(matched: string, replacement: string, locale: string): string {
  if (!/\p{L}/u.test(matched) || replacement === '') return replacement;
  const startsUpper = (word: string): boolean => {
    const c = [...word.replace(/^[^\p{L}]+/u, '')][0];
    return (
      c !== undefined && c === c.toLocaleUpperCase(locale) && c !== c.toLocaleLowerCase(locale)
    );
  };
  const upperFirst = (text: string): string => {
    const chars = [...text];
    return chars[0]!.toLocaleUpperCase(locale) + chars.slice(1).join('');
  };
  const letters = matched.replace(/[^\p{L}]/gu, '');
  if (
    letters.length > 1 &&
    letters === letters.toLocaleUpperCase(locale) &&
    letters !== letters.toLocaleLowerCase(locale)
  ) {
    return replacement.toLocaleUpperCase(locale);
  }
  // An ordinary phrase ("Real Estate Client") may be lower-cased; an acronym or a brand ("VIP", "iPad user") is left as typed: it has a
  // capital anywhere but the first letter of a word.
  const plain = replacement
    .split(' ')
    .every((word) => !/\p{Lu}/u.test([...word].slice(1).join('')));
  const words = matched.split(/\s+/).filter(Boolean);
  if (words.every(startsUpper)) return upperFirst(replacement); // "Contact", "Contact Hub"-style title case
  if (words.length > 1 && startsUpper(words[0]!)) {
    return upperFirst(plain ? replacement.toLocaleLowerCase(locale) : replacement); // "Janji temu": a sentence
  }
  return plain ? replacement.toLocaleLowerCase(locale) : replacement; // mid-sentence
}

const VOWEL = /^[aeiou]/i;

/**
 * Rewrites one translated string. Returns the very same string when nothing matches. ICU argument names and rich-text tags are left
 * alone; `placeholdersIntact` is the caller's check that the result still has exactly the arguments the original had.
 */
export function localizeText(text: string, plan: LocalizePlan | null): string {
  if (!plan || text === '') return text;
  const skip = protectedRanges(text);
  const inProtected = (from: number, to: number) => skip.some(([a, b]) => from < b && to > a);
  plan.regex.lastIndex = 0;
  return text.replace(plan.regex, (...args: unknown[]) => {
    const groups = args.slice(1, -2) as Array<string | undefined>;
    const offset = args.at(-2) as number;
    const whole = args[0] as string;
    if (inProtected(offset, offset + whole.length)) return whole;
    // English: (article)(space)(clitic-less)(word); others: (clitic)(word); unspaced: (word)
    let article: string | undefined;
    let space = '';
    let pre = '';
    let form: string;
    if (plan.english) {
      [article, space = '', pre = '', form = ''] = groups as [string?, string?, string?, string?];
    } else if (UNSPACED.has(plan.locale)) {
      form = groups[0] ?? '';
    } else {
      [pre = '', form = ''] = groups as [string?, string?];
    }
    const hit = plan.byForm.get(norm(form, plan.locale));
    if (!hit) return whole;
    const adapted = adaptCase(form, hit.isPlural ? hit.other : hit.one, plan.locale);
    let lead = '';
    if (article !== undefined) {
      const wanted = VOWEL.test(adapted) ? 'an' : 'a';
      const cased =
        article[0] === article[0]!.toUpperCase()
          ? wanted[0]!.toUpperCase() + wanted.slice(1)
          : wanted;
      lead = cased + space;
    }
    return lead + pre + adapted;
  });
}

/** The ICU argument names of a message, as a sorted list: a rewrite must not add, drop or change one. */
export function argumentNames(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\{\s*([A-Za-z_][\w]*)\s*(?=[,}])/g)) out.push(m[1]!);
  for (const m of text.matchAll(/<\/?([A-Za-z][\w-]*)[^<>]*>/g)) out.push(`<${m[1]}>`);
  return out.sort();
}

export function placeholdersIntact(before: string, after: string): boolean {
  const a = argumentNames(before);
  const b = argumentNames(after);
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) return false;
  const depth = (s: string) => (s.match(/\{/g)?.length ?? 0) - (s.match(/\}/g)?.length ?? 0);
  return depth(after) === depth(before);
}
