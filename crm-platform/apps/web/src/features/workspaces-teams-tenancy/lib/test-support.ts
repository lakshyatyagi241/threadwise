import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deepMerge } from '@/i18n/messages';

type Tree = { [key: string]: string | Tree };

/** One locale's messages of this domain, as the loader would merge them: the main file and the handoff settings slice (BL-396). */
export function readMessages(locale: string): Tree {
  const read = (file: string): Tree =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', locale, file), 'utf8')) as Tree;
  const slice = 'workspaces-teams-tenancy.handoff.json';
  const main = read('workspaces-teams-tenancy.json');
  return existsSync(join(process.cwd(), 'messages', locale, slice))
    ? deepMerge(main, read(slice))
    : main;
}

export function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`),
  );
}
