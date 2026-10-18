import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '@/i18n/locales';
import { SETTINGS } from '@/features/_registry/settings.generated';
import { ERROR_KEYS } from './lib/errors';
import { argumentNames } from './lib/localize';

const WEB = join(__dirname, '..', '..', '..');
type Tree = { [key: string]: string | Tree };
const load = (locale: string) =>
  (
    JSON.parse(
      readFileSync(join(WEB, 'messages', locale, 'persona-vocabulary.json'), 'utf8'),
    ) as Record<string, Tree>
  )['persona-vocabulary']!;
function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tree).flatMap(([k, v]) =>
      typeof v === 'string' ? [[`${prefix}${k}`, v]] : Object.entries(flatten(v, `${prefix}${k}.`)),
    ),
  );
}
const en = flatten(load('en'));

describe('persona-vocabulary messages', () => {
  it.each([...LOCALES])(
    '%s has exactly the keys English has, with the same arguments',
    (locale) => {
      const tr = flatten(load(locale));
      expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
      for (const [key, text] of Object.entries(tr)) {
        expect(text.trim(), `${locale} ${key}`).not.toBe('');
        expect(argumentNames(text), `${locale} ${key}`).toEqual(argumentNames(en[key]!));
      }
    },
  );

  it('has the Settings tile copy the registry asks for, in every language', () => {
    const tile = SETTINGS.find((t) => t.id === 'workspace-words');
    expect(tile, 'the tile is declared').toBeDefined();
    for (const locale of LOCALES) {
      const tr = flatten(load(locale));
      for (const key of [tile!.labelKey, tile!.descriptionKey, tile!.keywordsKey]) {
        expect(tr[key!.replace(/^persona-vocabulary\./, '')], `${locale} ${key}`).toBeTruthy();
      }
    }
  });

  it('has a message for every error the screen can show and every noun it lists', () => {
    for (const key of ERROR_KEYS) expect(en[`errors.${key}`], key).toBeTruthy();
    for (const noun of ['contact', 'appointment', 'deal', 'meeting']) {
      for (const f of ['one', 'other']) expect(en[`defaults.${noun}.${f}`], noun).toBeTruthy();
      expect(en[`nouns.${noun}.hint`], noun).toBeTruthy();
    }
  });

  it('asks for no key the English messages do not have (static t("...") calls)', () => {
    const asked = new Set<string>();
    for (const file of ['components/words-screen.tsx']) {
      const src = readFileSync(join(__dirname, file), 'utf8');
      for (const m of src.matchAll(/\bt\('([a-zA-Z.]+)'/g)) asked.add(m[1]!);
    }
    expect([...asked].filter((k) => !(k in en))).toEqual([]);
  });
});
