import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deepMerge } from '@/i18n/messages';

type Tree = { [key: string]: string | Tree };

/** One locale's messages of this domain, as the loader would merge them: the main file and its slices (handoff settings BL-396, the status bar). */
export function readMessages(locale: string): Tree {
  const read = (file: string): Tree =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', locale, file), 'utf8')) as Tree;
  const slices = ['workspaces-teams-tenancy.handoff.json', 'workspaces-teams-tenancy.status.json'];
  return slices
    .filter((slice) => existsSync(join(process.cwd(), 'messages', locale, slice)))
    .reduce((acc, slice) => deepMerge(acc, read(slice)), read('workspaces-teams-tenancy.json'));
}

export function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`),
  );
}
