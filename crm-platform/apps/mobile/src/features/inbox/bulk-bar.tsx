import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

export type BulkKind = 'read' | 'status' | 'assign' | 'label' | 'priority' | 'snooze' | 'spam';

const ITEMS: readonly { kind: BulkKind; icon: IconName }[] = [
  { kind: 'read', icon: 'mail-open-outline' },
  { kind: 'status', icon: 'swap-horizontal-outline' },
  { kind: 'assign', icon: 'people-outline' },
  { kind: 'label', icon: 'pricetag-outline' },
  { kind: 'priority', icon: 'flag-outline' },
  { kind: 'snooze', icon: 'alarm-outline' },
  { kind: 'spam', icon: 'ban-outline' },
];

interface Props {
  /** The actions the person may do to several conversations (each needs its own right on top of the bulk one). */
  allowed: readonly BulkKind[];
  busy: boolean;
  onPick: (kind: BulkKind) => void;
}

/** The row of actions at the bottom of the inbox while conversations are ticked: one tap opens the action for all of them. */
export function BulkBar({ allowed, busy, onPick }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.bar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xs }]}
    >
      {ITEMS.filter((i) => allowed.includes(i.kind)).map((item) => (
        <Pressable
          key={item.kind}
          accessibilityRole="button"
          accessibilityLabel={t(`inbox.bulk.${item.kind}`)}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => onPick(item.kind)}
          style={[styles.item, busy && styles.dim]}
        >
          <Icon name={item.icon} size={22} color="primary" />
          <Text variant="caption">{t(`inbox.bulk.${item.kind}`)}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: { flexGrow: 0, borderTopWidth: StyleSheet.hairlineWidth },
  content: { paddingHorizontal: spacing.sm, paddingTop: spacing.xs, gap: spacing.xs },
  item: {
    minWidth: 72,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: spacing.sm,
  },
  dim: { opacity: 0.5 },
});
