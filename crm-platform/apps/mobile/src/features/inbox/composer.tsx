import { MESSAGE_BODY_MAX, NOTE_BODY_MAX } from '@crm/contracts';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { TextField, type TextFieldHandle } from '@/components/ui/text-field';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { EmojiSheet } from './emoji-sheet';
import { FormatBar } from './format-bar';
import {
  activeFormats,
  toggleList,
  toggleMark,
  toggleUnderline,
  type Edit,
  type Mark,
} from './format-text';

interface Selection {
  start: number;
  end: number;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  /** A reply goes to the customer; a note stays inside the team (a warm box, "Add note"). */
  mode?: 'reply' | 'note';
  /** The note is on its way: the button waits. */
  busy?: boolean;
  /** Opens the saved replies; the button shows only when this is given (replies only). */
  onOpenReplies?: () => void;
  /** Opens the attach sheet (photo, camera, document); the paperclip shows only when this is given (replies only). */
  onOpenAttach?: () => void;
  /** Opens the template list (a template can be sent inside the 24-hour window too); the button shows only when this is given (replies only). */
  onOpenTemplates?: () => void;
  /** Opens the Smart AI Assistant (condense, fix grammar, positive tone, translate); the sparkle shows only when this is given (replies only). */
  onOpenAi?: () => void;
}

/**
 * The box at the bottom of a thread. Sending is possible only for a non-empty text within the length limit. In reply mode a
 * lightning-bolt button opens the saved replies, a paperclip the attach sheet (photo, camera, document), a document button the template list, a
 * smile the emoji sheet and a sparkle the Smart AI Assistant; a row of formatting buttons (bold, italic, underline, strikethrough, bullets,
 * numbers) writes WhatsApp's marks into the text at the caret or round the selection. In note mode the box is tinted, has none of those
 * and the button says "Add note".
 */
export function Composer({
  value,
  onChange,
  onSend,
  mode = 'reply',
  busy,
  onOpenReplies,
  onOpenAttach,
  onOpenTemplates,
  onOpenAi,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const note = mode === 'note';
  const input = useRef<TextFieldHandle>(null);
  // Where the caret or selection is; `pending` is set only to move it after a button changed the text, and cleared once the box has.
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  const [pending, setPending] = useState<Selection | undefined>();
  const [emojiOpen, setEmojiOpen] = useState(false);
  const max = note ? NOTE_BODY_MAX : MESSAGE_BODY_MAX;
  const trimmed = value.trim();
  const tooLong = trimmed.length > max;
  const canSend = trimmed.length > 0 && !tooLong;
  // The tool buttons sit in their own row under the box: five controls in one row left the box about 60 dp wide on a phone.
  const at = {
    start: Math.min(selection.start, value.length),
    end: Math.min(selection.end, value.length),
  };
  const active = activeFormats(value, at.start, at.end);
  // An edit that would push the text over the limit is dropped, as the web does.
  const apply = (edit: Edit) => {
    if (edit.text.length > max) return;
    onChange(edit.text);
    const next = { start: edit.start, end: edit.end };
    setSelection(next);
    setPending(next);
    input.current?.focus();
  };
  const insertEmoji = (emoji: string) =>
    apply({
      text: value.slice(0, at.start) + emoji + value.slice(at.end),
      start: at.start + emoji.length,
      end: at.start + emoji.length,
    });
  const hasTools = !note;
  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: note ? colors.warningSoft : colors.surface,
          borderTopColor: colors.border,
          paddingBottom: insets.bottom + spacing.sm,
        },
      ]}
    >
      <View style={styles.inputRow}>
        <View style={styles.field}>
          <TextField
            label={note ? t('inbox.composer.noteLabel') : t('inbox.composer.label')}
            placeholder={
              note ? t('inbox.composer.notePlaceholder') : t('inbox.composer.placeholder')
            }
            value={value}
            onChangeText={onChange}
            inputRef={input}
            selection={pending}
            onSelectionChange={(e) => {
              setSelection(e.nativeEvent.selection);
              setPending(undefined);
            }}
            multiline
            error={
              tooLong
                ? note
                  ? t('inbox.details.notes.tooLong', { max })
                  : t('inbox.composer.tooLong', { max })
                : null
            }
          />
        </View>
        <Button
          label={note ? t('inbox.composer.addNote') : t('inbox.composer.send')}
          loading={busy}
          onPress={onSend}
          disabled={!canSend}
        />
      </View>
      {!note ? (
        <FormatBar
          active={active}
          onMark={(mark: Mark) => apply(toggleMark(value, at.start, at.end, mark))}
          onUnderline={() => apply(toggleUnderline(value, at.start, at.end))}
          onList={(kind) => apply(toggleList(value, at.start, at.end, kind))}
        />
      ) : null}
      {hasTools ? (
        <View style={styles.tools}>
          {!note && onOpenReplies ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('inbox.replies.open')}
              onPress={onOpenReplies}
              style={styles.tool}
            >
              <Icon name="flash-outline" size={24} color="primary" />
            </Pressable>
          ) : null}
          {!note && onOpenAttach ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('inbox.attach.open')}
              onPress={onOpenAttach}
              style={styles.tool}
            >
              <Icon name="attach" size={24} color="primary" />
            </Pressable>
          ) : null}
          {!note && onOpenTemplates ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('inbox.template.send')}
              onPress={onOpenTemplates}
              style={styles.tool}
            >
              <Icon name="document-text-outline" size={24} color="primary" />
            </Pressable>
          ) : null}
          {!note ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('inbox.composer.emoji.open')}
              onPress={() => setEmojiOpen(true)}
              style={styles.tool}
            >
              <Icon name="happy-outline" size={24} color="primary" />
            </Pressable>
          ) : null}
          {!note && onOpenAi ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('inbox.ai.open')}
              onPress={onOpenAi}
              style={styles.tool}
            >
              <Icon name="sparkles-outline" size={24} color="primary" />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {!note ? (
        <EmojiSheet visible={emojiOpen} onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  field: { flex: 1 },
  tools: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tool: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
