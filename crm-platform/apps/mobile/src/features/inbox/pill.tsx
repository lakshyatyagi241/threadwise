import { StyleSheet, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

/** A small grey tag in a row: who has the conversation, or which channel it came in on. */
export function Pill({ label, icon }: { label: string; icon?: IconName }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.pill, { backgroundColor: colors.surfaceMuted }]}>
      {icon ? <Icon name={icon} size={12} color="textMuted" /> : null}
      <Text variant="caption" muted numberOfLines={1} style={styles.text}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    maxWidth: 160,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  text: { flexShrink: 1 },
});
