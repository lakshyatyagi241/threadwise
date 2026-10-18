import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCALES, dirOf, isLocale } from './locales';
import { clearMessageCache, loadMessages } from './messages';

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

describe('loadMessages cache (EL-B11)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    clearMessageCache();
  });

  const write = (root: string, locale: string, text: string) => {
    mkdirSync(join(root, locale), { recursive: true });
    writeFileSync(join(root, locale, 'a.json'), JSON.stringify({ a: { one: text } }));
  };

  it('reads the files again on every call outside production, so an edit shows at once', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const root = fixture();
    expect(loadMessages('en', root)).not.toBe(loadMessages('en', root));
    write(root, 'en', 'Changed');
    expect(loadMessages('en', root)).toMatchObject({ a: { one: 'Changed' } });
  });

  it('in production returns the same tree without touching the disk again', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const root = fixture();
    const en = loadMessages('en', root);
    const ar = loadMessages('ar', root);
    write(root, 'en', 'Changed');
    write(root, 'ar', 'تغيير');
    expect(loadMessages('en', root)).toBe(en);
    expect(loadMessages('ar', root)).toBe(ar);
    expect(ar).toEqual({ a: { one: 'واحد', two: 'Two' }, b: { x: 'X' } });
  });

  it('the cached result equals the uncached one for every locale', () => {
    const root = fixture();
    vi.stubEnv('NODE_ENV', 'development');
    const fresh = ['en', 'ar', 'fr'].map((l) => loadMessages(l, root));
    vi.stubEnv('NODE_ENV', 'production');
    expect(['en', 'ar', 'fr'].map((l) => loadMessages(l, root))).toEqual(fresh);
  });

  it('keeps only the most recently used five merged locales, and English always', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const root = fixture();
    const names = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'];
    for (const n of names) write(root, n, n);
    const first = loadMessages('l1', root);
    for (const n of names.slice(1)) loadMessages(n, root);
    write(root, 'l1', 'edited'); // l1 was evicted by the sixth locale: it is read again
    const again = loadMessages('l1', root);
    expect(again).not.toBe(first);
    expect(again).toMatchObject({ a: { one: 'edited' } });
    const l6 = loadMessages('l6', root);
    write(root, 'l6', 'edited');
    expect(loadMessages('l6', root)).toBe(l6); // still cached
  });
});

describe('locales', () => {
  it('ships the 21 Reference languages', () => expect(LOCALES).toHaveLength(21));
  it('marks Arabic, Hebrew and Urdu right-to-left only', () => {
    expect(LOCALES.filter((l) => dirOf(l) === 'rtl').sort()).toEqual(['ar', 'he', 'ur']);
  });
  it('rejects unknown locales', () => expect(isLocale('xx')).toBe(false));
});
