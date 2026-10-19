import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/ui/fade-in';
import { Text } from '@/components/ui/text';
import { TextField, type TextFieldHandle } from '@/components/ui/text-field';
import { messageForError } from '@/lib/api/error-message';
import { spacing } from '@/lib/theme/tokens';
import { AuthFrame } from './auth-frame';
import { useRecovery, type RecoveryKind } from './use-recovery';
import { useRegistrationConfig } from './use-registration-config';

/** Forgot password (route `/forgot-password`): the workspace and the email, then a link by email. */
export const ForgotPasswordScreen = () => <RecoveryScreen kind="forgot" />;

/** Find my workspace (route `/find-workspace`): the email, then the workspace addresses it can sign in to, by email. */
export const FindWorkspaceScreen = () => <RecoveryScreen kind="find" />;

/**
 * The two "send me an email" screens share one layout. The platform's public settings decide what the person sees: with a CAPTCHA
 * switched on the app cannot send the request (ADR-0023), so that is said at once instead of after a form the server will refuse.
 * What the reset link does: it opens the web's reset page in the phone's browser, where the new password is chosen.
 */
function RecoveryScreen({ kind }: { kind: RecoveryKind }) {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const config = useRegistrationConfig();
  const recovery = useRecovery(kind);
  const [workspace, setWorkspace] = useState('');
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const emailInput = useRef<TextFieldHandle>(null);

  const goSignIn = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/sign-in');
  };
  const send = () => void recovery.submit(workspace, email);
  const title = t(`recovery.${kind}.title`);

  let content: ReactNode;
  if (config.isPending) {
    content = (
      <Card>
        <View style={styles.centered}>
          <ActivityIndicator accessibilityLabel={t('common.loading')} />
        </View>
      </Card>
    );
  } else if (config.isError) {
    content = (
      <FadeIn key="error">
        <Card>
          <Banner tone="danger" message={messageForError(config.error, t)} />
          <Button
            variant="secondary"
            label={t('common.retry')}
            onPress={() => void config.refetch()}
          />
        </Card>
      </FadeIn>
    );
  } else if (config.data.captcha) {
    content = (
      <FadeIn key="captcha">
        <Card>
          <View style={styles.header}>
            <Text variant="title" accessibilityRole="header">
              {title}
            </Text>
          </View>
          <Banner tone="warning" message={t('errors.captchaUnsupported')} />
          <Button variant="secondary" label={t('recovery.back')} onPress={goSignIn} />
        </Card>
      </FadeIn>
    );
  } else if (recovery.done) {
    content = (
      <FadeIn key="done">
        <Card>
          <View style={styles.header}>
            <Text variant="title" accessibilityRole="header">
              {t(`recovery.${kind}.doneTitle`)}
            </Text>
          </View>
          <Banner tone="info" message={t(`recovery.${kind}.doneBody`)} />
          {kind === 'forgot' ? <Text muted>{t('recovery.forgot.doneOnPhone')}</Text> : null}
          <Text muted>{t(`recovery.${kind}.doneHint`)}</Text>
          <Button
            variant="secondary"
            label={t(`recovery.${kind}.tryAnother`)}
            onPress={recovery.again}
          />
          <Button variant="link" label={t('recovery.back')} onPress={goSignIn} />
        </Card>
      </FadeIn>
    );
  } else {
    content = (
      <FadeIn key="form">
        <Card>
          <View style={styles.header}>
            <Text variant="title" accessibilityRole="header">
              {title}
            </Text>
            <Text muted>{t(`recovery.${kind}.subtitle`)}</Text>
          </View>
          {recovery.error ? <Banner tone="danger" message={recovery.error} /> : null}
          {kind === 'forgot' ? (
            <>
              <TextField
                label={t('recovery.workspace')}
                hint={t('recovery.workspaceHint')}
                value={workspace}
                onChangeText={setWorkspace}
                error={recovery.fieldErrors.workspace}
                placeholder={t('recovery.workspacePlaceholder')}
                autoCapitalize="none"
                autoComplete="organization"
                autoCorrect={false}
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => emailInput.current?.focus()}
              />
              <Button
                variant="link"
                label={t('recovery.forgot.findWorkspace')}
                disabled={recovery.pending}
                onPress={() => router.push('/find-workspace')}
              />
            </>
          ) : null}
          <TextField
            label={t('auth.email')}
            value={email}
            onChangeText={setEmail}
            error={recovery.fieldErrors.email}
            inputRef={emailInput}
            placeholder={t('auth.emailPlaceholder')}
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            inputMode="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="send"
            onSubmitEditing={send}
          />
          <Button
            label={t(`recovery.${kind}.submit`)}
            testID="recovery-submit"
            loading={recovery.pending}
            onPress={send}
          />
          <Button
            variant="link"
            label={t('recovery.back')}
            disabled={recovery.pending}
            onPress={goSignIn}
          />
        </Card>
      </FadeIn>
    );
  }

  return (
    <AuthFrame tagline={title} compact onBack={goSignIn}>
      {content}
    </AuthFrame>
  );
}

const styles = StyleSheet.create({
  centered: { paddingVertical: spacing.xl, alignItems: 'center' },
  header: { gap: spacing.xs },
});
