import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { NoteToggle } from './note-toggle';

interface Props {
  /** The person may take the conversation (claim it); without that the bar only says who has it. */
  canAssign: boolean;
  assigning: boolean;
  onAssign: () => void;
  /** Opens the internal note box; the bubble with a lock shows only when this is given. */
  onToggleNote?: () => void;
}

/**
 * What stands in the place of the message box while an AI agent has the conversation: it says so, and offers to take the
 * conversation over. Once a person has it, the box comes back.
 */
export function BotBar({ canAssign, assigning, onAssign, onToggleNote }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
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
      <Text muted style={styles.notice}>
        {t('inbox.thread.bot.notice')}
      </Text>
      {canAssign || onToggleNote ? (
        <View style={styles.actions}>
          {canAssign ? (
            <View style={styles.assign}>
              <Button
                variant="secondary"
                label={t('inbox.thread.bot.assignSelf')}
                loading={assigning}
                onPress={onAssign}
              />
            </View>
          ) : null}
          {onToggleNote ? <NoteToggle mode="reply" onToggle={onToggleNote} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  notice: { textAlign: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  assign: { flex: 1 },
});
