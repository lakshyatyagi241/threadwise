import { FOLLOW_PHONE, schemeOf, THEME_OF_MODE } from './appearance';

describe('schemeOf', () => {
  it('forces dark for the dark theme and light for bright', () => {
    expect(schemeOf('dark')).toBe('dark');
    expect(schemeOf('bright')).toBe('light');
  });

  it('follows the phone for "paper" (what every account starts with) and while the session loads', () => {
    expect(schemeOf('paper')).toBe(FOLLOW_PHONE);
    expect(schemeOf(undefined)).toBe(FOLLOW_PHONE);
  });

  it('saves Light as bright and Dark as dark, and reads them back the same way', () => {
    expect(THEME_OF_MODE).toEqual({ light: 'bright', dark: 'dark' });
    expect(schemeOf(THEME_OF_MODE.light)).toBe('light');
    expect(schemeOf(THEME_OF_MODE.dark)).toBe('dark');
  });
});
