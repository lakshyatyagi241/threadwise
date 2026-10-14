import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Avatar } from '@/components/ui/avatar';
import { Text } from '@/components/ui/text';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

interface Props {
  name: string;
  /** The phone or the email, under the name; omitted when there is neither. */
  line: string | null;
  style?: StyleProp<ViewStyle>;
}

/**
 * Who the contact is, on the same deep band the sign-in screens use (`colors.brand`, curved lower edge): the photo, the name
 * and how to reach them. The lifecycle stage, status and score sit in the card directly under it, not painted on the band
 * itself, so the band stays the identity strip and the facts stay in the app's one card style.
 */
export function ContactHero({ name, line, style }: Props) {
  const { colors } = useTheme();
  return (
    <View style={[styles.band, { backgroundColor: colors.brand }, style]}>
      <Avatar name={name} size={72} />
      <Text
        variant="title"
        color="onBrand"
        accessibilityRole="header"
        numberOfLines={1}
        style={styles.center}
      >
        {name}
      </Text>
      {line ? (
        <Text color="onBrandMuted" numberOfLines={1} style={styles.center}>
          {line}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  center: { textAlign: 'center' },
});
