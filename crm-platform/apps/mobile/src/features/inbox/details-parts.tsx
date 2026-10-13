import type { PastConversation } from '@crm/contracts';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { channelMark } from './channel-badge';
import { STATUS_TONE } from './status';
import { formatConversationTime } from './time';

/** A titled card of the details screen. */
export function Section({
  title,
  children,
  count,
}: {
  title: string;
  children: ReactNode;
  count?: number;
}) {
  return (
    <Card>
      <Text variant="subheading" accessibilityRole="header">
        {count ? `${title} (${count})` : title}
      </Text>
      {children}
    </Card>
  );
}

interface RowProps {
  label: string;
  /** What it is now. */
  value: string;
  /** Present when the person may change it: the row becomes a button that opens the picker. */
  onPress?: () => void;
}

/** One line of "Actions": the name on the left, what it is now on the right, and a chevron when it can be changed. */
export function ActionRow({ label, value, onPress }: RowProps) {
  const { colors } = useTheme();
  const content = (
    <>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text muted numberOfLines={1} style={styles.rowValue}>
        {value}
      </Text>
      {onPress ? <Icon name="chevron-forward" size={18} color="textMuted" /> : null}
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
  row: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { flexShrink: 0 },
  rowValue: { flex: 1, textAlign: 'right' },
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
