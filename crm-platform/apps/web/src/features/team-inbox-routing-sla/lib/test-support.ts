import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Tree = { [key: string]: string | Tree };

const read = (locale: string, file: string): Tree =>
  JSON.parse(readFileSync(join(process.cwd(), 'messages', locale, file), 'utf8')) as Tree;

/** This domain's messages plus the segments' own (the contact condition builder is theirs), as the loader would merge them. */
export function readAllMessages(locale: string): Tree {
  return {
    ...read(locale, 'team-inbox-routing-sla.json'),
    ...read(locale, 'segments.json'),
    ...read(locale, 'contacts-attributes-tags.json'),
  };
}
