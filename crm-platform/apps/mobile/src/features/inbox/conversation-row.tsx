import type { ConversationSummary } from '@crm/contracts';
import { useRouter } from 'expo-router';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { Pill } from './pill';
import { STATUS_TONE } from './status';
import { formatConversationTime } from './time';

/** Who has the conversation: the person, else the team, else the AI agent; null when nobody does. */
export const assigneeName = (item: ConversationSummary): string | null =>
  item.assignment.user?.name ?? item.assignment.team?.name ?? item.assignment.aiAgent?.name ?? null;

interface Props {
  item: ConversationSummary;
  /** The clock the time on the right is measured against. */
  now: Date;
}

/** One conversation in the list. The whole row opens the thread. */
export const ConversationRow = memo(function ConversationRow({ item, now }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const unread = item.unreadCount > 0;
  const preview = item.preview ?? t('inbox.row.noMessages');
  const assignee = assigneeName(item);
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
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
    >
      <Avatar name={item.title} seed={item.id} size={40} />
      <View style={styles.body}>
        <View style={styles.line}>
          <Text variant="subheading" numberOfLines={1} style={styles.grow}>
            {item.title}
          </Text>
          <Text variant="caption" color={unread ? 'success' : 'textMuted'}>
            {formatConversationTime(item.lastMessageAt, now, t)}
          </Text>
        </View>
        <View style={styles.line}>
          <Text variant="body" muted numberOfLines={1} style={styles.grow}>
            {preview}
          </Text>
          {unread ? (
            <View testID="unread-dot" style={[styles.dot, { backgroundColor: colors.success }]} />
          ) : null}
        </View>
        <View style={styles.pills}>
          {assignee ? <Pill label={assignee} icon="person-outline" /> : null}
          <Pill label={item.channel.name} />
          {item.status !== 'open' ? (
            <Badge label={t(`inbox.status.${item.status}`)} tone={STATUS_TONE[item.status]} />
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
    gap: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  body: { flex: 1, gap: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
});
