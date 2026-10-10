import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { spacing } from '@/lib/theme/tokens';
import { useSignIn } from './use-sign-in';

export function SignInScreen() {
  const { t } = useTranslation();
  const { step, pending, error, fieldErrors, submitPassword, submitCode, pickWorkspace, restart } =
    useSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');

  return (
    <Screen>
      {step.kind === 'credentials' && (
        <View style={{ gap: spacing.lg }}>
          <Text variant="title" accessibilityRole="header">
            {t('auth.signInTitle')}
          </Text>
          <Text muted>{t('auth.signInSubtitle')}</Text>
          <TextField
            label={t('auth.email')}
            value={email}
            onChangeText={setEmail}
            error={fieldErrors.email}
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            inputMode="email"
            keyboardType="email-address"
            textContentType="username"
            returnKeyType="next"
          />
          <TextField
            label={t('auth.password')}
            value={password}
            onChangeText={setPassword}
            error={fieldErrors.password}
            autoCapitalize="none"
            autoComplete="current-password"
            autoCorrect={false}
            secureTextEntry
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void submitPassword(email, password)}
          />
          {error ? <FormError message={error} /> : null}
          <Button
            label={t('auth.signInSubmit')}
            testID="sign-in-submit"
            loading={pending}
            onPress={() => void submitPassword(email, password)}
          />
        </View>
      )}

      {step.kind === 'mfa' && (
        <View style={{ gap: spacing.lg }}>
          <Text variant="title" accessibilityRole="header">
            {t('auth.mfaTitle')}
          </Text>
          <Text muted>{t('auth.mfaHint')}</Text>
          <TextField
            label={t('auth.mfaCode')}
            value={code}
            onChangeText={setCode}
            autoComplete="one-time-code"
            inputMode="numeric"
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            maxLength={7}
            returnKeyType="go"
            onSubmitEditing={() => void submitCode(code)}
          />
          {error ? <FormError message={error} /> : null}
          <Button
            label={t('auth.mfaSubmit')}
            loading={pending}
            onPress={() => void submitCode(code)}
          />
          <Button
            label={t('common.back')}
            variant="secondary"
            disabled={pending}
            onPress={restart}
          />
        </View>
      )}

      {step.kind === 'workspace' && (
        <View style={{ gap: spacing.lg }}>
          <Text variant="title" accessibilityRole="header">
            {t('auth.workspaceTitle')}
          </Text>
          <Text muted>{t('auth.workspaceHint')}</Text>
          {error ? <FormError message={error} /> : null}
          {step.workspaces.map((w) => (
            <Button
              key={w.slug}
              label={w.name}
              variant="secondary"
              disabled={pending}
              onPress={() => void pickWorkspace(w.slug)}
            />
          ))}
          <Button
            label={t('common.back')}
            variant="secondary"
            disabled={pending}
            onPress={restart}
          />
        </View>
      )}
    </Screen>
  );
}

function FormError({ message }: { message: string }) {
  return (
    <Text danger accessibilityRole="alert" accessibilityLiveRegion="polite">
      {message}
    </Text>
  );
}
