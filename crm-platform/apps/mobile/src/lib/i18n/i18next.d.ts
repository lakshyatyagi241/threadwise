import 'i18next';
import type en from '@/messages/en.json';

/** English is the source of truth: `t('auth.nope')` is a compile error, so a typo never ships as a raw key on a screen. */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}
