import { describe, expect, it } from 'vitest';
import { completeLocales, messageKeys } from './auth-locales-core';

describe('messageKeys', () => {
  it('lists dotted leaf paths, sorted', () => {
    expect(messageKeys({ b: { y: 'x', x: 'x' }, a: 'x' })).toEqual(['a', 'b.x', 'b.y']);
  });
});

describe('completeLocales', () => {
  const english = ['a', 'b.c'];
  const files: Record<string, string[] | null> = {
    ar: ['a', 'b.c', 'extra'],
    de: ['a'],
    fr: null,
    es: ['b.c', 'a'],
  };
  const order = ['en', 'es', 'ar', 'de', 'fr'];

  it('keeps English, and every locale that has all English keys, in the given order', () => {
    expect(completeLocales(order, english, (l) => files[l] ?? null)).toEqual(['en', 'es', 'ar']);
  });

  it('drops a locale with a missing key and one with no file', () => {
    const out = completeLocales(order, english, (l) => files[l] ?? null);
    expect(out).not.toContain('de');
    expect(out).not.toContain('fr');
  });

  it('offers English even when its own keys cannot be read', () => {
    expect(completeLocales(['en'], [], () => null)).toEqual(['en']);
  });
});

describe('the real message files', () => {
  it('offer the guest picker exactly the languages whose auth messages are complete', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { LOCALES } = await import('@/i18n/locales');
    const keysOf = (locale: string) => {
      try {
        const file = join(process.cwd(), 'messages', locale, 'auth-registration-security.json');
        return messageKeys(JSON.parse(readFileSync(file, 'utf8')));
      } catch {
        return null;
      }
    };
    const english = keysOf('en')!;
    const offered = completeLocales(LOCALES, english, keysOf);
    // Every shipped language now has the full auth message set, so the picker offers all of them.
    expect(offered).toEqual([...LOCALES]);
  });
});
