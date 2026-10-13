import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

interface Props {
  /** The person may take the conversation (claim it); without that the bar only says who has it. */
  canAssign: boolean;
  assigning: boolean;
  onAssign: () => void;
}

/**
 * What stands in the place of the message box while an AI agent has the conversation: it says so, and offers to take the
 * conversation over. Once a person has it, the box comes back.
 */
export function BotBar({ canAssign, assigning, onAssign }: Props) {
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
      {canAssign ? (
        <Button
          variant="secondary"
          label={t('inbox.thread.bot.assignSelf')}
          loading={assigning}
          onPress={onAssign}
        />
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
});
