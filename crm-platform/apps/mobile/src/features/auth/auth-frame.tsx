import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { BrandFrame } from '@/components/ui/brand-frame';
import { BrandMark } from '@/components/ui/brand-mark';
import { FadeIn } from '@/components/ui/fade-in';
import { Text } from '@/components/ui/text';
import { spacing } from '@/lib/theme/tokens';

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

/** The frame of the signed-out screens: the brand band with the logo and the page's main line, and the cards under it. */
export function AuthFrame({ brandName, tagline, caption, compact, onBack, children }: Props) {
  return (
    <BrandFrame
      compact={compact}
      onBack={onBack}
      header={
        <FadeIn style={styles.bandText}>
          <View style={styles.brand}>
            <BrandMark size={compact ? 44 : 56} />
            {brandName ? (
              <Text variant="heading" color="onBrand" numberOfLines={1} style={styles.brandName}>
                {brandName}
              </Text>
            ) : null}
          </View>
          <Text variant={compact ? 'title' : 'display'} color="onBrand" accessibilityRole="header">
            {tagline}
          </Text>
          {caption ? <Text color="onBrandMuted">{caption}</Text> : null}
        </FadeIn>
      }
    >
      {children}
    </BrandFrame>
  );
}

const styles = StyleSheet.create({
  bandText: { gap: spacing.lg },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  brandName: { flexShrink: 1 },
});
