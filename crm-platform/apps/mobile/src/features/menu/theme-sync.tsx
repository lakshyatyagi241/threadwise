import { useEffect } from 'react';
import { Appearance } from 'react-native';
import { useSession } from '@/lib/session/use-session';
import { FOLLOW_PHONE, schemeOf } from './appearance';

/**
 * Keeps the app's light/dark setting in step with the signed-in account's theme. It draws nothing. While the account has no choice
 * (or the session is still loading) the app follows the phone; leaving the signed-in part of the app (signing out) gives the
 * choice back to the phone, so the sign-in screens never keep another person's theme.
 */
export function ThemeSync() {
  const theme = useSession().data?.user.theme;
  useEffect(() => {
    Appearance.setColorScheme(schemeOf(theme));
    return () => Appearance.setColorScheme(FOLLOW_PHONE);
  }, [theme]);
  return null;
}
