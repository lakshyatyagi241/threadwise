import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

interface Props {
  onOpen: () => void;
}

/**
 * What sits under a thread whose 24-hour reply window is closed, in place of the message box (WhatsApp allows only an approved
 * template to a customer who has not written in the last 24 hours): the reason, and the button that opens the template list. The
 * button is a quiet filled bar (muted fill, blue label, no border) like the reference app's, not a big outlined one, so it does not
 * take the place of the thread.
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('inbox.template.send')}
        onPress={onOpen}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: colors.surfaceMuted, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Text variant="label" style={[styles.label, { color: colors.primary }]}>
          {t('inbox.template.send')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  notice: { textAlign: 'center' },
  button: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 16, lineHeight: 22 },
});
