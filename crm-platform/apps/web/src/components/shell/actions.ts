'use server';

import { cookies } from 'next/headers';
import { THEME_COOKIE } from '@/lib/auth/cookies';
import { LOCALE_COOKIE, isLocale } from '@/i18n/locales';

const YEAR = 60 * 60 * 24 * 365;

export async function setLocale(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: '/', maxAge: YEAR, sameSite: 'lax' });
}

export async function setTheme(theme: 'light' | 'dark') {
  (await cookies()).set(THEME_COOKIE, theme === 'dark' ? 'dark' : 'light', {
    path: '/',
    maxAge: YEAR,
    sameSite: 'lax',
  });
}
