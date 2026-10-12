import { StyleSheet, View } from 'react-native';
import { spacing } from '@/lib/theme/tokens';
import { Icon, type IconName } from './icon';
import { Text } from './text';

interface Props {
  icon: IconName;
  title: string;
  hint?: string;
}

/** What a list shows when there is nothing to list: a quiet icon, a sentence, and what to do next. */
export function EmptyState({ icon, title, hint }: Props) {
  return (
    <View style={styles.wrap} accessible accessibilityRole="text">
      <Icon name={icon} size={48} color="textMuted" />
      <Text variant="heading" style={styles.center}>
        {title}
      </Text>
      {hint ? (
        <Text muted style={styles.center}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.sm, padding: spacing.xxl },
  center: { textAlign: 'center' },
});
