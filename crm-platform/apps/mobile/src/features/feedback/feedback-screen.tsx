import { useMutation } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { messageForError } from '@/lib/api/error-message';
import { useSession } from '@/lib/session/use-session';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { sendFeedback } from './feedback-api';

const SUBJECT_MAX = 191;
const MESSAGE_MAX = 4000;

/**
 * Send feedback (route /feedback, from the Feedback tile of the Menu): a subject and a message, filed as a support ticket under the
 * person's own name and email so the team can reply. Both are required; a failed send keeps what was typed and says why; a sent one
 * shows the ticket number. The idempotency key is made once for the form, so pressing Send twice files one ticket.
 */
export function FeedbackScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const session = useSession();
  const user = session.data?.user;
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [problems, setProblems] = useState<{ subject?: string; message?: string }>({});
  const key = useRef(Crypto.randomUUID());
  const send = useMutation({
    mutationFn: (body: { subject: string; message: string }) =>
      sendFeedback(
        {
          reason: 'other',
          name: user?.displayName ?? user?.fullName ?? user?.email ?? '',
          email: user?.email ?? '',
          ...body,
        },
        key.current,
      ),
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace('/menu'));
  const submit = () => {
    const next = {
      subject: subject.trim() ? undefined : t('feedback.subjectRequired'),
      message: message.trim() ? undefined : t('feedback.messageRequired'),
    };
    setProblems(next);
    if (next.subject || next.message) return;
    send.mutate({ subject: subject.trim(), message: message.trim() });
  };

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader title={t('feedback.title')} onBack={back} />
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {send.data ? (
            <View style={styles.sent}>
              <Icon name="checkmark-circle-outline" size={56} color="success" />
              <Text variant="heading" accessibilityRole="header">
                {t('feedback.sentTitle')}
              </Text>
              <Text muted style={styles.centered}>
                {t('feedback.sentBody', {
                  number: send.data.ticketNumber,
                  email: user?.email ?? '',
                })}
              </Text>
              <Button label={t('feedback.done')} onPress={back} />
            </View>
          ) : (
            <>
              <Text muted>{t('feedback.intro')}</Text>
              <TextField
                label={t('feedback.subjectLabel')}
                placeholder={t('feedback.subjectPlaceholder')}
                value={subject}
                onChangeText={setSubject}
                maxLength={SUBJECT_MAX}
                error={problems.subject}
                returnKeyType="next"
              />
              <TextField
                label={t('feedback.messageLabel')}
                placeholder={t('feedback.messagePlaceholder')}
                value={message}
                onChangeText={setMessage}
                maxLength={MESSAGE_MAX}
                error={problems.message}
                multiline
                numberOfLines={6}
                textAlignVertical="top"
              />
              {send.error ? (
                <Banner tone="danger" message={messageForError(send.error, t)} />
              ) : null}
              <Button label={t('feedback.send')} loading={send.isPending} onPress={submit} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  sent: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.xxl },
  centered: { textAlign: 'center' },
});
