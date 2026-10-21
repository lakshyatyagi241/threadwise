import { useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Icon } from '@/components/ui/icon';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { isApiError } from '@/lib/api';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import {
  clearTemplateDraft,
  getTemplateDraft,
  setTemplateValue,
  useTemplateDraft,
} from './template-draft';
import { allSlotsFilled, valueProblem, valuesKey } from './template-model';
import { sendErrorMessage } from './thread-errors';
import { useSendTemplate } from './use-inbox';

/**
 * Page 2 of sending a template (route /template-variables): the template as written (header, body, footer), a box for each `{{n}}` of the
 * body, the buttons the template has, a Preview button, and Send in the top bar. Send is on only when every box has something in it. What is
 * typed is kept in memory only (`template-draft.ts`), so Preview shows it and Back to the list drops it.
 */
export function TemplateVariablesScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const draft = useTemplateDraft();
  const send = useSendTemplate(draft?.conversationId ?? '');
  const [failed, setFailed] = useState<string | null>(null);
  // The id of the message being sent, kept while the same words are retried (a dropped connection must not make two messages) and
  // changed when the words change.
  const attempt = useRef<{ id: string; key: string } | null>(null);
  // Read straight away, not from the last render: two quick presses on Send must make one request.
  const submitting = useRef(false);

  // Nothing to show without a draft (the app was reloaded on this page): leave once, when the page opens. Checking only then keeps a page
  // that is being closed on purpose (sent, or Back) from also sending the person one page further back.
  useEffect(() => {
    if (getTemplateDraft()) return;
    if (router.canGoBack()) router.back();
    else router.replace('/inbox');
  }, [router]);
  if (!draft) return null;

  const { template, conversationId, values } = draft;
  const ready = allSlotsFilled(template, values);
  const sending = send.isPending;

  const submit = () => {
    if (!ready || sending || submitting.current) return;
    submitting.current = true;
    setFailed(null);
    const key = valuesKey(template, values);
    if (!attempt.current || attempt.current.key !== key) {
      attempt.current = { id: Crypto.randomUUID(), key };
    }
    const variables = Object.fromEntries(
      template.slots.map((slot) => [slot.key, (values[slot.key] ?? '').trim()]),
    );
    send.mutate(
      { clientMessageId: attempt.current.id, templateId: template.id, variables },
      {
        onSuccess: () => {
          clearTemplateDraft();
          router.dismissTo({ pathname: '/conversation/[id]', params: { id: conversationId } });
        },
        onError: (error) => {
          // After a lost connection the same words are sent again as the same message. After the server's own "no" (a channel that is
          // down, a template that changed) the next try is a new message, so an old refusal is never replayed for it.
          if (!(isApiError(error) && error.isConnectivity)) attempt.current = null;
          setFailed(sendErrorMessage(error, t));
        },
        onSettled: () => {
          submitting.current = false;
        },
      },
    );
  };

  const sendAction = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('inbox.template.submit')}
      accessibilityHint={ready ? undefined : t('inbox.template.fillFirst')}
      accessibilityState={{ disabled: !ready || sending, busy: sending }}
      disabled={!ready || sending}
      onPress={submit}
      style={[styles.send, (!ready || sending) && styles.faded]}
    >
      {sending ? (
        <ActivityIndicator accessibilityLabel={t('common.loading')} />
      ) : (
        <Icon name="paper-plane-outline" size={22} color="primary" />
      )}
      <Text variant="label" style={{ color: colors.primary }}>
        {t('inbox.template.submit')}
      </Text>
    </Pressable>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <StackHeader
        title={t('inbox.template.variablesTitle')}
        onBack={() => {
          // While the message is on its way the page stays, so the person sees how it ended.
          if (!sending) router.back();
        }}
        actions={sendAction}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('inbox.template.preview')}
        accessibilityState={{ disabled: sending }}
        disabled={sending}
        onPress={() => router.navigate('/template-preview')}
        style={[styles.preview, { backgroundColor: colors.surfaceMuted }]}
      >
        <Icon name="eye-outline" size={22} color="primary" />
        <Text variant="label" style={{ color: colors.primary }}>
          {t('inbox.template.preview')}
        </Text>
      </Pressable>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {failed ? <Banner tone="danger" message={failed} /> : null}
        <Text>{t('inbox.template.nameLine', { name: template.name })}</Text>
        <View style={[styles.box, { backgroundColor: colors.surfaceMuted }]}>
          {template.header ? (
            <>
              <Text variant="label">{t('inbox.template.headerLabel')}</Text>
              <Text>{template.header}</Text>
            </>
          ) : null}
          <Text variant="label">{t('inbox.template.bodyLabel')}</Text>
          <Text>{template.body.trim()}</Text>
          {template.footer ? (
            <>
              <Text variant="label">{t('inbox.template.footerLabel')}</Text>
              <Text muted>{template.footer}</Text>
            </>
          ) : null}
        </View>
        {template.slots.length > 0 ? (
          <View style={styles.group}>
            <Text variant="label">{t('inbox.template.variablesLabel')}</Text>
            {template.slots.map((slot) => (
              <TextField
                key={slot.key}
                label={slot.label}
                placeholder={slot.example ?? undefined}
                value={values[slot.key] ?? ''}
                onChangeText={(text) => setTemplateValue(slot.key, text)}
                editable={!sending}
                error={
                  valueProblem(values[slot.key] ?? '') ? t('inbox.template.valueInvalid') : null
                }
                // What goes into a customer's message is not for the keyboard's learning dictionary or an autofill service.
                autoCorrect={false}
                autoComplete="off"
                importantForAutofill="no"
                spellCheck={false}
              />
            ))}
          </View>
        ) : (
          <Text muted>{t('inbox.template.noVariables')}</Text>
        )}
        {template.buttons.length > 0 ? (
          <View style={styles.group}>
            <Text variant="label">{t('inbox.template.buttonsLabel')}</Text>
            {template.buttons.map((label, i) => (
              <View
                key={`${label}-${i}`}
                style={[styles.button, { backgroundColor: colors.surfaceMuted }]}
              >
                <Text variant="label">{label}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  send: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  faded: { opacity: 0.45 },
  preview: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  body: { padding: spacing.lg, gap: spacing.lg },
  box: { gap: spacing.xs, padding: spacing.md, borderRadius: radius.md },
  group: { gap: spacing.md },
  button: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
});
