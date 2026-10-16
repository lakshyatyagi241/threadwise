import type { TaskResponse } from '@crm/contracts';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { formatMoment } from '@/lib/format/dates';
import { PriorityBadge } from './priority-badge';

const CIRCLE = 24;

interface Props {
  task: TaskResponse;
  /** The person may complete and reopen tasks; without it the circle is shown but cannot be pressed. */
  canUpdate: boolean;
  /** The person may edit or delete: only then is there an overflow button. */
  canMore: boolean;
  /** This row's request is in flight. */
  busy: boolean;
  onOpen: (id: string) => void;
  onToggle: (task: TaskResponse) => void;
  onMore: (task: TaskResponse) => void;
}

/**
 * One task in the list: a circle that completes or reopens it, the title (struck through when done), who it is for, when it is due
 * (in red when overdue) and how urgent it is. The row opens the task; the three dots open Edit and Delete.
 */
function TaskRowBase({ task, canUpdate, canMore, busy, onOpen, onToggle, onMore }: Props) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const done = task.status === 'done';
  const owner = task.assignee?.name || t('tasks.row.unassigned');
  const due = task.dueAt
    ? t('tasks.row.due', { when: formatMoment(task.dueAt, i18n.language) })
    : null;
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={
          done
            ? t('tasks.row.reopen', { title: task.title })
            : t('tasks.row.markDone', { title: task.title })
        }
        accessibilityState={{ checked: done, disabled: !canUpdate || busy, busy }}
        disabled={!canUpdate || busy}
        onPress={() => onToggle(task)}
        style={styles.side}
      >
        <View
          style={[
            styles.circle,
            {
              borderColor: done ? colors.success : colors.borderStrong,
              backgroundColor: done ? colors.success : colors.surface,
              opacity: busy ? 0.5 : 1,
            },
          ]}
        >
          {done ? <Icon name="checkmark" size={16} color="onPrimary" /> : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={task.title}
        accessibilityHint={due ?? undefined}
        onPress={() => onOpen(task.id)}
        style={styles.body}
      >
        <Text
          variant="body"
          numberOfLines={2}
          muted={done}
          style={[styles.title, done && styles.struck]}
        >
          {task.title}
        </Text>
        <Text variant="caption" muted numberOfLines={1}>
          {owner}
        </Text>
        {due ? (
          <Text variant="caption" danger={task.overdue} muted={!task.overdue} numberOfLines={1}>
            {due}
          </Text>
        ) : null}
        <View style={styles.badges}>
          <PriorityBadge priority={task.priority} />
          {task.overdue ? <Badge tone="danger" label={t('tasks.status.overdue')} /> : null}
        </View>
      </Pressable>
      {canMore ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('tasks.row.more', { title: task.title })}
          onPress={() => onMore(task)}
          style={styles.side}
        >
          <Icon name="ellipsis-vertical" size={20} color="textMuted" />
        </Pressable>
      ) : null}
    </View>
  );
}

export const TaskRow = memo(TaskRowBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.xs,
    paddingStart: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  side: {
    width: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    gap: 2,
    paddingVertical: spacing.sm,
  },
  title: { fontWeight: '600' },
  struck: { textDecorationLine: 'line-through' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
});
