import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/ui/fade-in';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { spacing } from '@/lib/theme/tokens';
import { formatClock } from './countdown';
import { useCountdown } from './use-countdown';
import type { SignUpStep, VerifyResult } from './use-sign-up';

interface Props {
  step: Extract<SignUpStep, { kind: 'otp' }>;
  pending: boolean;
  resending: boolean;
  /** A new code was just sent. */
  resent: boolean;
  error: string | null;
  onVerify: (code: string) => Promise<VerifyResult>;
  onResend: () => void;
  onBack: () => void;
}

/** Wraps a phone number so a right-to-left sentence does not reorder its digits and signs (Unicode isolates). */
const LEFT_TO_RIGHT_ISOLATE = String.fromCharCode(0x2066);
const POP_ISOLATE = String.fromCharCode(0x2069);
const isolate = (value: string): string => `${LEFT_TO_RIGHT_ISOLATE}${value}${POP_ISOLATE}`;

/**
 * The code step of sign-up (TW-AUTH-006): the platform sent a one-time code to the person's WhatsApp, and nothing is created until
 * it is confirmed. Shows how long the code lives, when a new one can be asked for, and a way back to fix a wrong number.
 */
export function OtpStep({
  step,
  pending,
  resending,
  resent,
  error,
  onVerify,
  onResend,
  onBack,
}: Props) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const expiresIn = useCountdown(step.expiresAt);
  const resendIn = useCountdown(step.resendAt);

  const verify = async () => {
    if ((await onVerify(code)) === 'clear') setCode('');
  };

  return (
    <FadeIn key="otp">
      <Card>
        <Text variant="heading" accessibilityRole="header">
          {t('signUp.otp.sentTo', { phone: isolate(step.maskedPhone) })}
        </Text>

        {error ? <Banner tone="danger" message={error} testID="otp-error" /> : null}
        {resent && !error ? <Banner tone="info" message={t('signUp.otp.resent')} /> : null}

        <TextField
          code
          label={t('signUp.otp.code')}
          value={code}
          onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, step.codeLength))}
          hint={
            expiresIn > 0
              ? t('signUp.otp.expiresIn', { time: formatClock(expiresIn) })
              : t('signUp.otp.expired')
          }
          placeholder={'0'.repeat(step.codeLength)}
          autoComplete="one-time-code"
          inputMode="numeric"
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          maxLength={step.codeLength}
          returnKeyType="go"
          onSubmitEditing={() => void verify()}
        />

        <Button
          label={t('signUp.otp.verify')}
          testID="otp-submit"
          loading={pending}
          onPress={() => void verify()}
        />

        <View style={styles.links}>
          <Button
            variant="link"
            label={
              resendIn > 0
                ? t('signUp.otp.resendIn', { time: formatClock(resendIn) })
                : t('signUp.otp.resend')
            }
            loading={resending}
            disabled={resendIn > 0 || pending}
            onPress={onResend}
          />
          <Button
            variant="link"
            label={t('signUp.otp.wrongNumber')}
            disabled={pending}
            onPress={onBack}
          />
        </View>
      </Card>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  links: { alignItems: 'center', gap: spacing.xs },
});
