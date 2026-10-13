import { Image, StyleSheet, View } from 'react-native';
import { useTheme } from '@/lib/theme/use-theme';
import logo from '@/assets/images/logo.png';

/**
 * The GetaDesk logo on a white tile, so it reads on the deep-blue band of the sign-in screens. Decorative: the product name is
 * written next to it, so screen readers skip it.
 */
export function BrandMark({ size = 56 }: { size?: number }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: size * 0.3, backgroundColor: colors.onBrand },
      ]}
    >
      <Image
        testID="brand-logo"
        source={logo}
        style={{ width: size * 0.78, height: size * 0.78 }}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center' },
});
