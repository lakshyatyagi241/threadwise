import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOUND_PREFIXES, BOUND_SURFACES, NOT_YET_BOUND } from './bindings';

const doc = readFileSync(
  join(process.cwd(), '..', '..', 'docs', 'api', 'persona-vocabulary.md'),
  'utf8',
);

describe('docs/api/persona-vocabulary.md stays in step with the bindings', () => {
  it('names every bound surface and its first prefix', () => {
    for (const surface of BOUND_SURFACES) {
      expect(doc, `surface ${surface.id}`).toContain(`| ${surface.id} `);
      expect(doc, `prefix ${surface.prefixes[0]}`).toContain(`\`${surface.prefixes[0]}\``);
    }
  });

  it('lists every prefix the code binds, in full or in the short form the table uses after the first prefix of a group', () => {
    for (const prefix of BOUND_PREFIXES) {
      const short = prefix.split('.').slice(1).join('.');
      expect(doc.includes(`\`${prefix}\``) || doc.includes(`\`.${short}\``), prefix).toBe(true);
    }
  });

  it('lists every surface that is not bound yet, word for word', () => {
    for (const line of NOT_YET_BOUND) expect(doc, line).toContain(`- ${line}`);
  });
});
