import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** For tests only: the flattened English and Arabic invoicing messages (`invoicing.<screen>.<key>` -> text). */
const WEB = resolve(__dirname, '../../..');
type Tree = { [key: string]: string | Tree };
const isTree = (v: unknown): v is Tree => typeof v === 'object' && v !== null;
const merge = (a: Tree, b: Tree): Tree => {
  const out: Tree = { ...a };
  for (const [k, v] of Object.entries(b))
    out[k] = isTree(v) && isTree(out[k]) ? merge(out[k] as Tree, v) : v;
  return out;
};
function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}
const load = (locale: string): Record<string, string> =>
  flatten(
    readdirSync(join(WEB, 'messages', locale))
      .filter((f) => f === 'invoicing.json' || /^invoicing\..+\.json$/.test(f))
      .sort()
      .reduce<Tree>(
        (acc, f) =>
          merge(acc, JSON.parse(readFileSync(join(WEB, 'messages', locale, f), 'utf8')) as Tree),
        {},
      ),
  );

export const en = load('en');
export const ar = load('ar');

/** Keys (relative to the `invoicing` root) that a screen builds at run time and that are missing from `messages`, English or Arabic. */
export const missingKeys = (relative: readonly string[]): string[] =>
  relative.flatMap((k) => [`invoicing.${k}`].filter((full) => !(full in en) || !(full in ar)));
