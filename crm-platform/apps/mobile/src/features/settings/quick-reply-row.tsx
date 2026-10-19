import type { SavedReply } from '@crm/contracts';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

interface Props {
  reply: SavedReply;
  onOpen: (reply: SavedReply) => void;
  onMore: (reply: SavedReply) => void;
}

/** One saved reply in the list: its title and shortcut, the start of its text, who can use it, and how much it has been used. */
function QuickReplyRowBase({ reply, onOpen, onMore }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const used =
    reply.usedCount === 0
      ? t('settings.quickReplies.neverUsed')
      : t('settings.quickReplies.used', { count: reply.usedCount });
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${reply.title}, /${reply.shortcut}`}
        accessibilityHint={reply.canEdit ? undefined : t('settings.quickReplies.readOnly')}
        onPress={() => onOpen(reply)}
        style={styles.main}
      >
        <View style={styles.head}>
          <Text variant="label" numberOfLines={1} style={styles.title}>
            {reply.title}
          </Text>
          <Badge
            label={t(`settings.quickReplies.scope.${reply.scope}`)}
            tone={reply.scope === 'shared' ? 'info' : 'neutral'}
          />
        </View>
        <Text variant="caption" color="primary" numberOfLines={1}>
          {`/${reply.shortcut}`}
          {reply.category ? ` · ${reply.category}` : ''}
        </Text>
        <Text muted numberOfLines={2}>
          {reply.body}
        </Text>
        <Text variant="caption" muted>
          {used}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('settings.quickReplies.actionsFor', { title: reply.title })}
        onPress={() => onMore(reply)}
        style={styles.more}
      >
        <Icon name="ellipsis-vertical" size={20} color="textMuted" />
      </Pressable>
    </View>
  );
}

export const QuickReplyRow = memo(QuickReplyRowBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  main: { flex: 1, gap: spacing.xs, paddingVertical: spacing.md, paddingStart: spacing.lg },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flexShrink: 1 },
  more: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
});
