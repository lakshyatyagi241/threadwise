import type { ConversationSummary } from '@crm/contracts';
import { useRouter } from 'expo-router';
import { memo } from 'react';
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
}

/**
 * One conversation in the list, on two lines: the avatar (with the mark of its channel on the corner), the name and the time, then
 * the last message. A thread that is not open also says so, and an unread one has a dot and a bolder name. The whole row opens
 * the thread.
 */
export const ConversationRow = memo(function ConversationRow({ item, now }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
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
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push({ pathname: '/conversation/[id]', params: { id: item.id } })}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.surfaceMuted : colors.surface },
      ]}
    >
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
