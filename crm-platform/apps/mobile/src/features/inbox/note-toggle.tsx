import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/ui/icon';
import { MIN_TOUCH_TARGET } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

export type ComposerMode = 'reply' | 'note';

interface Props {
  /** The mode being written in now: the button leads to the other one. */
  mode: ComposerMode;
  onToggle: () => void;
}

/**
 * The speech bubble with a lock, as in the Geta app, beside the message box: one tap turns the box into an internal note (it stays
 * inside the team, and can be written when the 24-hour window is closed), and in a note the same button goes back to replying. It is
 * named by where it leads ("Internal note", "Reply") and shows as pressed while a note is being written.
 */
export function NoteToggle({ mode, onToggle }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const note = mode === 'note';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={note ? t('inbox.composer.mode.reply') : t('inbox.composer.mode.note')}
      accessibilityState={{ selected: note }}
      onPress={onToggle}
      style={styles.target}
    >
      <View>
        <Icon name="chatbubble-ellipses-outline" size={26} color={note ? 'warning' : 'textMuted'} />
        <View
          style={[styles.lock, { backgroundColor: note ? colors.warningSoft : colors.surface }]}
        >
          <Icon name="lock-closed" size={10} color={note ? 'warning' : 'textMuted'} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lock: {
    position: 'absolute',
    top: -2,
    right: -4,
    borderRadius: 7,
    padding: 1,
  },
});
