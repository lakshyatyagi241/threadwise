import type { ConversationTag } from '@crm/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
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
import { useChangeLabels, useLabelLibrary } from './use-labels';

interface Props {
  visible: boolean;
  conversationId: string;
  /** The labels the conversation has now. */
  applied: readonly ConversationTag[];
  /** The person may also make a new label by typing its name (`inbox.tag.manage`). */
  canCreate: boolean;
  onClose: () => void;
}

/** The sheet that opens from "Assign labels": every label of the workspace, ticked for the ones this conversation has. */
export function LabelsSheet({ visible, conversationId, applied, canCreate, onClose }: Props) {
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      {/* Only mounted while open, so the lists are asked for when the sheet opens. */}
      <SheetBody
        conversationId={conversationId}
        applied={applied}
        canCreate={canCreate}
        onClose={onClose}
      />
    </Modal>
  );
}

function SheetBody({ conversationId, applied, canCreate, onClose }: Omit<Props, 'visible'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const library = useLabelLibrary(true);
  const { attach, detach } = useChangeLabels(conversationId);
  const [name, setName] = useState('');
  const [failed, setFailed] = useState<string | null>(null);

  const has = new Set(applied.map((label) => label.id));
  const busy = attach.isPending || detach.isPending;
  const loading = library.isPending;
  const loadError = library.error;

  const toggle = (tagId: string) => {
    setFailed(null);
    const done = { onError: () => setFailed(t('inbox.thread.labels.failed')) };
    if (has.has(tagId)) detach.mutate(tagId, done);
    else attach.mutate({ tagId }, done);
  };
  const add = () => {
    const label = name.trim();
    if (!label) return;
    setFailed(null);
    attach.mutate(
      { name: label },
      {
        onSuccess: () => setName(''),
        onError: () => setFailed(t('inbox.thread.labels.failed')),
      },
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      // A sheet is a modal window, which the phone does not resize for the keyboard (Android leaves it under the keys), so the sheet
      // lifts itself: padding on both platforms.
      behavior="padding"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('inbox.thread.labels.close')}
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
            {t('inbox.thread.labels.title')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('inbox.thread.labels.close')}
            onPress={onClose}
            style={styles.close}
          >
            <Icon name="close" size={24} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {failed ? <Banner tone="danger" message={failed} /> : null}
          {loading ? (
            <ActivityIndicator accessibilityLabel={t('common.loading')} />
          ) : loadError ? (
            <View>
              <Banner tone="danger" message={messageForError(loadError, t)} />
              <Button
                variant="link"
                align="start"
                label={t('common.retry')}
                onPress={() => void library.refetch()}
              />
            </View>
          ) : (library.data ?? []).length === 0 ? (
            <Text muted>
              {canCreate ? t('inbox.thread.labels.emptyCreate') : t('inbox.thread.labels.empty')}
            </Text>
          ) : (
            <View>
              {(library.data ?? []).map((tag) => {
                const checked = has.has(tag.id);
                return (
                  <Pressable
                    key={tag.id}
                    accessibilityRole="checkbox"
                    accessibilityLabel={tag.name}
                    accessibilityState={{ checked, disabled: busy }}
                    disabled={busy}
                    onPress={() => toggle(tag.id)}
                    style={[styles.row, { borderBottomColor: colors.border }]}
                  >
                    <Text variant={checked ? 'label' : 'body'} style={styles.rowText}>
                      {tag.name}
                    </Text>
                    {checked ? <Icon name="checkmark" size={20} color="primary" /> : null}
                  </Pressable>
                );
              })}
            </View>
          )}
          {canCreate ? (
            <View style={styles.add}>
              <View style={styles.addField}>
                <TextField
                  label={t('inbox.thread.labels.newLabel')}
                  value={name}
                  onChangeText={setName}
                  onSubmitEditing={add}
                  returnKeyType="done"
                  autoCapitalize="words"
                />
              </View>
              <Button
                label={t('inbox.thread.labels.add')}
                loading={attach.isPending}
                disabled={name.trim() === ''}
                onPress={add}
              />
            </View>
          ) : null}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
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
  row: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1 },
  add: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  addField: { flex: 1 },
});
