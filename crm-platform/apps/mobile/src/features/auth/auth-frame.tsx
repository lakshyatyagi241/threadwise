import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  I18nManager,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandMark } from '@/components/ui/brand-mark';
import { FadeIn } from '@/components/ui/fade-in';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

/** The back arrow points at the start of the line, which is the right in right-to-left languages. */
const CHEVRON_TURN = I18nManager.isRTL ? '-45deg' : '45deg';

/** How far the first card reaches up over the bottom edge of the band. */
const OVERLAP = spacing.xxl + spacing.md;

interface Props {
  /** The product name, once the platform settings are known. */
  brandName?: string;
  /** The page's main line, in the band. */
  tagline: string;
  caption?: string;
  /** A shorter band, for screens with a lot of cards under it, so more of them are on screen. */
  compact?: boolean;
  /** Shows a back arrow in the band. */
  onBack?: () => void;
  /** Cards. The first one overlaps the band, so start with a card, not with loose text. */
  children: ReactNode;
}

/**
 * The frame of the signed-out screens: a deep band with a curved lower edge that holds the logo and the page's main line, and,
 * below it, the page: cards that float up over the band. The band reaches behind the status bar, the page carries the bottom
 * inset, and the whole thing scrolls so a large font size or an open keyboard never hides a field.
 */
export function AuthFrame({ brandName, tagline, caption, compact, onBack, children }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          bounces={false}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
        >
          <View
            style={[
              styles.band,
              {
                backgroundColor: colors.brand,
                paddingTop: insets.top + spacing.md,
                paddingBottom: (compact ? spacing.lg : spacing.xxl) + OVERLAP,
              },
            ]}
          >
            {/* Two soft circles behind the text: depth without an image. Decorative, so they take no touches and no screen reader focus. */}
            <View
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={StyleSheet.absoluteFill}
            >
              <View
                style={[styles.circle, styles.circleLarge, { backgroundColor: colors.primary }]}
              />
              <View
                style={[styles.circle, styles.circleSmall, { backgroundColor: colors.brandAccent }]}
              />
            </View>
            {onBack ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.back')}
                onPress={onBack}
                style={styles.back}
              >
                <View
                  style={[
                    styles.chevron,
                    { borderColor: colors.onBrand, transform: [{ rotate: CHEVRON_TURN }] },
                  ]}
                />
              </Pressable>
            ) : null}
            <FadeIn style={styles.bandText}>
              <View style={styles.brand}>
                <BrandMark size={compact ? 44 : 56} />
                {brandName ? (
                  <Text
                    variant="heading"
                    color="onBrand"
                    numberOfLines={1}
                    style={styles.brandName}
                  >
                    {brandName}
                  </Text>
                ) : null}
              </View>
              <Text variant={compact ? 'title' : 'display'} color="onBrand" accessibilityRole="header">
                {tagline}
              </Text>
              {caption ? <Text color="onBrandMuted">{caption}</Text> : null}
            </FadeIn>
          </View>
          <View style={[styles.page, { paddingBottom: insets.bottom + spacing.xl }]}>
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      {/* Keeps the clock and battery icons on the brand colour when the page is scrolled up behind them. */}
      <View
        pointerEvents="none"
        style={[styles.statusBar, { height: insets.top, backgroundColor: colors.brand }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1 },
  statusBar: { position: 'absolute', top: 0, start: 0, end: 0 },
  band: {
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
    overflow: 'hidden',
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  bandText: { gap: spacing.lg },
  circle: { position: 'absolute', borderRadius: radius.pill },
  circleLarge: { width: 280, height: 280, top: -110, end: -90, opacity: 0.35 },
  circleSmall: { width: 120, height: 120, bottom: -10, end: 50, opacity: 0.14 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  brandName: { flexShrink: 1 },
  back: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    marginStart: -spacing.md,
    marginBottom: -spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A chevron made of two borders. The start border flips in right-to-left languages but a rotation does not, so the turn follows too.
  chevron: { width: 12, height: 12, borderStartWidth: 2.5, borderBottomWidth: 2.5 },
  page: {
    flexGrow: 1,
    marginTop: -OVERLAP,
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
});
