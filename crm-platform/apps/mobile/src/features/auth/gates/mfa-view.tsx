import * as Linking from 'expo-linking';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/ui/fade-in';
import { PasswordField } from '@/components/ui/password-field';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { GateFrame } from './gate-frame';
import { RecoveryCodesView } from './recovery-codes-view';
import { useRecoveryCodes } from './recovery-codes-store';
import { useMfaEnrolment } from './use-mfa-enrolment';

/**
 * The required two-factor lock screen (TW-AUTH-032): enrol an authenticator app, then save the recovery codes. On the web the key is a
 * QR code to scan with the phone; on the phone itself that cannot work, so the key is offered as a button that opens the
 * authenticator app (the `otpauth` link) and as text to type by hand.
 */
export function MfaView() {
  const { t } = useTranslation();
  const codes = useRecoveryCodes();
  const enrolment = useMfaEnrolment();

  if (codes !== null) return <RecoveryCodesView codes={codes} />;

  return (
    <GateFrame title={t('gates.mfa.title')} signOutDisabled={enrolment.pending}>
      <FadeIn>
        <Card>
          <Banner tone="info" message={t('gates.mfa.banner')} />
          {enrolment.banner ? <Banner tone="danger" message={enrolment.banner} /> : null}
          {enrolment.phase === 'starting' ? <Starting /> : null}
          {enrolment.phase === 'failed' ? (
            <Button
              variant="secondary"
              label={t('common.retry')}
              onPress={() => void enrolment.start()}
            />
          ) : null}
          {enrolment.phase === 'expired' ? (
            <>
              <Banner tone="warning" message={t('gates.mfa.expired')} />
              <Button label={t('gates.mfa.restart')} onPress={() => void enrolment.start()} />
            </>
          ) : null}
          {enrolment.phase === 'password' ? (
            <PasswordStep error={enrolment.passwordError} onSubmit={enrolment.submitPassword} />
          ) : null}
          {enrolment.phase === 'ready' && enrolment.setup ? (
            <SetupStep
              secret={enrolment.setup.secret}
              otpauthUrl={enrolment.setup.otpauthUrl}
              pending={enrolment.pending}
              error={enrolment.codeError}
              onEnable={enrolment.enable}
            />
          ) : null}
        </Card>
      </FadeIn>
    </GateFrame>
  );
}

function Starting() {
  const { t } = useTranslation();
  return (
    <View style={styles.centered}>
      <ActivityIndicator accessibilityLabel={t('gates.mfa.starting')} />
      <Text muted>{t('gates.mfa.starting')}</Text>
    </View>
  );
}

/** The session is older than ten minutes: the password is asked for again before the key is made (or the code accepted). */
function PasswordStep({
  error,
  onSubmit,
}: {
  error: string | null;
  onSubmit: (password: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await onSubmit(value);
    } finally {
      setBusy(false);
      setValue('');
    }
  };
  return (
    <>
      <Text muted>{t('gates.mfa.reauth')}</Text>
      <PasswordField
        label={t('gates.mfa.passwordLabel')}
        value={value}
        onChangeText={setValue}
        error={error}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={() => void send()}
      />
      <Button label={t('gates.mfa.enable')} loading={busy} onPress={() => void send()} />
    </>
  );
}

/** The key, the way to put it in an authenticator app, and the box for the first code. */
function SetupStep({
  secret,
  otpauthUrl,
  pending,
  error,
  onEnable,
}: {
  secret: string;
  otpauthUrl: string;
  pending: boolean;
  error: string | null;
  onEnable: (code: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [code, setCode] = useState('');
  const [noApp, setNoApp] = useState(false);

  const openApp = async () => {
    setNoApp(false);
    try {
      await Linking.openURL(otpauthUrl);
    } catch {
      // Nothing on this phone handles `otpauth://`: say so, and the key below can be typed by hand.
      setNoApp(true);
    }
  };

  return (
    <>
      <View style={styles.steps}>
        <Text>{t('gates.mfa.step1')}</Text>
        <Text>{t('gates.mfa.step2')}</Text>
        <Text>{t('gates.mfa.step3')}</Text>
      </View>
      <Button
        variant="secondary"
        label={t('gates.mfa.openApp')}
        testID="gate-mfa-open-app"
        onPress={() => void openApp()}
      />
      {noApp ? <Banner tone="warning" message={t('gates.mfa.noApp')} /> : null}
      <View style={[styles.key, { backgroundColor: colors.surfaceMuted }]}>
        <Text variant="caption" muted>
          {t('gates.mfa.manualKey')}
        </Text>
        <Text variant="heading" selectable testID="gate-mfa-secret">
          {secret}
        </Text>
        <Text variant="caption" muted>
          {t('gates.mfa.manualKeyHint')}
        </Text>
      </View>
      <TextField
        code
        label={t('gates.mfa.codeLabel')}
        hint={t('gates.mfa.codeHint')}
        value={code}
        onChangeText={setCode}
        error={error}
        placeholder={'0'.repeat(6)}
        autoComplete="one-time-code"
        inputMode="numeric"
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        maxLength={6}
        returnKeyType="go"
        onSubmitEditing={() => void onEnable(code)}
      />
      <Button
        label={t('gates.mfa.enable')}
        testID="gate-mfa-enable"
        loading={pending}
        onPress={() => void onEnable(code)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  steps: { gap: spacing.sm },
  key: { gap: spacing.xs, padding: spacing.md, borderRadius: 12 },
});
