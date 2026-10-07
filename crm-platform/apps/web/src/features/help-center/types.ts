import type { NavGates } from '@/features/_registry/types';

/**
 * Help center data model. A doc is one markdown file in `features/<domain>/help/` (see `compile.mjs`); the generator turns
 * every file into a `HelpDoc` in `features/_registry/help.generated.ts`.
 */

/** Where a doc sits on `/help`: a menu group id, or one of the help-only areas (account, getting started, troubleshooting). */
export const HELP_AREAS = [
  'overview',
  'inbox',
  'audience',
  'sales',
  'campaigns',
  'automation',
  'store',
  'apps',
  'settings',
  'account',
  'getting-started',
  'troubleshooting',
] as const;
export type HelpArea = (typeof HELP_AREAS)[number];

export type HelpInline =
  | { t: 'text' | 'bold' | 'code'; v: string }
  | { t: 'link'; v: string; href: string }
  | { t: 'doc'; v: string; doc: string };

export type HelpBlock =
  | { t: 'h'; level: 2 | 3; id: string; text: string }
  | { t: 'p'; inline: HelpInline[] }
  | { t: 'ul' | 'ol'; items: HelpInline[][] }
  | { t: 'note'; inline: HelpInline[] };

/** One language of a doc. `en` always exists; another locale carries its own title and summary. */
export interface HelpLocaleText {
  title: string;
  summary: string;
  blocks: HelpBlock[];
}

export interface HelpDoc {
  /** Unique across the app, kebab-case; used in `/help/<id>` and `<HelpTip doc="...">`. */
  id: string;
  area: HelpArea;
  order: number;
  /** `nav:<id>` and `tile:<id>` of the screens this doc explains; empty for a guide that spans screens. */
  documents: string[];
  /** Gates in addition to what the documented screens already require. */
  gates: NavGates;
  keywords: string[];
  /** Extra page addresses whose "?" opens this doc, besides the documented screens' own. */
  routes: string[];
  audience: 'workspace' | 'operator';
  /** The `features/<domain>` folder the file lives in. */
  domain: string;
  text: Record<string, HelpLocaleText>;
}

export interface HelpHeading {
  id: string;
  text: string;
  level: 2 | 3;
}

/** What the client needs of a visible doc (no body): the tooltip, the search and the page tip read it. */
export interface HelpIndexEntry {
  id: string;
  area: HelpArea;
  order: number;
  title: string;
  summary: string;
  keywords: string[];
  routes: string[];
  headings: HelpHeading[];
  /** Whole minutes to read the guide at an ordinary pace (at least 1), from its words. */
  readMinutes: number;
  /** True when the person's language has no translation of this doc and English is shown. */
  fallback: boolean;
}
