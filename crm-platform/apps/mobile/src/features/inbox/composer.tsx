import { MESSAGE_BODY_MAX, NOTE_BODY_MAX } from '@crm/contracts';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { TextField, type TextFieldHandle } from '@/components/ui/text-field';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { EmojiSheet } from './emoji-sheet';
import { FormatBar } from './format-bar';
import { composerRuns } from './marked-text';
import {
  activeFormats,
  dropEmptyMarks,
  followEdit,
  isEmptyPair,
  toggleList,
  toggleMark,
  toggleUnderline,
  type Armed,
  type Edit,
  type Mark,
} from './format-text';
import { NoteToggle, type ComposerMode } from './note-toggle';

interface Selection {
  start: number;
  end: number;
}

/** What the thread screen can ask of the box: the "+" sheet has an Emoji row, and an emoji goes in at the caret. */
export interface ComposerHandle {
  openEmoji: () => void;
}

/** The send button: a filled circle, as in the Geta app. */
const SEND_SIZE = MIN_TOUCH_TARGET;

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  /** A reply goes to the customer; a note stays inside the team (a warm bar, "Add note"). */
  mode?: ComposerMode;
  /** The note is on its way: the button waits. */
  busy?: boolean;
  /** Opens the "+" sheet (attach a file, saved replies, template, emoji); the plus shows only when this is given (replies only). */
  onOpenPlus?: () => void;
  /** Opens the Smart AI Assistant (condense, fix grammar, positive tone, translate); the sparkle shows only when this is given (replies only). */
  onOpenAi?: () => void;
  /** Switches between a reply and an internal note (the bubble with a lock); the button shows only when this is given. */
  onToggleNote?: () => void;
  handleRef?: RefObject<ComposerHandle | null>;
}

/**
 * The bar at the bottom of a thread, laid out like the Geta app's: one rounded bar holding the "+" (attach a file, saved replies, a
 * template, an emoji), the text box, the sparkle (Smart AI Assistant) and the bubble with a lock (internal note), then the round send
 * button. Sending is possible only for a non-empty text within the length limit. While the box has focus a row of formatting buttons
 * (bold, italic, underline, strikethrough, bullets, numbers) shows above it and writes WhatsApp's marks into the text. In note mode
 * the bar is tinted warm, the box is for the team only, and the button says "Add note".
 */
