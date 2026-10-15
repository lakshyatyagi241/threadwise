import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { i18n, initI18n } from '@/lib/i18n';
import { getSnapshot, restoreSession, subscribe } from '@/lib/auth/session-manager';
import { log } from '@/lib/observability/logger';
import { initObservability, withObservability } from '@/lib/observability/sentry';
import { createQueryClient, wireQueryEnvironment } from '@/lib/query/query-client';
import { useAppFonts } from '@/lib/theme/fonts';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

initObservability();
wireQueryEnvironment();
void SplashScreen.preventAutoHideAsync();

// One client for the life of the process. Signing out clears its cache (lib/auth/sign-out.ts).
const queryClient = createQueryClient();

function RootLayout() {
  const [ready, setReady] = useState(false);
  const auth = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [fontsLoaded, fontError] = useAppFonts();
  // A font that cannot load must not keep the app on the splash screen: the text falls back to the phone's own font.
  const fontsDone = fontsLoaded || fontError !== null;

  useEffect(() => {
    // The language and the stored session are both needed before the first screen, or it flashes the wrong one.
    Promise.all([initI18n(), restoreSession()])
      .catch((e: unknown) => log.exception(e, 'app.boot_failed'))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (fontError) log.exception(fontError, 'app.fonts_failed');
  }, [fontError]);

  useEffect(() => {
    if (ready && fontsDone && auth.status !== 'loading') void SplashScreen.hideAsync();
  }, [ready, fontsDone, auth.status]);

  if (!ready || !fontsDone || auth.status === 'loading') return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={queryClient}>
            <StatusBar style="auto" />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Protected guard={auth.status === 'signedIn'}>
                <Stack.Screen name="(app)" />
              </Stack.Protected>
              <Stack.Protected guard={auth.status === 'signedOut'}>
                <Stack.Screen name="(auth)" />
              </Stack.Protected>
            </Stack>
          </QueryClientProvider>
        </I18nextProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default withObservability(RootLayout);

/** Rendered by Expo Router when a screen throws while rendering: a recoverable screen instead of a white one. */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  useEffect(() => {
    log.exception(error, 'app.render_crash');
  }, [error]);
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        padding: spacing.xl,
        gap: spacing.lg,
        backgroundColor: colors.background,
      }}
    >
      <Text variant="heading" accessibilityRole="alert">
        {t('errors.generic')}
      </Text>
      <Button label={t('common.retry')} onPress={() => void retry()} />
    </View>
  );
}
