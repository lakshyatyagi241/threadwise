import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/lib/theme/use-theme';

/**
 * The app's logo tile: a speech bubble, drawn with views. A PLACEHOLDER until the real brand assets arrive (docs/mobile/backlog.md,
 * "Real brand assets and palette"); swap the body of this component for the real mark and every screen follows. Decorative: the
 * product name is written next to it, so screen readers skip it.
 */
export function BrandMark({ size = 56 }: { size?: number }) {
  const { colors } = useTheme();
  const bubbleWidth = size * 0.54;
  const bubbleHeight = size * 0.4;
  const tail = bubbleHeight * 0.3;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: size * 0.3, backgroundColor: colors.onBrand },
      ]}
    >
      <View
        style={[
          styles.bubble,
          {
            width: bubbleWidth,
            height: bubbleHeight,
            borderRadius: bubbleHeight * 0.36,
            backgroundColor: colors.primary,
            paddingStart: bubbleWidth * 0.2,
            gap: bubbleHeight * 0.16,
          },
        ]}
      >
        <View
          style={[styles.line, { width: bubbleWidth * 0.56, backgroundColor: colors.onPrimary }]}
        />
        <View
          style={[styles.line, { width: bubbleWidth * 0.34, backgroundColor: colors.onPrimary }]}
        />
        <View
          style={[
            styles.tail,
            {
              start: bubbleWidth * 0.14,
              bottom: -tail * 0.45,
              width: tail,
              height: tail,
              backgroundColor: colors.primary,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center' },
  bubble: { justifyContent: 'center' },
  line: { height: 3, borderRadius: 2 },
  tail: { position: 'absolute', transform: [{ rotate: '45deg' }] },
});
