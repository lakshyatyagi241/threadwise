import { MESSAGE_BODY_MAX, NOTE_BODY_MAX } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { TextField } from '@/components/ui/text-field';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

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
}

/**
 * The box at the bottom of a thread. Sending is possible only for a non-empty text within the length limit. In reply mode a
 * lightning-bolt button opens the saved replies; in note mode the box is tinted and the button says "Add note".
 */
export function Composer({ value, onChange, onSend, mode = 'reply', busy, onOpenReplies }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const note = mode === 'note';
  const max = note ? NOTE_BODY_MAX : MESSAGE_BODY_MAX;
  const trimmed = value.trim();
  const tooLong = trimmed.length > max;
  const canSend = trimmed.length > 0 && !tooLong;
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
      <View style={styles.field}>
        <TextField
          label={note ? t('inbox.composer.noteLabel') : t('inbox.composer.label')}
          placeholder={note ? t('inbox.composer.notePlaceholder') : t('inbox.composer.placeholder')}
          value={value}
          onChangeText={onChange}
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
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  field: { flex: 1 },
  tool: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
