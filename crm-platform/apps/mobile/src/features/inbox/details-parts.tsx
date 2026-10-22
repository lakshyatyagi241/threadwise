import type { PastConversation } from '@crm/contracts';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { channelMark } from './channel-badge';
import { STATUS_TONE } from './status';
import { formatConversationTime } from './time';

/** A titled band of the details screen: white, edge to edge, with the grey of the screen showing between bands (as in the Geta app). */
export function Section({
  title,
  children,
  count,
}: {
  title: string;
  children: ReactNode;
  count?: number;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.section, { backgroundColor: colors.surface }]}>
      <Text variant="subheading" accessibilityRole="header">
        {count ? `${title} (${count})` : title}
      </Text>
      {children}
    </View>
  );
}

interface RowProps {
  label: string;
  /** What it is now. */
  value: string;
  /** The picture at the start of the line. */
  icon: IconName;
  /** Present when the person may change it: the row becomes a button that opens the picker. */
  onPress?: () => void;
}

/** One line of "Actions": a picture, the name with what it is now under it, and a chevron when it can be changed. */
export function ActionRow({ label, value, icon, onPress }: RowProps) {
  const { colors } = useTheme();
  const content = (
    <>
      <Icon name={icon} size={24} color="textMuted" />
      <View style={styles.rowText}>
        <Text>{label}</Text>
        <Text muted numberOfLines={1}>
          {value}
        </Text>
      </View>
      {onPress ? <Icon name="chevron-forward" size={20} color="textMuted" /> : null}
    </>
  );
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityValue={{ text: value }}
      onPress={onPress}
      style={[styles.row, { borderBottomColor: colors.border }]}
    >
      {content}
    </Pressable>
  ) : (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={[styles.row, { borderBottomColor: colors.border }]}
    >
      {content}
    </View>
  );
}

/** The other conversations with this contact (the API sends at most 20, newest first): tap one to open it. */
export function PastList({
  items,
  now,
  onOpen,
}: {
  items: readonly PastConversation[];
  now: Date;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  if (items.length === 0) return <Text muted>{t('inbox.details.past.empty')}</Text>;
  return (
    <View>
      {items.map((item) => {
        const mark = channelMark(item.channel.kind);
        return (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={item.title}
            accessibilityHint={item.preview ?? undefined}
            onPress={() => onOpen(item.id)}
            style={[styles.past, { borderBottomColor: colors.border }]}
          >
            <Icon name={mark.icon} size={20} color={mark.color} />
            <View style={styles.pastText}>
              <Text numberOfLines={1}>{item.preview ?? item.title}</Text>
              <View style={styles.pastMeta}>
                <Text variant="caption" muted>
                  {formatConversationTime(item.lastMessageAt, now, t)}
                </Text>
                <Badge label={t(`inbox.status.${item.status}`)} tone={STATUS_TONE[item.status]} />
              </View>
            </View>
            <Icon name="chevron-forward" size={18} color="textMuted" />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg },
  row: {
    minHeight: MIN_TOUCH_TARGET + spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1 },
  past: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pastText: { flex: 1, gap: 2 },
  pastMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
