import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Sample {
  id: string;
  label: string;
  text: string;
}

const file = resolve(__dirname, '../../../../../tools/quality/unicode-fixtures.json');
const all = JSON.parse(readFileSync(file, 'utf8')) as { valid: Sample[]; hostile: Sample[] };

/** Text people really type: emoji, accents in two forms, right-to-left scripts, joiners, four-byte letters. */
export const VALID: Sample[] = all.valid;
/** Text that must be refused cleanly (a 4xx) or kept as typed; it must never become a 500. */
export const HOSTILE: Sample[] = all.hostile;

export const byId = (id: string): Sample => {
  const s = [...VALID, ...HOSTILE].find((x) => x.id === id);
  if (!s) throw new Error(`no unicode fixture ${id}`);
  return s;
};
