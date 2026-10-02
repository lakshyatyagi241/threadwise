import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { settings } from './settings';
import { flatten, readMessages } from './lib/test-support';

const DOMAIN = join(__dirname);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}

describe('workspaces-teams-tenancy messages', () => {
  const en = flatten(readMessages('en')).sort();

  it('Arabic has exactly the keys English has', () => {
    expect(flatten(readMessages('ar')).sort()).toEqual(en);
  });

  it('labels both Settings tiles in English and Arabic', () => {
    for (const locale of ['en', 'ar']) {
      const keys = new Set(flatten(readMessages(locale)));
      for (const item of settings)
        expect(keys.has(item.labelKey), `${locale} ${item.id}`).toBe(true);
    }
  });

  it('has no key that no code asks for', () => {
    const code = [
      ...sources(DOMAIN),
      ...sources(join(__dirname, '..', '..', 'app', '(app)', '(workspaces-teams-tenancy)')),
      ...sources(join(__dirname, '..', '..', 'app', '(auth)', 'accept-invite')),
    ]
      .map((p) => readFileSync(p, 'utf8'))
      .join('\n');
    // Keys are built from a namespace plus a leaf, or from a template (`roleOptions.${tier}`): a leaf or a prefix is enough.
    const dead = en.filter((key) => {
      const parts = key.split('.');
      const leaf = parts.at(-1)!;
      const parent = parts.at(-2) ?? '';
      return !(
        code.includes(`'${leaf}'`) ||
        code.includes(`.${leaf}'`) ||
        code.includes(`${parent}.\${`)
      );
    });
    expect(dead).toEqual([]);
  });
});
