import { LOCALES, matchLocale } from './locales';

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

  it('returns null for languages the app is not translated into, and for empty input', () => {
    expect(matchLocale('de-DE')).toBeNull();
    expect(matchLocale('ta-IN')).toBeNull();
    expect(matchLocale('')).toBeNull();
    expect(matchLocale(undefined)).toBeNull();
  });

  it('lists English, Hindi and Marathi', () => {
    expect([...LOCALES]).toEqual(['en', 'hi', 'mr']);
  });
});
