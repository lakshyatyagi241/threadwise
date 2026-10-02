import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Tree = { [key: string]: string | Tree };

/** One locale's messages file of this domain, as the loader would merge it. */
export function readMessages(locale: string): Tree {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'messages', locale, 'workspaces-teams-tenancy.json'), 'utf8'),
  ) as Tree;
}

export function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`),
  );
}
