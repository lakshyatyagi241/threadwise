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
    withDeviceLanguages('ta-IN', 'mr-IN', 'hi-IN');
    expect(detectLocale()).toBe('mr');
  });

  it('skips languages the app does not have', () => {
    withDeviceLanguages('de-DE', 'hi-IN');
    expect(detectLocale()).toBe('hi');
  });

  it('falls back to English when none is supported', () => {
    withDeviceLanguages('sw-KE');
    expect(detectLocale()).toBe('en');
  });
});

describe('initI18n', () => {
  it('translates, switches between the three languages, and fills a {{placeholder}}', async () => {
    await initI18n('en');
    expect(i18n.t('dashboard.greeting.morning', { name: 'Ana & Co' })).toBe(
      'Good morning, Ana & Co.',
    );
    await initI18n('hi');
    expect(i18n.t('dashboard.greeting.morning', { name: 'Ana & Co' })).toBe('सुप्रभात, Ana & Co।');
    await initI18n('mr');
    expect(i18n.t('dashboard.greeting.morning', { name: 'Ana & Co' })).toBe('सुप्रभात, Ana & Co.');
  });
});
