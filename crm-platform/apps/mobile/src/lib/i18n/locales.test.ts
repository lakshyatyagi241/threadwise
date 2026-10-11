import { LOCALES, matchLocale } from './locales';

describe('matchLocale', () => {
  it('accepts supported tags as they are', () => {
    expect(matchLocale('zh-CN')).toBe('zh-CN');
    expect(matchLocale('ar')).toBe('ar');
  });

  it('reduces regional tags to the language', () => {
    expect(matchLocale('pt-BR')).toBe('pt');
    expect(matchLocale('es_MX')).toBe('es');
    expect(matchLocale('en-GB')).toBe('en');
  });

  it('maps every Chinese variant to zh-CN and the legacy Hebrew code to he', () => {
    expect(matchLocale('zh-Hans-CN')).toBe('zh-CN');
    expect(matchLocale('zh-TW')).toBe('zh-CN');
    expect(matchLocale('iw')).toBe('he');
  });

  it('returns null for unsupported or empty input', () => {
    expect(matchLocale('sw')).toBeNull();
    expect(matchLocale('')).toBeNull();
    expect(matchLocale(undefined)).toBeNull();
  });

  it('lists the 21 locales of the web app', () => {
    expect(LOCALES).toHaveLength(21);
  });
});
