import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

interface Props {
  onOpen: () => void;
}

/**
 * What sits under a thread whose 24-hour reply window is closed, in place of the message box (WhatsApp allows only an approved
 * template to a customer who has not written in the last 24 hours): the reason, and the button that opens the template list.
 */
export function TemplateBar({ onOpen }: Props) {
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
        {t('inbox.template.closedNotice')}
      </Text>
      <Button variant="secondary" label={t('inbox.template.send')} onPress={onOpen} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  notice: { textAlign: 'center' },
});
