import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCALES, dirOf, isLocale } from './locales';
import { loadMessages } from './messages';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'msgs-'));
  mkdirSync(join(root, 'en'));
  mkdirSync(join(root, 'ar'));
  writeFileSync(join(root, 'en', 'a.json'), JSON.stringify({ a: { one: 'One', two: 'Two' } }));
  writeFileSync(join(root, 'en', 'b.json'), JSON.stringify({ b: { x: 'X' } }));
  writeFileSync(join(root, 'ar', 'a.json'), JSON.stringify({ a: { one: 'واحد' } }));
  return root;
}

describe('loadMessages', () => {
  it('merges one slice per domain file', () => {
    expect(loadMessages('en', fixture())).toEqual({ a: { one: 'One', two: 'Two' }, b: { x: 'X' } });
  });

  it('falls back to English for keys a translation lacks', () => {
    const m = loadMessages('ar', fixture());
    expect(m).toEqual({ a: { one: 'واحد', two: 'Two' }, b: { x: 'X' } });
  });

  it('returns English for a locale with no files at all', () => {
    expect(loadMessages('fr', fixture())).toEqual(loadMessages('en', fixture()));
  });
});

describe('locales', () => {
  it('ships the 21 WaDesk languages', () => expect(LOCALES).toHaveLength(21));
  it('marks Arabic, Hebrew and Urdu right-to-left only', () => {
    expect(LOCALES.filter((l) => dirOf(l) === 'rtl').sort()).toEqual(['ar', 'he', 'ur']);
  });
  it('rejects unknown locales', () => expect(isLocale('xx')).toBe(false));
});
