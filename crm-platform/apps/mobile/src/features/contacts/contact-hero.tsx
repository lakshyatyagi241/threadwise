import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Avatar } from '@/components/ui/avatar';
import { Text } from '@/components/ui/text';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

interface Props {
  name: string;
  /** The phone or the email, under the name; omitted when there is neither. */
  line: string | null;
  /** What goes under the name on the band: the lifecycle stage, status and score. */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Who the contact is, on the same deep band the sign-in screens use (`colors.brand`, curved lower edge): the photo at the left, the
 * name and how to reach them beside it, and under them whatever the screen puts on the band (the lifecycle stage and status
 * dropdowns and the score), so the facts a person changes most are one tap from the top of the contact.
 */
export function ContactHero({ name, line, children, style }: Props) {
  const { colors } = useTheme();
  return (
    <View style={[styles.band, { backgroundColor: colors.brand }, style]}>
      <View style={styles.identity}>
        <Avatar name={name} size={72} />
        <View style={styles.names}>
          <Text variant="title" color="onBrand" accessibilityRole="header" numberOfLines={2}>
            {name}
          </Text>
          {line ? (
            <Text color="onBrandMuted" numberOfLines={1}>
              {line}
            </Text>
          ) : null}
        </View>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    gap: spacing.lg,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  names: { flex: 1, gap: spacing.xs },
});
