import {
  CMS_KEYS,
  CMS_PAGES,
  THEME_TOKENS,
  isHexColor,
  layoutKeys,
  resolveSections,
  type CmsEntry,
  type CmsPage,
} from '@crm/contracts';

/** What a public page needs to render: published (or, in the editor preview, draft) values and the layout per page. */
export interface SiteContent {
  values: Record<string, string>;
  hidden: Record<string, string[]>;
  order: Record<string, string[]>;
  homepageEnabled: boolean;
  brandName: string;
}

export const EMPTY_CONTENT: SiteContent = {
  values: {},
  hidden: {},
  order: {},
  homepageEnabled: true,
  brandName: '',
};

/** The value of a key: what was saved, else the shipped default from the registry. */
export type Fc = (key: string) => string;

export const makeFc =
  (values: Readonly<Record<string, string>>): Fc =>
  (key) => {
    const v = values[key];
    return v !== undefined && v !== '' ? v : (CMS_KEYS.get(key)?.default ?? '');
  };

const parseList = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

/** The editor's preview: the operator's drafts win over what is published (a draft of "" means the default). */
export function contentFromEntries(
  entries: readonly CmsEntry[],
  homepageEnabled: boolean,
  brandName: string,
): SiteContent {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const pick = (key: string): string | null => {
    const e = byKey.get(key);
    return e ? (e.draft ?? e.published) : null;
  };
  const values: Record<string, string> = {};
  for (const e of entries) {
    if (e.key.includes('.__')) continue;
    const v = e.draft ?? e.published;
    if (v) values[e.key] = v;
  }
  const hidden: Record<string, string[]> = {};
  const order: Record<string, string[]> = {};
  for (const page of CMS_PAGES) {
    const k = layoutKeys(page);
    hidden[page] = parseList(pick(k.hidden));
    order[page] = parseList(pick(k.order));
  }
  return { values, hidden, order, homepageEnabled, brandName };
}

/** The slugs a page renders, in order (heroes first, hidden ones dropped). */
export const sectionsFor = (page: CmsPage, c: SiteContent): string[] =>
  resolveSections(page, c.hidden[page], c.order[page]);

/** One CSS custom property per theme token: `theme.wa.deep` becomes `--site-wa-deep`. Only valid hex colours are emitted. */
export function themeVars(values: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tok of THEME_TOKENS) {
    const v = values[`theme.${tok.key}`];
    out[`--site-${tok.key.replace('.', '-')}`] = v && isHexColor(v) ? v : tok.default;
  }
  return out;
}
