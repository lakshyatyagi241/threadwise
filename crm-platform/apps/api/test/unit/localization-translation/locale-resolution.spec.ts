import { describe, expect, it } from 'vitest';
import { directionOf, resolveLocale, type ActiveLocale } from '@crm/contracts';

const active: ActiveLocale[] = [
  { code: 'en', direction: 'ltr' },
  { code: 'es', direction: 'ltr' },
  { code: 'fr', direction: 'ltr' },
  { code: 'ar', direction: 'rtl' },
  { code: 'ur', direction: 'rtl' },
];

/** WD-I18N-008, 011 */
describe('resolveLocale', () => {
  it('prefers the user choice over everything', () => {
    expect(
      resolveLocale({
        userLocale: 'fr',
        cookieLocale: 'es',
        workspaceDefault: 'ar',
        platformDefault: 'en',
        active,
      }),
    ).toBe('fr');
  });

  it('falls to the cookie pick, then the workspace default, then the platform default', () => {
    expect(
      resolveLocale({ cookieLocale: 'es', workspaceDefault: 'ar', platformDefault: 'en', active }),
    ).toBe('es');
    expect(resolveLocale({ workspaceDefault: 'ar', platformDefault: 'fr', active })).toBe('ar');
    expect(resolveLocale({ platformDefault: 'fr', active })).toBe('fr');
  });

  it('skips a stored choice that is no longer active', () => {
    expect(resolveLocale({ userLocale: 'de', cookieLocale: 'es', active })).toBe('es');
    expect(
      resolveLocale({ userLocale: 'de', workspaceDefault: 'ja', platformDefault: 'fr', active }),
    ).toBe('fr');
  });

  it('never lands on an inactive platform default: first active language, else en', () => {
    expect(resolveLocale({ platformDefault: 'de', active })).toBe('en');
    expect(
      resolveLocale({ platformDefault: 'de', active: [{ code: 'fr', direction: 'ltr' }] }),
    ).toBe('fr');
    expect(resolveLocale({ platformDefault: 'de', active: [] })).toBe('en');
  });

  it('is case sensitive like the registry (zh-CN, not zh-cn)', () => {
    const zh: ActiveLocale[] = [{ code: 'zh-CN', direction: 'ltr' }, ...active];
    expect(resolveLocale({ cookieLocale: 'zh-CN', platformDefault: 'fr', active: zh })).toBe(
      'zh-CN',
    );
    expect(resolveLocale({ cookieLocale: 'zh-cn', platformDefault: 'fr', active: zh })).toBe('fr');
  });

  it('answers a guest with no cookie from the platform default', () => {
    expect(resolveLocale({ platformDefault: 'es', active })).toBe('es');
  });
});

describe('directionOf', () => {
  it('is rtl for ur and ar, ltr for en', () => {
    expect(directionOf('ur', active)).toBe('rtl');
    expect(directionOf('ar', active)).toBe('rtl');
    expect(directionOf('en', active)).toBe('ltr');
  });
  it('is ltr for an unknown or deactivated code', () => {
    expect(directionOf('he', active)).toBe('ltr');
  });
});
