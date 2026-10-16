import { usesShapedScript, LOCALES, matchLocale } from './locales';

describe('matchLocale', () => {
  it('accepts supported tags as they are', () => {
    expect(matchLocale('en')).toBe('en');
    expect(matchLocale('hi')).toBe('hi');
    expect(matchLocale('mr')).toBe('mr');
  });

  it('reduces regional tags to the language, with a dash or an underscore', () => {
    expect(matchLocale('hi-IN')).toBe('hi');
    expect(matchLocale('mr_IN')).toBe('mr');
    expect(matchLocale('en-GB')).toBe('en');
  });

  it('accepts every language the web app has, with or without a region', () => {
    expect(matchLocale('de-DE')).toBe('de');
    expect(matchLocale('es-MX')).toBe('es');
    expect(matchLocale('pt_BR')).toBe('pt');
    expect(matchLocale('ar-EG')).toBe('ar');
    expect(matchLocale('ur-PK')).toBe('ur');
  });

  it("maps Chinese in any script, and the older codes Android used, to the app's files", () => {
    expect(matchLocale('zh-CN')).toBe('zh-CN');
    expect(matchLocale('zh-Hans-CN')).toBe('zh-CN');
    expect(matchLocale('zh-TW')).toBe('zh-CN');
    expect(matchLocale('iw-IL')).toBe('he');
    expect(matchLocale('in')).toBe('id');
  });

  it('returns null for languages the app is not translated into, and for empty input', () => {
    expect(matchLocale('ta-IN')).toBeNull();
    expect(matchLocale('sv-SE')).toBeNull();
    expect(matchLocale('')).toBeNull();
    expect(matchLocale(undefined)).toBeNull();
  });

  it("lists the web app's 21 languages and Marathi", () => {
    expect(LOCALES).toHaveLength(22);
    expect(LOCALES).toContain('mr');
    for (const web of [
      'en',
      'es',
      'hi',
      'ar',
      'pt',
      'ru',
      'ja',
      'de',
      'fr',
      'it',
      'ko',
      'zh-CN',
      'tr',
      'id',
      'vi',
      'th',
      'pl',
      'nl',
      'ur',
      'he',
      'bn',
    ])
      expect(LOCALES).toContain(web);
  });
});

describe('usesShapedScript', () => {
  it('is false for English and for a phone that has not said', () => {
    expect(usesShapedScript('en')).toBe(false);
    expect(usesShapedScript('en-GB')).toBe(false);
    expect(usesShapedScript(undefined)).toBe(false);
    expect(usesShapedScript(null)).toBe(false);
  });

  it('is true for Hindi and Marathi', () => {
    expect(usesShapedScript('hi')).toBe(true);
    expect(usesShapedScript('mr')).toBe(true);
    expect(usesShapedScript('hi-IN')).toBe(true);
  });

  it('is true for every language written in a script Inter does not have', () => {
    for (const language of ['bn', 'ar', 'ur', 'he', 'th', 'ja', 'ko', 'zh-CN'])
      expect(usesShapedScript(language)).toBe(true);
  });

  it('is false for the Latin and Cyrillic languages, which keep Inter', () => {
    for (const language of ['es', 'pt', 'ru', 'de', 'fr', 'it', 'tr', 'id', 'vi', 'pl', 'nl'])
      expect(usesShapedScript(language)).toBe(false);
  });
});
