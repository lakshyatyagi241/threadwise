import type { SessionResponse } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/ui/fade-in';
import { Text } from '@/components/ui/text';
import { spacing } from '@/lib/theme/tokens';
import { GateFrame } from './gate-frame';
import { useRecheck } from './use-account-gate';

/**
 * The suspended-account lock screen (TW-AUTH-016): the person can sign in, but nothing else works until an administrator
 * reactivates them (or, when the whole workspace is suspended, the platform restores it). It greets by name, says who to ask, and
 * offers a way to look again and a way out.
 */
export function SuspendedView({ session }: { session: SessionResponse }) {
  const { t } = useTranslation();
  const check = useRecheck();
  const name = session.user.displayName ?? session.user.fullName;
  return (
    <GateFrame title={t('gates.suspended.title')}>
      <FadeIn>
        <Card>
          <View style={styles.text}>
            <Text>{t('gates.suspended.greeting', { name })}</Text>
            <Text muted>{t('gates.suspended.support')}</Text>
          </View>
          <Button
            variant="secondary"
            label={t('gates.recheck')}
            loading={check.pending}
            onPress={() => void check.recheck()}
          />
        </Card>
      </FadeIn>
    </GateFrame>
  );
}

const styles = StyleSheet.create({ text: { gap: spacing.md } });
