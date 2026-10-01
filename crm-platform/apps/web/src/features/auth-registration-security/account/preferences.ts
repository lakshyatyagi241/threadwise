import { LOCALE_COOKIE, isLocale, type Locale } from '@/i18n/locales';
import { THEME_COOKIE } from '@/lib/auth/cookies';

export interface PreferencesToApply {
  /** The shell's two modes: paper and bright are both light. */
  theme?: 'light' | 'dark';
  locale?: Locale;
}

const hasCookie = (cookieHeader: string, name: string) =>
  cookieHeader.split(';').some((part) => part.trim().startsWith(`${name}=`));

/**
 * What to apply from the stored profile when this browser has not chosen yet
 * (WD-AUTH-025): a theme cookie and a language cookie win over the profile, so a
 * choice made in the shell is never undone. A profile with no language set
 * applies none.
 */
export function preferencesToApply(
  cookieHeader: string,
  profile: { theme: 'paper' | 'bright' | 'dark'; locale: string | null },
): PreferencesToApply {
  const out: PreferencesToApply = {};
  if (!hasCookie(cookieHeader, THEME_COOKIE))
    out.theme = profile.theme === 'dark' ? 'dark' : 'light';
  if (!hasCookie(cookieHeader, LOCALE_COOKIE) && isLocale(profile.locale))
    out.locale = profile.locale;
  return out;
}
