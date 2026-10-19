import type { SessionResponse } from '@crm/contracts';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/ui/fade-in';
import { Text } from '@/components/ui/text';
import { spacing } from '@/lib/theme/tokens';
import { GateFrame } from './gate-frame';
import { useRecheck } from './use-account-gate';
import { useResendVerification } from './use-resend-verification';

/**
 * The "verify your email" lock screen (TW-AUTH-015), shown when the workspace's policy blocks an unverified address. The link in the
 * email opens in the phone's browser and verifies the address there (it signs nobody in); coming back, the person taps the button, or
 * the app finds out by itself when it returns to the front.
 */
export function VerifyEmailView({ session }: { session: SessionResponse }) {
  const { t } = useTranslation();
  const check = useRecheck();
  const [notYet, setNotYet] = useState(false);
  const { recheck } = check;
  const read = useCallback(() => void recheck(), [recheck]);
  const resend = useResendVerification(read);

  const continueIn = async () => {
    setNotYet(false);
    await recheck();
    // Still here after the session was read again: the address is not verified yet.
    setNotYet(true);
  };

  return (
    <GateFrame title={t('gates.verify.title')}>
      <FadeIn>
        <Card>
          <View style={styles.text}>
            <Text>{t('gates.verify.body')}</Text>
            <Text variant="heading">{session.user.email}</Text>
          </View>
          {notYet ? <Banner tone="warning" message={t('gates.verify.notYet')} /> : null}
          {resend.notice === 'sent' ? (
            <Banner tone="info" message={t('gates.verify.sent', { email: session.user.email })} />
          ) : null}
          {resend.notice === 'notSent' ? (
            <Banner tone="danger" message={t('gates.verify.notSent')} />
          ) : null}
          {resend.notice === 'throttled' ? (
            <Banner tone="info" message={t('gates.verify.throttled')} />
          ) : null}
          {resend.notice === 'alreadyVerified' ? (
            <Banner tone="info" message={t('gates.verify.alreadyVerified')} />
          ) : null}
          {resend.error ? <Banner tone="danger" message={resend.error} /> : null}
          <Button
            label={t('gates.verify.continue')}
            loading={check.pending}
            onPress={() => void continueIn()}
          />
          <Button
            variant="secondary"
            label={
              resend.seconds > 0
                ? t('gates.verify.resendIn', { seconds: resend.seconds })
                : t('gates.verify.resend')
            }
            loading={resend.pending}
            disabled={resend.seconds > 0}
            onPress={() => void resend.resend()}
          />
        </Card>
      </FadeIn>
    </GateFrame>
  );
}

const styles = StyleSheet.create({ text: { gap: spacing.sm } });
