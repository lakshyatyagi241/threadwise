import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Tree = { [key: string]: string | Tree };

function isTree(v: unknown): v is Tree {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepMerge(base: Tree, over: Tree): Tree {
  const out: Tree = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] = isTree(v) && isTree(b) ? deepMerge(b, v) : v;
  }
  return out;
}

/** Every `messages/<locale>/*.json` file is one domain's slice; slices are merged, so domains never share a file. */
function readLocale(root: string, locale: string): Tree {
  const dir = join(root, locale);
  if (!existsSync(dir)) return {};
  let merged: Tree = {};
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    merged = deepMerge(merged, JSON.parse(readFileSync(join(dir, file), 'utf8')) as Tree);
  }
  return merged;
}

/**
 * How many merged locales stay in memory. `loadMessages` runs from `i18n/request.ts` on every request: measured on the repo's real
 * files, reading and merging English plus one locale blocked the Node event loop for 51 ms (English) to 152 ms (Hindi) per page render
 * (EL-B11). A merged locale is a few MB of parsed JSON, so the cache is bounded: the most recently used few are kept, which covers the
 * languages a deployment really serves, while a stream of 21 different locales cannot grow the heap of a 512 MB container.
 */
const MERGED_LOCALES_KEPT = 5;
const english = new Map<string, Tree>();
const merged = new Map<string, Tree>(); // insertion order is recency: a hit is deleted and set again

/** Production only: messages ship with a deploy, and in development an edited file must show up on the next request. */
const cacheOn = () => process.env.NODE_ENV === 'production';

/** Forgets every cached locale (tests, and anything that rewrites the message files under a running server). */
export function clearMessageCache(): void {
  english.clear();
  merged.clear();
}

/**
 * Missing keys in a translation fall back to English. In production the result is cached per (folder, locale); callers must treat it as
 * read-only (the merged tree shares its untouched branches with the English one).
 */
export function loadMessages(locale: string, root = join(process.cwd(), 'messages')): Tree {
  if (!cacheOn()) {
    const en = readLocale(root, 'en');
    return locale === 'en' ? en : deepMerge(en, readLocale(root, locale));
  }
  let en = english.get(root);
  if (!en) {
    en = readLocale(root, 'en');
    english.set(root, en);
  }
  if (locale === 'en') return en;
  const key = `${root}\0${locale}`;
  const hit = merged.get(key);
  if (hit) {
    merged.delete(key);
    merged.set(key, hit);
    return hit;
  }
  const tree = deepMerge(en, readLocale(root, locale));
  merged.set(key, tree);
  while (merged.size > MERGED_LOCALES_KEPT) merged.delete(merged.keys().next().value as string);
  return tree;
}
