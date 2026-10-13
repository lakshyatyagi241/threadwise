import type { ConversationSummary } from '@crm/contracts';
import { useRouter } from 'expo-router';
import { memo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { ChannelBadge } from './channel-badge';
import { STATUS_TONE } from './status';
import { formatConversationTime } from './time';

interface Props {
  item: ConversationSummary;
  /** The clock the time on the right is measured against. */
  now: Date;
  /** Some conversations are being chosen: a press ticks this row instead of opening it. */
  selecting?: boolean;
  selected?: boolean;
  /** A long press starts choosing (given only to a person who may act on several at once). */
  onStartSelecting?: (id: string) => void;
  onToggle?: (id: string) => void;
}

/**
 * One conversation in the list, on two lines: the avatar (with the mark of its channel on the corner), the name and the time, then
 * the last message. A thread that is not open also says so, and an unread one has a dot and a bolder name. The whole row opens
 * the thread.
 */
export const ConversationRow = memo(function ConversationRow({
  item,
  now,
  selecting,
  selected,
  onStartSelecting,
  onToggle,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  // On Android the release that ends a long press is also a press. Without this the row just chosen would be un-chosen at once.
  const afterLongPress = useRef(false);
  const unread = item.unreadCount > 0;
  // A message with no words (a photo, a file) has no preview; the thread still has something in it.
  const media = item.preview === null && item.lastMessageAt !== null;
  const preview = item.preview ?? (media ? t('inbox.row.media') : t('inbox.row.noMessages'));
  const label = unread
    ? t('inbox.row.labelUnread', {
        title: item.title,
        unread: t('inbox.row.unread', { count: item.unreadCount }),
        preview,
      })
    : t('inbox.row.label', { title: item.title, preview });

  return (
    <Pressable
      accessibilityRole={selecting ? 'checkbox' : 'button'}
      accessibilityLabel={label}
      accessibilityState={selecting ? { checked: Boolean(selected) } : undefined}
      accessibilityHint={!selecting && onStartSelecting ? t('inbox.bulk.hint') : undefined}
      onPress={() => {
        if (afterLongPress.current) {
          afterLongPress.current = false;
          return;
        }
        if (selecting) onToggle?.(item.id);
        else router.push({ pathname: '/conversation/[id]', params: { id: item.id } });
      }}
      onLongPress={
        onStartSelecting && !selecting
          ? () => {
              afterLongPress.current = true;
              onStartSelecting(item.id);
            }
          : undefined
      }
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: selected
            ? colors.primarySoft
            : pressed
              ? colors.surfaceMuted
              : colors.surface,
        },
      ]}
    >
      {selecting ? (
        <Icon
          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
          size={24}
          color={selected ? 'primary' : 'textMuted'}
        />
      ) : null}
      <View>
        <Avatar name={item.title} seed={item.id} size={40} />
        <ChannelBadge kind={item.channel.kind} ring="surface" />
      </View>
      <View style={styles.body}>
        <View style={styles.line}>
          <Text variant="body" numberOfLines={1} style={[styles.grow, unread && styles.unreadName]}>
            {item.title}
          </Text>
          <Text variant="caption" color={unread ? 'success' : 'textMuted'}>
            {formatConversationTime(item.lastMessageAt, now, t)}
          </Text>
        </View>
        <View style={styles.line}>
          {media ? <Icon name="attach" size={16} color="textMuted" /> : null}
          <Text variant="body" muted numberOfLines={1} style={styles.grow}>
            {preview}
          </Text>
          {item.status !== 'open' ? (
            <Badge label={t(`inbox.status.${item.status}`)} tone={STATUS_TONE[item.status]} />
          ) : null}
          {unread ? (
            <View testID="unread-dot" style={[styles.dot, { backgroundColor: colors.success }]} />
          ) : null}
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  body: { flex: 1 },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
  unreadName: { fontWeight: '700' },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
