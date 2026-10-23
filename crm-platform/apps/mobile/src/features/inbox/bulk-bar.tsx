import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

export type BulkKind =
  | 'read'
  | 'status'
  | 'assign'
  | 'label'
  | 'priority'
  | 'snooze'
  | 'spam'
  // The undo of an action, offered in its place when every chosen conversation is in that state (see bulk-context.ts).
  | 'reopen'
  | 'unsnooze'
  | 'notSpam';

const ICONS: Record<BulkKind, IconName> = {
  read: 'mail-open-outline',
  status: 'swap-horizontal-outline',
  assign: 'people-outline',
  label: 'pricetag-outline',
  priority: 'flag-outline',
  snooze: 'alarm-outline',
  spam: 'ban-outline',
  reopen: 'refresh-outline',
  unsnooze: 'notifications-off-outline',
  notSpam: 'checkmark-circle-outline',
};

interface Props {
  /** The actions to offer, in order: what the person may do to several conversations and what fits the chosen ones (bulk-context.ts). */
  kinds: readonly BulkKind[];
  busy: boolean;
  onPick: (kind: BulkKind) => void;
}

/** The row of actions at the bottom of the inbox while conversations are ticked: one tap opens the action for all of them. */
export function BulkBar({ kinds, busy, onPick }: Props) {
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
      {kinds.map((kind) => (
        <Pressable
          key={kind}
          accessibilityRole="button"
          accessibilityLabel={t(`inbox.bulk.${kind}`)}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => onPick(kind)}
          style={[styles.item, busy && styles.dim]}
        >
          <Icon name={ICONS[kind]} size={22} color="primary" />
          <Text variant="caption">{t(`inbox.bulk.${kind}`)}</Text>
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
