import { FOLLOW_PHONE, modeOf, schemeOf, THEME_OF_MODE } from './appearance';

describe('schemeOf', () => {
  it('forces dark for the dark theme and light for bright', () => {
    expect(schemeOf('dark')).toBe('dark');
    expect(schemeOf('bright')).toBe('light');
  });

  it('follows the phone for "paper" (what every account starts with) and while the session loads', () => {
    expect(schemeOf('paper')).toBe(FOLLOW_PHONE);
    expect(schemeOf(undefined)).toBe(FOLLOW_PHONE);
  });

  it('saves Light as bright, Dark as dark and Use device settings as paper, and reads them back the same way', () => {
    expect(THEME_OF_MODE).toEqual({ light: 'bright', dark: 'dark', device: 'paper' });
    expect(schemeOf(THEME_OF_MODE.light)).toBe('light');
    expect(schemeOf(THEME_OF_MODE.dark)).toBe('dark');
    expect(schemeOf(THEME_OF_MODE.device)).toBe(FOLLOW_PHONE);
    for (const mode of ['light', 'dark', 'device'] as const) {
      expect(modeOf(THEME_OF_MODE[mode])).toBe(mode);
    }
  });
});

describe('modeOf', () => {
  it('ticks Use device settings for a new account and while the session loads', () => {
    expect(modeOf('paper')).toBe('device');
    expect(modeOf(undefined)).toBe('device');
  });
});
