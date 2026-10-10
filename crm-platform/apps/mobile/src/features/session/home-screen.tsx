import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { messageForError } from '@/lib/api/error-message';
import { signOut } from '@/lib/auth/sign-out';
import { identifyUser } from '@/lib/observability/sentry';
import { spacing } from '@/lib/theme/tokens';
import { useSession } from './use-session';

/**
 * The signed-in landing screen of the foundation: proves token, refresh, contract parsing and sign-out end to end against the real
 * API. Feature screens (inbox, contacts, ...) replace it as they are ported (docs/mobile/backlog.md).
 */
export function HomeScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const session = useSession();
  const userId = session.data?.user.id;

  useEffect(() => {
    if (userId) identifyUser(userId);
  }, [userId]);

  return (
    <Screen>
      <View style={{ gap: spacing.lg }}>
        {session.isPending ? (
          <ActivityIndicator accessibilityLabel={t('common.loading')} />
        ) : session.isError ? (
          <>
            <Text danger accessibilityRole="alert">
              {messageForError(session.error, t)}
            </Text>
            <Button label={t('common.retry')} onPress={() => void session.refetch()} />
          </>
        ) : (
          <>
            <Text variant="title" accessibilityRole="header">
              {t('home.welcome', {
                name: session.data.user.displayName ?? session.data.user.fullName,
              })}
            </Text>
            <Text muted>{t('home.workspace', { name: session.data.org.name })}</Text>
          </>
        )}
        <Button
          label={t('common.signOut')}
          variant="secondary"
          onPress={() => void signOut(queryClient)}
        />
      </View>
    </Screen>
  );
}
