import { CONSENT_SETTINGS_DEFAULTS, type ConsentSettings } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  formFromSettings,
  formProblems,
  isLangCode,
  parseWords,
  settingsDirty,
  toSettingsInput,
  withFooter,
} from './model';

const settings = (over: Partial<ConsentSettings> = {}): ConsentSettings => ({
  ...CONSENT_SETTINGS_DEFAULTS,
  rowVersion: 3,
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

describe('parseWords', () => {
  it('splits on lines and commas, trims, drops blanks and repeats', () => {
    expect(parseWords(' STOP\nstop, Quit ,\n\n OPT OUT ')).toEqual(['STOP', 'Quit', 'OPT OUT']);
  });
});

describe('form <-> settings', () => {
  it('round-trips the defaults, English first', () => {
    const f = formFromSettings(settings());
    expect(f.langs.map((l) => l.lang)).toEqual(['en', 'ar']);
    const input = toSettingsInput(f, 3);
    expect(input.optOutKeywords).toEqual(CONSENT_SETTINGS_DEFAULTS.optOutKeywords);
    expect(input.optInReply).toEqual(CONSENT_SETTINGS_DEFAULTS.optInReply);
    expect(input.footerText).toEqual(CONSENT_SETTINGS_DEFAULTS.footerText);
    expect(input.rowVersion).toBe(3);
    expect(settingsDirty(f, formFromSettings(settings()))).toBe(false);
  });

  it('leaves a language out of a map where nothing is typed, and sends no version on the first save', () => {
    const f = formFromSettings(settings({ rowVersion: null }));
    f.langs = f.langs.map((l) => (l.lang === 'ar' ? { ...l, optIn: '', footer: '' } : l));
    const input = toSettingsInput(f, null);
    expect(Object.keys(input.optInKeywords)).toEqual(['en']);
    expect(Object.keys(input.footerText)).toEqual(['en']);
    expect(input.rowVersion).toBeUndefined();
    expect(settingsDirty(f, formFromSettings(settings()))).toBe(true);
  });
});

describe('formProblems', () => {
  it('flags a missing STOP word while detection is on, and a bad or repeated language code', () => {
    const f = formFromSettings(settings());
    expect(formProblems(f)).toEqual([]);
    expect(formProblems({ ...f, langs: f.langs.map((l) => ({ ...l, optOut: '' })) })).toEqual([
      'noOptOutWord',
    ]);
    expect(
      formProblems({
        ...f,
        detectionEnabled: false,
        langs: f.langs.map((l) => ({ ...l, optOut: '' })),
      }),
    ).toEqual([]);
    expect(formProblems({ ...f, langs: [...f.langs, { ...f.langs[0]!, lang: 'EN!' }] })).toContain(
      'badLang',
    );
    expect(formProblems({ ...f, langs: [...f.langs, { ...f.langs[0]! }] })).toContain('dupLang');
  });
  it('accepts language codes like en, ar, pt-BR', () => {
    expect(['en', 'ar', 'pt-BR', 'zh-CN'].every(isLangCode)).toBe(true);
    expect(['', 'e', 'english', 'EN'].some(isLangCode)).toBe(false);
  });
});

describe('withFooter', () => {
  it('puts the line under the text only when asked', () => {
    expect(withFooter('Sale', 'Reply STOP to unsubscribe', true)).toBe(
      'Sale\n\nReply STOP to unsubscribe',
    );
    expect(withFooter('Sale', 'Reply STOP', false)).toBe('Sale');
    expect(withFooter('Sale', '  ', true)).toBe('Sale');
  });
});
