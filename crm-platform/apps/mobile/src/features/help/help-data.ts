import docsJson from './help-docs.json';

/** The groups the Help screen shows, in order (the cards, like the Geta app's Getting Started, Account and Settings). */
export const HELP_CATEGORIES = [
  'getting-started',
  'dashboard',
  'inbox',
  'contacts',
  'settings',
  'account',
  'troubleshooting',
] as const;
export type HelpCategory = (typeof HELP_CATEGORIES)[number];

export type HelpInline =
  | { t: 'text' | 'bold' | 'code'; v: string }
  | { t: 'link'; v: string; href: string }
  | { t: 'doc'; v: string; doc: string };

export type HelpBlock =
  | { t: 'h'; level: 2 | 3; id: string; text: string }
  | { t: 'p'; inline: HelpInline[] }
  | { t: 'ul' | 'ol'; items: HelpInline[][] }
  | { t: 'note'; inline: HelpInline[] };

export interface HelpText {
  title: string;
  summary: string;
  blocks: HelpBlock[];
}

/** One guide of the web Help center, copied into the app by `scripts/gen-help-content.mjs`. English always exists. */
export interface HelpDoc {
  id: string;
  category: HelpCategory;
  order: number;
  keywords: string[];
  text: { en: HelpText } & Partial<Record<string, HelpText>>;
}

const DOCS = docsJson as unknown as readonly HelpDoc[];

/** The guides of one group, in the order the web Help center lists them. */
export function docsIn(category: HelpCategory): readonly HelpDoc[] {
  return DOCS.filter((doc) => doc.category === category).sort((a, b) => a.order - b.order);
}

export function findDoc(id: string | undefined): HelpDoc | undefined {
  return DOCS.find((doc) => doc.id === id);
}

/** The guide in the person's language when it has been translated, else in English (`fallback` says so). */
export function textOf(doc: HelpDoc, language: string): { text: HelpText; fallback: boolean } {
  const own = doc.text[language] ?? doc.text[language.split('-')[0] ?? ''];
  if (own) return { text: own, fallback: false };
  return { text: doc.text.en, fallback: language.split('-')[0] !== 'en' };
}

/**
 * Guides whose title, summary or keywords hold every word typed (any case), the ones with the words in the title first. Looks in
 * English too, so a guide that was not translated can still be found by the English word.
 */
export function searchDocs(query: string, language: string): HelpDoc[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored: { doc: HelpDoc; inTitle: boolean }[] = [];
  for (const doc of DOCS) {
    const shown = textOf(doc, language).text;
    const title = `${shown.title} ${doc.text.en.title}`.toLowerCase();
    const rest = `${shown.summary} ${doc.text.en.summary} ${doc.keywords.join(' ')}`.toLowerCase();
    if (words.every((word) => title.includes(word) || rest.includes(word))) {
      scored.push({ doc, inTitle: words.every((word) => title.includes(word)) });
    }
  }
  return scored.sort((a, b) => Number(b.inTitle) - Number(a.inTitle)).map((entry) => entry.doc);
}
