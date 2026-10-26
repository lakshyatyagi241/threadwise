import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Tree = { [key: string]: string | Tree };

const read = (locale: string, file: string): Tree =>
  JSON.parse(readFileSync(join(process.cwd(), 'messages', locale, file), 'utf8')) as Tree;

/** Deep merge: the domain's messages live in several files under the same top-level key, as the loader merges them. */
function merge(a: Tree, b: Tree): Tree {
  const out: Tree = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    out[k] = typeof v === 'object' && typeof cur === 'object' ? merge(cur, v) : v;
  }
  return out;
}

/** This domain's messages (all its files) plus the segments' own (the contact condition builder is theirs), as the loader would merge them. */
export function readAllMessages(locale: string): Tree {
  return [
    read(locale, 'team-inbox-routing-sla.json'),
    read(locale, 'team-inbox-routing-sla.assignment.json'),
    read(locale, 'team-inbox-routing-sla.handoff.json'),
    read(locale, 'segments.json'),
    read(locale, 'contacts-attributes-tags.json'),
  ].reduce(merge, {});
}
