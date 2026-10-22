import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

interface Props {
  /**
   * `answering`: the bot has the conversation (nothing to press; the Bot label says who answers). `return`: a person has it, or it
   * waits for one, and the cell gives it back to the bot.
   */
  mode: 'answering' | 'return';
  busy: boolean;
  onReturn: () => void;
}

/**
 * The Bot cell next to "Assign labels" under the thread header, as in the Geta app: it shows that the bot is answering this
 * conversation, or, while a person holds it (or it waits in the queue), offers "Return to bot" (`inbox.conversation.reply`), the web
 * handoff bar's button. Nothing is drawn for a conversation no bot ever handled.
 */
export function BotTab({ mode, busy, onReturn }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const label = mode === 'return' ? t('inbox.thread.bot.returnToBot') : t('inbox.thread.bot.tab');
  const body = (
    <>
      {busy ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <Icon
          name="hardware-chip-outline"
          size={20}
          color={mode === 'return' ? 'primary' : 'textMuted'}
        />
      )}
      <Text
        variant="label"
        color={mode === 'return' ? 'text' : 'textMuted'}
        numberOfLines={1}
        style={styles.text}
      >
        {label}
      </Text>
    </>
  );
  const frame = [styles.cell, { borderStartColor: colors.border }];
  if (mode === 'answering') {
    return (
      <View accessible accessibilityLabel={t('inbox.thread.bot.answering')} style={frame}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onReturn}
      style={frame}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cell: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderStartWidth: StyleSheet.hairlineWidth,
  },
  text: { flexShrink: 1 },
});
