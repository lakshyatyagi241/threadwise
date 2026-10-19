import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/ui/fade-in';
import { PasswordField } from '@/components/ui/password-field';
import { Text } from '@/components/ui/text';
import { TextField, type TextFieldHandle } from '@/components/ui/text-field';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { AuthFrame } from './auth-frame';
import { LegalText } from './legal-text';
import { useRegistrationConfig } from './use-registration-config';
import { useSignIn } from './use-sign-in';

/**
 * Sign-in (TW-AUTH-001): email and password, then, when the account asks for it, the authenticator code, or the choice of
 * workspace when the same login opens several. Each step is one card that eases in. The "Create an account" line and the terms
 * line come from the platform's public settings, exactly as on the web: no sign-up link while registration is closed, and nothing
 * guessed while the settings are loading.
 */
export function SignInScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const config = useRegistrationConfig();
  const { step, pending, error, fieldErrors, submitPassword, submitCode, pickWorkspace, restart } =
    useSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const passwordInput = useRef<TextFieldHandle>(null);

  return (
    <AuthFrame tagline={t('auth.tagline')} caption={t('auth.taglineCaption')}>
      {step.kind === 'credentials' && (
        <>
          <FadeIn key="credentials">
            <Card>
              <View style={styles.header}>
                <Text variant="title" accessibilityRole="header">
                  {t('auth.welcomeBack')}
                </Text>
                <Text muted>{t('auth.welcomeSubtitle')}</Text>
              </View>
              {error ? <Banner tone="danger" message={error} /> : null}
              <TextField
                label={t('auth.email')}
                value={email}
                onChangeText={setEmail}
                error={fieldErrors.email}
                placeholder={t('auth.emailPlaceholder')}
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                inputMode="email"
                keyboardType="email-address"
                textContentType="username"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => passwordInput.current?.focus()}
              />
              <PasswordField
                label={t('auth.password')}
                value={password}
                onChangeText={setPassword}
                error={fieldErrors.password}
                inputRef={passwordInput}
                placeholder={t('auth.passwordPlaceholder')}
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={() => void submitPassword(email, password)}
              />
              <Button
                variant="link"
                label={t('auth.forgotPassword')}
                disabled={pending}
                onPress={() =>
                  router.push({
                    pathname: '/forgot-password',
                    params: email.trim() ? { email: email.trim() } : {},
                  })
                }
              />
              <Button
                label={t('auth.signInSubmit')}
                testID="sign-in-submit"
                loading={pending}
                onPress={() => void submitPassword(email, password)}
              />
            </Card>
          </FadeIn>
          <FadeIn key="credentials-after" delay={140}>
            <View style={styles.after}>
              {config.data?.registrationOpen ? (
                <View style={styles.footer}>
                  <Text muted>{t('auth.newHere')}</Text>
                  <Button
                    variant="link"
                    label={t('auth.createAccount')}
                    disabled={pending}
                    onPress={() => router.push('/sign-up')}
                  />
                </View>
              ) : null}
              {config.data ? (
                <LegalText i18nKey="auth.legalSignIn" links={config.data.links} />
              ) : null}
            </View>
          </FadeIn>
        </>
      )}

      {step.kind === 'mfa' && (
        <FadeIn key="mfa">
          <Card>
            <View style={styles.header}>
              <Text variant="title" accessibilityRole="header">
                {t('auth.mfaTitle')}
              </Text>
              <Text muted>{t('auth.mfaHint')}</Text>
            </View>
            {error ? <Banner tone="danger" message={error} /> : null}
            <TextField
              code
              label={t('auth.mfaCode')}
              value={code}
              onChangeText={setCode}
              placeholder={'0'.repeat(6)}
              autoComplete="one-time-code"
              inputMode="numeric"
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              maxLength={7}
              returnKeyType="go"
              onSubmitEditing={() => void submitCode(code)}
            />
            <Button
              label={t('auth.mfaSubmit')}
              loading={pending}
              onPress={() => void submitCode(code)}
            />
            <Button variant="link" label={t('common.back')} disabled={pending} onPress={restart} />
          </Card>
        </FadeIn>
      )}

      {step.kind === 'workspace' && (
        <FadeIn key="workspace">
          <Card>
            <View style={styles.header}>
              <Text variant="title" accessibilityRole="header">
                {t('auth.workspaceTitle')}
              </Text>
              <Text muted>{t('auth.workspaceHint')}</Text>
            </View>
            {error ? <Banner tone="danger" message={error} /> : null}
            <View style={styles.list}>
              {step.workspaces.map((w, index) => (
                <FadeIn key={w.slug} delay={120 + index * 70}>
                  <WorkspaceOption
                    name={w.name}
                    role={w.role}
                    disabled={pending}
                    onPress={() => void pickWorkspace(w.slug)}
                  />
                </FadeIn>
              ))}
            </View>
            <Button variant="link" label={t('common.back')} disabled={pending} onPress={restart} />
          </Card>
        </FadeIn>
      )}
    </AuthFrame>
  );
}

/** One workspace to choose from: its name, and the person's role there when they have one (read out as the button's hint). */
function WorkspaceOption({
  name,
  role,
  disabled,
  onPress,
}: {
  name: string;
  role: string | null;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityHint={role ?? undefined}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        {
          backgroundColor: pressed ? colors.primarySoft : colors.background,
          borderColor: colors.borderStrong,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text variant="heading">{name}</Text>
      {role ? (
        <Text variant="caption" muted>
          {role}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.xs },
  after: { gap: spacing.md },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  list: { gap: spacing.md },
  option: {
    borderWidth: 1.5,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
});
