import { StyleSheet, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui/icon';
import type { ThemeColors } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

const SIZE = 18;
const RING = 2;

/** The mark of each channel kind: the glyph, and the theme colour of the disc behind it. */
const BADGES: Readonly<Record<string, { icon: IconName; color: keyof ThemeColors }>> = {
  whatsapp_cloud: { icon: 'logo-whatsapp', color: 'whatsapp' },
  whatsapp_qr: { icon: 'logo-whatsapp', color: 'whatsapp' },
  webchat: { icon: 'globe-outline', color: 'primary' },
  telegram: { icon: 'paper-plane', color: 'primary' },
  facebook: { icon: 'logo-facebook', color: 'primary' },
  instagram: { icon: 'logo-instagram', color: 'instagram' },
};
/** A channel kind this app has not heard of still gets a mark. */
const FALLBACK = { icon: 'chatbubble', color: 'textMuted' } as const;

/**
 * The small round mark on the corner of an avatar that says which channel a conversation came in on (WhatsApp, web chat...). It is
 * decorative: the channel is named in the thread itself, and the row already has its own spoken label. `ring` is the colour of
 * what the avatar sits on, so the disc looks cut out of it.
 */
export function ChannelBadge({ kind, ring }: { kind: string; ring: keyof ThemeColors }) {
  const { colors } = useTheme();
  const badge = BADGES[kind] ?? FALLBACK;
  return (
    <View
      testID="channel-badge"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.disc, { backgroundColor: colors[badge.color], borderColor: colors[ring] }]}
    >
      <Icon name={badge.icon} size={11} color="onPrimary" />
    </View>
  );
}

const styles = StyleSheet.create({
  disc: {
    position: 'absolute',
    right: -RING - 2,
    bottom: -RING,
    width: SIZE + RING * 2,
    height: SIZE + RING * 2,
    borderRadius: (SIZE + RING * 2) / 2,
    borderWidth: RING,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
