/**
 * WD-I18N-012/013: the string-catalog tooling. WaDesk's `translatable:export` and `translatable:inspect-translations`
 * scanned the source for `__('...')` and compared it with `lang/<code>.json`. Here catalogs are
 * `messages/<locale>/<domain>.json` with dotted keys and next-intl, so the same two jobs are:
 *
 * - `inspectCatalog`: keys the code asks for that English lacks (missing), and English keys no code asks for (obsolete);
 * - `compareCatalog`: per language, the keys it lacks, the keys English no longer has, and the keys it left identical to
 *   English (WaDesk's "untranslated" marker), plus a coverage figure.
 *
 * Pure functions over strings and trees; `catalog-tools.test.ts` runs them over this feature's own files so a typo in a
 * key fails the build instead of showing a raw key on screen.
 */
export type Tree = { [key: string]: string | Tree };

const isTree = (v: unknown): v is Tree => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `{a:{b:'x'}}` becomes `{'a.b':'x'}`. */
export function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isTree(v)) Object.assign(out, flatten(v, key));
    else out[key] = String(v);
  }
  return out;
}

export interface CatalogReport {
  /** In English, absent here. */
  missing: string[];
  /** Here, absent from English: obsolete or misspelt. */
  extra: string[];
  /** Present but identical to English. Brand names and codes are legitimately identical, so this is informational. */
  untranslated: string[];
  /** Share of English keys that are translated, 0 to 1. */
  coverage: number;
}

export function compareCatalog(base: Tree, other: Tree): CatalogReport {
  const a = flatten(base);
  const b = flatten(other);
  const keys = Object.keys(a);
  const missing = keys.filter((k) => !(k in b));
  const extra = Object.keys(b).filter((k) => !(k in a));
  const untranslated = keys.filter((k) => k in b && b[k] === a[k]);
  const coverage =
    keys.length === 0 ? 1 : (keys.length - missing.length - untranslated.length) / keys.length;
  return { missing, extra, untranslated, coverage };
}

export interface UsedKeys {
  /** Full keys asked for with a literal. */
  keys: Set<string>;
  /** Full key prefixes asked for with a template (`steps.${n}.title` gives `ns.steps.`). */
  prefixes: Set<string>;
}

/** Text of the balanced parentheses starting just after `open`, or null when they never close. */
function balanced(src: string, open: number): string | null {
  let depth = 1;
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return src.slice(open, i);
  }
  return null;
}

/** The part of a call's arguments before the first top-level comma. */
function firstArg(args: string): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const c = args[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) return args.slice(0, i);
  }
  return args;
}

const LITERAL = /(['"`])((?:\\.|(?!\1).)*)\1/g;
const KEYISH = /^[A-Za-z][\w-]*(\.[\w-]+)*\.?$/;

/** What a source file asks `next-intl` for. Resolves `const NS = '...'` and `const t = useTranslations(NS)`. */
export function usedKeys(source: string): UsedKeys {
  const consts = new Map<string, string>();
  for (const m of source.matchAll(/\bconst\s+([A-Za-z_]\w*)\s*=\s*(['"])([^'"]*)\2/g)) {
    consts.set(m[1]!, m[3]!);
  }
  const keys = new Set<string>();
  const prefixes = new Set<string>();
  const add = (ns: string, literal: string, quote: string) => {
    if (quote === '`' && literal.includes('${')) {
      const pre = literal.slice(0, literal.indexOf('${'));
      prefixes.add(ns ? `${ns}.${pre}` : pre);
    } else if (KEYISH.test(literal)) keys.add(ns ? `${ns}.${literal}` : literal);
  };

  // `const t = useTranslations(NS)`: variable name to namespace.
  const translators = new Map<string, string>();
  for (const m of source.matchAll(
    /\b(?:const|let)\s+([A-Za-z_]\w*)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(/g,
  )) {
    const args = balanced(source, m.index! + m[0].length);
    if (args === null) continue;
    const arg = firstArg(args).trim();
    const lit = /^(['"`])([^'"`]*)\1$/.exec(arg);
    translators.set(m[1]!, lit ? lit[2]! : arg === '' ? '' : (consts.get(arg) ?? ''));
  }

  for (const [name, ns] of translators) {
    const call = new RegExp(String.raw`(?<![\w.])${name}(?:\.rich|\.raw|\.has|\.markup)?\(`, 'g');
    for (const m of source.matchAll(call)) {
      const args = balanced(source, m.index! + m[0].length);
      if (args === null) continue;
      for (const lit of firstArg(args).matchAll(LITERAL)) add(ns, lit[2]!, lit[1]!);
    }
  }
  return { keys, prefixes };
}

export interface InspectReport {
  /** Asked for in code, not in English: the screen would show a raw key. */
  missing: string[];
  /** In English, asked for nowhere: dead copy. */
  obsolete: string[];
}

/**
 * `namespace` limits the obsolete check to one domain's keys. Full-key literals in any source count as a use, which is
 * how navigation entries (`labelKey: 'x.nav.y'`) are found.
 */
export function inspectCatalog(
  en: Tree,
  sources: readonly string[],
  namespace: string,
  /** Key prefixes chosen at run time from a lookup table (error codes): a bare literal equal to the last segment counts. */
  viaLiteral: readonly string[] = [],
): InspectReport {
  const flat = flatten(en);
  const used: UsedKeys = { keys: new Set(), prefixes: new Set() };
  const literals = new Set<string>();
  for (const src of sources) {
    const u = usedKeys(src);
    u.keys.forEach((k) => used.keys.add(k));
    u.prefixes.forEach((p) => used.prefixes.add(p));
    for (const m of src.matchAll(LITERAL)) literals.add(m[2]!);
  }
  const mine = (k: string) => k.startsWith(`${namespace}.`);
  const missing = [...used.keys].filter((k) => mine(k) && !(k in flat)).sort();
  const covered = (k: string) =>
    used.keys.has(k) ||
    literals.has(k) ||
    [...used.prefixes].some((p) => k.startsWith(p)) ||
    (viaLiteral.some((p) => k.startsWith(p)) && literals.has(k.slice(k.lastIndexOf('.') + 1)));
  const obsolete = Object.keys(flat)
    .filter((k) => mine(k) && !covered(k))
    .sort();
  return { missing, obsolete };
}
