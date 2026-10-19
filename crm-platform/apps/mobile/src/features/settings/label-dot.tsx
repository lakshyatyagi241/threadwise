import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/lib/theme/use-theme';
import { safeLabelColor } from './label-color';

/** A label's colour as a round dot. The colour is the person's own choice, drawn only when it is one the phone can draw. */
export function LabelDot({ color, size = 16 }: { color: string | null; size?: number }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.dot,
        { width: size, height: size, borderRadius: size / 2, borderColor: colors.border },
        { backgroundColor: safeLabelColor(color) },
      ]}
    />
  );
}

const styles = StyleSheet.create({ dot: { borderWidth: StyleSheet.hairlineWidth } });
