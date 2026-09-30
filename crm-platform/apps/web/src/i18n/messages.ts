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

/** Missing keys in a translation fall back to English. */
export function loadMessages(locale: string, root = join(process.cwd(), 'messages')): Tree {
  const en = readLocale(root, 'en');
  return locale === 'en' ? en : deepMerge(en, readLocale(root, locale));
}
