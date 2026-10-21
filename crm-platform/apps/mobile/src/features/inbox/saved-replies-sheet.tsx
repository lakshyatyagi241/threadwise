import type { ChannelKind } from '@crm/contracts';
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
import { useFillSavedReply, useSavedReplies } from './use-saved-replies';
import { useDebouncedValue } from './use-debounced-value';

const SEARCH_DEBOUNCE_MS = 300;

interface Props {
  visible: boolean;
  conversationId: string;
  /** Replies restricted to other channels are left out. */
  channelKind: ChannelKind | undefined;
  /** Gets the reply filled in for this conversation, and the variables that could not be filled. */
  onInsert: (text: string, unfilled: string[]) => void;
  onClose: () => void;
}

/**
 * The picker behind the lightning-bolt button of the message box: the workspace's saved replies, searchable by shortcut, title or
 * words. Choosing one fills its variables in for this conversation and puts the text into the box; nothing is sent.
 */
export function SavedRepliesSheet(props: Props) {
  return (
    <Modal transparent visible={props.visible} animationType="slide" onRequestClose={props.onClose}>
      {/* Only mounted while open, so the list is asked for when the sheet opens. */}
      <SheetBody {...props} />
    </Modal>
  );
}

function SheetBody({ conversationId, channelKind, onInsert, onClose }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [typed, setTyped] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const debounced = useDebouncedValue(typed.trim(), SEARCH_DEBOUNCE_MS);
  // Emptying the box shows the full list straight away; only typing waits for a pause.
  const q = typed.trim() === '' ? '' : debounced;
  const replies = useSavedReplies(q, channelKind, true);
  const fill = useFillSavedReply(conversationId);
  const items = replies.data?.data ?? [];

  const choose = (id: string) => {
    setFailed(null);
    fill.mutate(id, {
      onSuccess: (filled) => {
        onInsert(
          filled.text,
          filled.issues.map((i) => i.token),
        );
        onClose();
      },
      onError: () => setFailed(t('inbox.replies.failed')),
    });
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
        accessibilityLabel={t('inbox.sheet.close')}
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
            {t('inbox.replies.title')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('inbox.sheet.close')}
            onPress={onClose}
            style={styles.close}
          >
            <Icon name="close" size={24} />
          </Pressable>
        </View>
        <View style={styles.search}>
          <TextField
            label={t('inbox.replies.search')}
            value={typed}
            onChangeText={setTyped}
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {failed ? <Banner tone="danger" message={failed} /> : null}
          {replies.isPending ? (
            <ActivityIndicator accessibilityLabel={t('common.loading')} />
          ) : replies.error && !replies.data ? (
            <View>
              <Banner tone="danger" message={messageForError(replies.error, t)} />
              <Button
                variant="link"
                align="start"
                label={t('common.retry')}
                onPress={() => void replies.refetch()}
              />
            </View>
          ) : items.length === 0 ? (
            <Text muted>
              {typed.trim() ? t('inbox.replies.noMatch') : t('inbox.replies.empty')}
            </Text>
          ) : (
            items.map((reply) => (
              <Pressable
                key={reply.id}
                accessibilityRole="button"
                accessibilityLabel={reply.title}
                accessibilityHint={reply.body}
                accessibilityState={{ disabled: fill.isPending, busy: fill.isPending }}
                disabled={fill.isPending}
                onPress={() => choose(reply.id)}
                style={[styles.row, { borderBottomColor: colors.border }]}
              >
                <View style={styles.rowTop}>
                  <Text variant="label" numberOfLines={1} style={styles.rowTitle}>
                    {reply.title}
                  </Text>
                  <Text variant="caption" muted>
                    {`/${reply.shortcut}`}
                  </Text>
                </View>
                <Text muted numberOfLines={2}>
                  {reply.body}
                </Text>
              </Pressable>
            ))
          )}
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
  search: { paddingHorizontal: spacing.lg },
  body: { padding: spacing.lg, gap: spacing.sm },
  row: {
    minHeight: MIN_TOUCH_TARGET,
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTitle: { flex: 1 },
});