export function Composer({
  value,
  onChange,
  onSend,
  mode = 'reply',
  busy,
  onOpenPlus,
  onOpenAi,
  onToggleNote,
  handleRef,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const note = mode === 'note';
  const input = useRef<TextFieldHandle>(null);
  // Where the caret or selection is; `pending` is set only to move it after a button changed the text, and cleared once the box has.
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  const [pending, setPending] = useState<Selection | undefined>();
  const [focused, setFocused] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  // The pair of marks a formatting button put at the caret and that is still "on": what is typed right after it goes inside it (see
  // `followEdit`). While it holds nothing it is drawn hidden; it is taken out again if the box loses focus with nothing typed in it.
  const [armed, setArmed] = useState<Armed | null>(null);
  const max = note ? NOTE_BODY_MAX : MESSAGE_BODY_MAX;
  const trimmed = dropEmptyMarks(value).trim();
  const tooLong = trimmed.length > max;
  const canSend = trimmed.length > 0 && !tooLong && !busy;
  const at = {
    start: Math.min(selection.start, value.length),
    end: Math.min(selection.end, value.length),
  };
  const real = activeFormats(value, at.start, at.end);
  const active = {
    ...real,
    bold: real.bold || armed?.mark === '*',
    italic: real.italic || armed?.mark === '_',
    strike: real.strike || armed?.mark === '~',
  };
  // An edit that would push the text over the limit is dropped, as the web does.
  const apply = (edit: Edit) => {
    if (edit.text.length > max) return;
    onChange(edit.text);
    // A pair put at the caret with nothing inside it (two characters longer, caret between them): it is now "on".
    const born =
      edit.start === edit.end &&
      edit.text.length === value.length + 2 &&
      isEmptyPair(edit.text.slice(edit.start - 1, edit.start + 1));
    setArmed(
      born
        ? { start: edit.start - 1, end: edit.start + 1, mark: edit.text[edit.start - 1] as Mark }
        : null,
    );
    const next = { start: edit.start, end: edit.end };
    setSelection(next);
    setPending(next);
    input.current?.focus();
  };
  // Takes the pair out of the text when the box loses focus with nothing typed in it, and ends it either way.
  const endArmed = () => {
    if (
      armed &&
      armed.end - armed.start === 2 &&
      isEmptyPair(value.slice(armed.start, armed.end))
    ) {
      onChange(value.slice(0, armed.start) + value.slice(armed.end));
    }
    setArmed(null);
  };
  // Pressing the same button again while it is "on" ends it: what is typed next is plain.
  const pressMark = (mark: Mark) => {
    if (armed && armed.mark === mark) {
      endArmed();
      return;
    }
    apply(toggleMark(value, at.start, at.end, mark));
  };
  const insertEmoji = (emoji: string) =>
    apply({
      text: value.slice(0, at.start) + emoji + value.slice(at.end),
      start: at.start + emoji.length,
      end: at.start + emoji.length,
    });
  // The "+" sheet's Emoji row asks for the emoji sheet through this handle.
  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = { openEmoji: () => setEmojiOpen(true) };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef]);

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          paddingBottom: insets.bottom + spacing.sm,
        },
      ]}
    >
      {tooLong ? (
        <Text variant="caption" danger accessibilityRole="alert">
          {note ? t('inbox.details.notes.tooLong', { max }) : t('inbox.composer.tooLong', { max })}
        </Text>
      ) : null}
      <View style={styles.row}>
        <View
          style={[
            styles.pill,
            { backgroundColor: note ? colors.warningSoft : colors.surfaceMuted },
          ]}
        >
          {!note && onOpenPlus ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('inbox.attach.open')}
              onPress={onOpenPlus}
              style={styles.tool}
            >
              <Icon name="add-circle-outline" size={28} color="primary" />
            </Pressable>
          ) : null}
          <View style={[styles.field, (note || !onOpenPlus) && styles.fieldFirst]}>
            <TextField
              bare
              label={note ? t('inbox.composer.noteLabel') : t('inbox.composer.label')}
              placeholder={
                note ? t('inbox.composer.notePlaceholder') : t('inbox.composer.placeholder')
              }
              onChangeText={(text) => {
                const out = followEdit(value, text, armed);
                setArmed(out.armed);
                onChange(out.text);
              }}
              inputRef={input}
              selection={pending}
              onSelectionChange={(e) => {
                setSelection(e.nativeEvent.selection);
                setPending(undefined);
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => {
                setFocused(false);
                endArmed();
              }}
              multiline
            >
              {/* The words drawn as they will look (bold, italic, struck through); the marks stay in the text but are not visible.
                  React Native takes the text of a styled input from its children, so there is no `value`. */}
              {value === ''
                ? undefined
                : composerRuns(value, armed && armed.end - armed.start === 2 ? armed.start : null)}
            </TextField>
          </View>
          {!note && onOpenAi ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('inbox.ai.open')}
              onPress={onOpenAi}
              style={styles.tool}
            >
              <Icon name="sparkles" size={24} color="primary" />
            </Pressable>
          ) : null}
          {onToggleNote ? <NoteToggle mode={mode} onToggle={onToggleNote} /> : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={note ? t('inbox.composer.addNote') : t('inbox.composer.send')}
          accessibilityState={{ disabled: !canSend, busy: Boolean(busy) }}
          disabled={!canSend}
          onPress={onSend}
          style={[
            styles.send,
            { backgroundColor: colors.action },
            !canSend && !busy && styles.sendOff,
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.onAction} />
          ) : (
            <Icon name="send" size={22} color="onAction" />
          )}
        </Pressable>
      </View>
      {/* Under the box, not over it: Android opens its own Cut / Copy / Paste bar above a selected word, and over the buttons it would take their taps. */}
      {!note && focused ? (
        <FormatBar
          active={active}
          onMark={pressMark}
          onUnderline={() => apply(toggleUnderline(value, at.start, at.end))}
          onList={(kind) => apply(toggleList(value, at.start, at.end, kind))}
        />
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
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: radius.xl,
    paddingHorizontal: spacing.xs,
  },
  field: { flex: 1, maxHeight: 132, justifyContent: 'center' },
  fieldFirst: { paddingStart: spacing.md },
  tool: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  send: {
    width: SEND_SIZE,
    height: SEND_SIZE,
    borderRadius: SEND_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: { opacity: 0.4 },
});
