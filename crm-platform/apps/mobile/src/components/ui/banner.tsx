import { StyleSheet, View } from 'react-native';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { FadeIn } from './fade-in';
import { Text } from './text';

interface Props {
  tone: 'danger' | 'warning' | 'info';
  message: string;
  testID?: string;
}

/**
 * A message about the whole screen rather than one field: a failed request, a notice that sign-up is not possible. A coloured
 * bar and a soft background (never colour alone: the words say what is wrong), announced to screen readers when it appears, and
 * eased in so it is noticed without a jolt.
 */
export function Banner({ tone, message, testID }: Props) {
  const { colors } = useTheme();
  const strong =
    tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : colors.primary;
  const soft =
    tone === 'danger'
      ? colors.dangerSoft
      : tone === 'warning'
        ? colors.warningSoft
        : colors.primarySoft;
  return (
    <FadeIn>
      <View
        testID={testID}
        accessible
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.box, { backgroundColor: soft }]}
      >
        <View style={[styles.bar, { backgroundColor: strong }]} />
        <Text variant="label" style={[styles.text, { color: strong }]}>
          {message}
        </Text>
      </View>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', borderRadius: radius.md, overflow: 'hidden' },
  bar: { width: 4 },
  text: { flex: 1, padding: spacing.md, fontWeight: '500', lineHeight: 20 },
});
