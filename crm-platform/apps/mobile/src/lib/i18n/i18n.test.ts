import * as Localization from 'expo-localization';
import { detectLocale, i18n, initI18n } from './index';
import { LOCALES } from './locales';

const getLocales = jest.mocked(Localization.getLocales);
const withDeviceLanguages = (...tags: string[]) =>
  getLocales.mockReturnValueOnce(
    tags.map((languageTag) => ({ languageTag }) as Localization.Locale) as [
      Localization.Locale,
      ...Localization.Locale[],
    ],
  );

describe('detectLocale', () => {
  it('takes the first preferred language the app is translated into', () => {
    withDeviceLanguages('ta-IN', 'mr-IN', 'hi-IN');
    expect(detectLocale()).toBe('mr');
  });

  it('skips languages the app does not have', () => {
    withDeviceLanguages('sw-KE', 'hi-IN');
    expect(detectLocale()).toBe('hi');
  });

  it('finds the web app languages, including Chinese in any script', () => {
    withDeviceLanguages('de-DE');
    expect(detectLocale()).toBe('de');
    withDeviceLanguages('zh-Hant-TW');
    expect(detectLocale()).toBe('zh-CN');
    withDeviceLanguages('ar-SA');
    expect(detectLocale()).toBe('ar');
  });

  it('falls back to English when none is supported', () => {
    withDeviceLanguages('sw-KE');
    expect(detectLocale()).toBe('en');
  });
});

describe('initI18n', () => {
  it('translates, switches between languages, and fills a {{placeholder}}', async () => {
    await initI18n('en');
    expect(i18n.t('dashboard.greeting.morning', { name: 'Ana & Co' })).toBe(
      'Good morning, Ana & Co.',
    );
    await initI18n('hi');
    expect(i18n.t('dashboard.greeting.morning', { name: 'Ana & Co' })).toBe('सुप्रभात, Ana & Co।');
    await initI18n('mr');
    expect(i18n.t('dashboard.greeting.morning', { name: 'Ana & Co' })).toBe('सुप्रभात, Ana & Co.');
  });

  it('has every language loaded, each saying something other than English', async () => {
    for (const locale of LOCALES.filter((l) => l !== 'en')) {
      await initI18n(locale);
      expect(i18n.t('common.back')).not.toBe('Back');
      expect(i18n.t('common.back').length).toBeGreaterThan(0);
    }
  });

  it('picks the plural form the language needs', async () => {
    await initI18n('ru');
    expect(i18n.t('dashboard.instagram.accounts', { count: 2 })).toBe('2 аккаунта');
    expect(i18n.t('dashboard.instagram.accounts', { count: 5 })).toBe('5 аккаунтов');
    await initI18n('ar');
    expect(i18n.t('dashboard.instagram.accounts', { count: 2 })).toBe('حسابان');
    await initI18n('ja');
    expect(i18n.t('dashboard.instagram.accounts', { count: 1 })).not.toContain('accounts');
  });
});
