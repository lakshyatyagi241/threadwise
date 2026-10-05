/**
 * Which interface languages can show the guest pages in full. The guest picker offers only those: a language
 * with a partial translation would mix its own words with English fallbacks on the very first screen a person
 * sees. English is the source and is always offered.
 */

type Tree = { [key: string]: string | Tree };

/** Dotted paths of every message in a tree, sorted. */
export function messageKeys(tree: Tree, prefix = ''): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.push(path);
    else out.push(...messageKeys(value, path));
  }
  return out.sort();
}

/**
 * The locales (in `order`) whose message keys include every English key. A locale with no file, or an unreadable
 * one (`null`), is left out.
 */
export function completeLocales(
  order: readonly string[],
  englishKeys: readonly string[],
  keysOf: (locale: string) => readonly string[] | null,
  source = 'en',
): string[] {
  return order.filter((locale) => {
    if (locale === source) return true;
    const keys = keysOf(locale);
    if (!keys) return false;
    const have = new Set(keys);
    return englishKeys.every((k) => have.has(k));
  });
}
