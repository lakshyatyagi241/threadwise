import { DELETE_CONFIRMATION_PHRASE, ERROR_CODES } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PasswordField } from '@/components/ui/password-field';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import { signOut } from '@/lib/auth/sign-out';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { deleteAccount } from './delete-account-api';
import {
  blockerOf,
  buildDeleteRequest,
  phraseMatches,
  type DeleteBlocker,
} from './delete-account-rules';

type Field = 'phrase' | 'password';

/**
 * Request for account deletion (route /delete-account, from Data & Security), the web's Delete account page (`/account/delete`): the
 * person types the phrase and their current password, and the API deletes their own account for good (`DELETE /v2/account`). It
 * refuses the only member and the only administrator, which is said after the attempt. On success the phone signs out and the app
 * returns to sign-in; the workspace and its other members stay.
 */
export function DeleteAccountScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [phrase, setPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [blocker, setBlocker] = useState<DeleteBlocker | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/menu'));
  const ready = phraseMatches(phrase) && password.length > 0;

  const submit = async () => {
    if (pending) return;
    setBlocker(null);
    setFailure(null);
    const found: Partial<Record<Field, string>> = {};
    if (!phraseMatches(phrase)) found.phrase = t('accountDelete.errors.phrase');
    if (!password) found.password = t('accountDelete.errors.passwordRequired');
    const body = buildDeleteRequest(phrase, password);
    if (Object.keys(found).length > 0 || !body) {
      setErrors(found);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await deleteAccount(body);
      // The account is gone on the server: end the session on the phone too; the app then shows the sign-in screen.
      await signOut(queryClient);
    } catch (error) {
      const refused = blockerOf(error);
      if (isApiError(error) && error.code === ERROR_CODES.AUTH_CURRENT_PASSWORD_WRONG) {
        setErrors({ password: t('accountDelete.errors.passwordWrong') });
      } else if (isApiError(error) && error.code === ERROR_CODES.AUTH_CONFIRMATION_MISMATCH) {
        setErrors({ phrase: t('accountDelete.errors.phrase') });
      } else if (refused) {
        setBlocker(refused);
      } else {
        setFailure(messageForError(error, t));
      }
      setPending(false);
    }
  };

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader title={t('accountDelete.title')} onBack={back} />
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Card>
            <Text variant="subheading" danger accessibilityRole="header">
              {t('accountDelete.title')}
            </Text>
            <Text>{t('accountDelete.warning')}</Text>
            <Text variant="label">{t('accountDelete.irreversible')}</Text>
          </Card>
          <Card>
            <Text variant="label">{t('accountDelete.consequencesTitle')}</Text>
            {(['consequence1', 'consequence2', 'consequence3'] as const).map((key) => (
              <Text key={key} muted>
                {`• ${t(`accountDelete.${key}`)}`}
              </Text>
            ))}
          </Card>

          {blocker ? (
            <Banner
              tone="warning"
              message={`${t(`accountDelete.blocked.${blocker}.title`)} ${t(`accountDelete.blocked.${blocker}.body`)}`}
            />
          ) : null}
          {failure ? <Banner tone="danger" message={failure} /> : null}

          <TextField
            label={t('accountDelete.phraseLabel', { phrase: DELETE_CONFIRMATION_PHRASE })}
            hint={t('accountDelete.phraseHint')}
            value={phrase}
            onChangeText={(v) => {
              setPhrase(v);
              setErrors((e) => ({ ...e, phrase: undefined }));
            }}
            error={errors.phrase}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={DELETE_CONFIRMATION_PHRASE}
          />
          <PasswordField
            label={t('accountDelete.password')}
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setErrors((e) => ({ ...e, password: undefined }));
            }}
            error={errors.password}
            autoComplete="current-password"
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
          />

          <Button
            variant="danger"
            label={t('accountDelete.submit')}
            loading={pending}
            disabled={!ready}
            onPress={() => void submit()}
          />
          <Button
            variant="secondary"
            label={t('accountDelete.cancel')}
            onPress={back}
            disabled={pending}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg },
});
