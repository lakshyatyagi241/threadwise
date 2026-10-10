import * as Localization from 'expo-localization';
import { detectLocale, i18n, initI18n } from './index';

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
    withDeviceLanguages('sw-KE', 'pt-BR', 'fr-FR');
    expect(detectLocale()).toBe('pt');
  });

  it('falls back to English when none is supported', () => {
    withDeviceLanguages('sw-KE');
    expect(detectLocale()).toBe('en');
  });
});

describe('initI18n', () => {
  it('translates, switches language, and fills a {{placeholder}}', async () => {
    await initI18n('en');
    expect(i18n.t('common.signOut')).toBe('Sign out');
    await initI18n('de');
    expect(i18n.t('common.signOut')).toBe('Abmelden');
    expect(i18n.t('home.welcome', { name: 'Ana & Co' })).toBe('Hallo, Ana & Co');
  });
});
