import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { MASKED, NO_VALUE, type PropertyRow } from './property-values';

/** One property: its name above its value (dashes when empty), with a pencil when the person may edit it and the row can be edited. */
export function PropertyRowView({
  row,
  tappable,
  onPress,
}: {
  row: PropertyRow;
  tappable: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const value = row.text ?? NO_VALUE;
  // Dots are not words: a screen reader says that the value is hidden instead of reading six bullets.
  const spoken = `${row.label}: ${row.text === MASKED ? t('contactProps.masked') : value}`;
  const editable = row.edit.kind !== 'locked';
  const content = (
    <>
      <View style={styles.rowText}>
        <Text variant="caption" muted>
          {row.label}
        </Text>
        <Text muted={row.text === null}>{value}</Text>
      </View>
      {tappable && editable ? <Icon name="create-outline" size={20} color="primary" /> : null}
    </>
  );
  if (!tappable) {
    return (
      <View
        accessible
        accessibilityLabel={spoken}
        style={[styles.row, { borderBottomColor: colors.border }]}
      >
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint={editable ? t('contactProps.rowHint') : undefined}
      onPress={onPress}
      style={[styles.row, { borderBottomColor: colors.border }]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, gap: spacing.xs },
});
