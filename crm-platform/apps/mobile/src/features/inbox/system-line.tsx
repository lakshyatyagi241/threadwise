import type { MessageResponse } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { botLineKeys } from './handoff-lines';

/**
 * What a system message says. The "Bot is back" line is worded in the reader's language from what happened (who gave it back, and
 * whether the flow continues or the bot answers the next message); every other system line (a consent change, an automatic stage
 * move) is the server's own text, which is English.
 */
export function systemLineText(
  message: Pick<MessageResponse, 'body' | 'systemEvent'>,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const event = message.systemEvent;
  if (event?.event === 'bot_returned') {
    const name = event.by ?? t('inbox.handoff.botLine.system');
    const text = botLineKeys(event)
      .map((key) => t(`inbox.handoff.botLine.${key}`, { name }))
      .join(' ')
      .trim();
    if (text) return text;
  }
  return message.body ?? '';
}

/**
 * A system message in the thread (the bot is back, a consent change...): a small centred line for the team, not a bubble on the
 * customer's side, as the web inbox draws it. Nothing is drawn for an empty one.
 */
export function SystemLine({ message }: { message: MessageResponse }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const text = systemLineText(message, t as never);
  if (text === '') return null;
  return (
    <View testID={`message-${message.seq}`} style={styles.row}>
      <View
        accessible
        accessibilityLabel={text}
        style={[styles.pill, { backgroundColor: colors.surfaceMuted }]}
      >
        <Text variant="caption" muted style={styles.text}>
          {text}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  pill: {
    maxWidth: '85%',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  text: { textAlign: 'center' },
});
