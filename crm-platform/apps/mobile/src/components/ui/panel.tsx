import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { spacing } from '@/lib/theme/tokens';
import { Card } from './card';
import { Text } from './text';

interface Props {
  title: string;
  subtitle?: string;
  /** Something small beside the title: a badge, a count. */
  trailing?: ReactNode;
  testID?: string;
  children: ReactNode;
}

/** A card with a title (read out as a heading) and an optional line of explanation under it: the unit of the dashboard. */
export function Panel({ title, subtitle, trailing, testID, children }: Props) {
  return (
    <View testID={testID}>
      <Card>
        <View style={styles.header}>
          <View style={styles.titles}>
            <Text variant="subheading" accessibilityRole="header">
              {title}
            </Text>
            {subtitle ? (
              <Text variant="caption" muted>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {trailing}
        </View>
        {children}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  titles: { flex: 1, gap: spacing.xs },
});
