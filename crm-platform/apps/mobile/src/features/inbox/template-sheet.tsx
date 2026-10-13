import type { InboxTemplateOption } from '@crm/contracts';
import * as Crypto from 'expo-crypto';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { messageForError } from '@/lib/api/error-message';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { sendErrorMessage } from './thread-errors';
import { useDebouncedValue } from './use-debounced-value';
import { useInboxTemplates, useSendTemplate } from './use-inbox';

const SEARCH_DEBOUNCE_MS = 300;

interface Props {
  visible: boolean;
  conversationId: string;
  onClose: () => void;
}

/**
 * The sheet that opens from "Send Template": the approved templates of the number this conversation runs on, searchable. One with
 * no variables is sent when it is pressed; one with `{{n}}` slots asks for each value first. A template the app cannot fill in yet
 * is listed greyed out with the reason, so it is not a mystery why a template known from the library is missing.
 */
export function TemplateSheet({ visible, conversationId, onClose }: Props) {
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      {/* Only mounted while open, so the list is asked for when the sheet opens and starts fresh each time. */}
      <SheetBody conversationId={conversationId} onClose={onClose} />
    </Modal>
  );
}

function SheetBody({ conversationId, onClose }: Omit<Props, 'visible'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [typed, setTyped] = useState('');
  const q = useDebouncedValue(typed.trim(), SEARCH_DEBOUNCE_MS);
  const list = useInboxTemplates(conversationId, q, true);
  const send = useSendTemplate(conversationId);
  const [chosen, setChosen] = useState<InboxTemplateOption | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string | null>(null);

  const submit = (template: InboxTemplateOption, variables: Record<string, string>) => {
    setFailed(null);
    send.mutate(
      { clientMessageId: Crypto.randomUUID(), templateId: template.id, variables },
      { onSuccess: onClose, onError: (error) => setFailed(sendErrorMessage(error, t)) },
    );
  };
  const pick = (template: InboxTemplateOption) => {
    if (!template.sendable || send.isPending) return;
    setFailed(null);
    if (template.slots.length === 0) {
      submit(template, {});
      return;
    }
    setValues({});
    setChosen(template);
  };
  const filled = chosen !== null && chosen.slots.every((slot) => (values[slot.key] ?? '').trim());

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('inbox.template.close')}
        onPress={onClose}
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
      />
      <View
        accessibilityViewIsModal
        style={[
          styles.sheet,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            paddingBottom: insets.bottom + spacing.lg,
          },
        ]}
      >
        <View style={styles.header}>
          <Text variant="heading" accessibilityRole="header" style={styles.title}>
            {chosen ? chosen.name : t('inbox.template.title')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('inbox.template.close')}
            onPress={onClose}
            style={styles.close}
          >
            <Icon name="close" size={24} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {failed ? <Banner tone="danger" message={failed} /> : null}
          {chosen ? (
            <View style={styles.form}>
              <Text variant="label">{t('inbox.template.fillTitle')}</Text>
              <Text muted>{chosen.body}</Text>
              {chosen.slots.map((slot) => (
                <TextField
                  key={slot.key}
                  label={slot.label}
                  placeholder={slot.example ?? undefined}
                  value={values[slot.key] ?? ''}
                  onChangeText={(text) => setValues((all) => ({ ...all, [slot.key]: text }))}
                />
              ))}
              <Button
                label={t('inbox.template.submit')}
                loading={send.isPending}
                disabled={!filled}
                onPress={() => submit(chosen, values)}
              />
              <Button
                variant="link"
                label={t('inbox.template.back')}
                disabled={send.isPending}
                onPress={() => {
                  setChosen(null);
                  setFailed(null);
                }}
              />
            </View>
          ) : (
            <View style={styles.form}>
              <TextField
                label={t('inbox.template.search')}
                value={typed}
                onChangeText={setTyped}
                autoCapitalize="none"
                returnKeyType="search"
              />
              {list.isPending ? (
                <ActivityIndicator accessibilityLabel={t('common.loading')} />
              ) : list.error ? (
                <View>
                  <Banner tone="danger" message={messageForError(list.error, t)} />
                  <Button
                    variant="link"
                    align="start"
                    label={t('common.retry')}
                    onPress={() => void list.refetch()}
                  />
                </View>
              ) : (list.data?.data ?? []).length === 0 ? (
                <Text muted>{q ? t('inbox.template.emptySearch') : t('inbox.template.empty')}</Text>
              ) : (
                <View>
                  {(list.data?.data ?? []).map((template) => (
                    <TemplateRow
                      key={template.id}
                      template={template}
                      busy={send.isPending}
                      onPress={() => pick(template)}
                    />
                  ))}
                  {list.data?.hasMore ? (
                    <Text variant="caption" muted style={styles.more}>
                      {t('inbox.template.more')}
                    </Text>
                  ) : null}
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

function TemplateRow({
  template,
  busy,
  onPress,
}: {
  template: InboxTemplateOption;
  busy: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const reason = template.reason ? t(`inbox.template.reason.${template.reason}`) : null;
  const meta = [template.language, template.category].join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={template.name}
      accessibilityHint={reason ?? undefined}
      accessibilityState={{ disabled: !template.sendable || busy }}
      disabled={!template.sendable || busy}
      onPress={onPress}
      style={[styles.row, { borderBottomColor: colors.border }, !template.sendable && styles.faded]}
    >
      <Text variant="label">{template.name}</Text>
      <Text variant="caption" muted numberOfLines={2}>
        {template.body}
      </Text>
      <Text variant="caption" muted>
        {meta}
      </Text>
      {reason ? (
        <Text variant="caption" danger>
          {reason}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '85%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.lg },
  title: { flex: 1 },
  close: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { padding: spacing.lg, gap: spacing.lg },
  form: { gap: spacing.md },
  row: {
    minHeight: MIN_TOUCH_TARGET,
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  faded: { opacity: 0.55 },
  more: { paddingTop: spacing.md },
});
