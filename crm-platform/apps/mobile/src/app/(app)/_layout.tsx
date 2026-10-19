import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';
import { AccountGateScreen } from '@/features/auth/gates/account-gate-screen';
import { useAccountGate } from '@/features/auth/gates/use-account-gate';
import { useCallReturn } from '@/features/contacts/use-call-return';
import { ThemeSync } from '@/features/menu/theme-sync';
import { RealtimeProvider } from '@/lib/realtime';
import { useSession } from '@/lib/session/use-session';
import { useTheme } from '@/lib/theme/use-theme';

/**
 * A screen opened directly (a link, a notification, a reload) is placed on top of the tabs, not alone in the stack. Alone, it has
 * nothing under it and the phone's Back button closes the whole app instead of going to the tab it belongs to.
 */
export const unstable_settings = { anchor: '(tabs)' };

/**
 * The signed-in app: the four tabs, with the thread and contact screens on top of them, over one live connection. An account the API
 * will not serve yet (suspended, a password change due, two-factor to set up, an email to verify) sees its lock screen instead of
 * the app, and nothing else is mounted: no screen asks for data that can only be refused, and no live connection is opened.
 */
export default function AppLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const session = useSession();
  const gate = useAccountGate(session.data);
  useCallReturn();

  // The first answer decides whether the app or a lock screen opens. Offline (the read is paused) the app opens as it always did.
  if (session.isPending && session.fetchStatus !== 'paused') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator accessibilityLabel={t('common.loading')} />
      </View>
    );
  }
  if (gate && session.data) return <AccountGateScreen gate={gate} session={session.data} />;

  return (
    <RealtimeProvider>
      <ThemeSync />
      <Stack screenOptions={{ headerShown: false }}>
        {/* Listed first: the first screen declared here is the one the stack starts on, and it must be the tabs. */}
        <Stack.Screen name="(tabs)" />
        {/* The "Add call" page slides up over whatever is on screen; Back (or the app's Back) returns to it. */}
        <Stack.Screen name="call-summary" options={{ animation: 'slide_from_bottom' }} />
      </Stack>
    </RealtimeProvider>
  );
}
