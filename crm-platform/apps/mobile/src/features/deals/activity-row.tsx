import type { DealActivityResponse } from '@crm/contracts';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { formatMoment } from '@/lib/format/dates';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

const ICON: Record<DealActivityResponse['type'], IconName> = {
  note: 'document-text-outline',
  call: 'call-outline',
  message: 'chatbubble-outline',
  email: 'mail-outline',
  meeting: 'calendar-outline',
  task: 'checkbox-outline',
  stage_change: 'swap-horizontal-outline',
};

const BADGE = 28;

interface Props {
  activity: DealActivityResponse;
  /** The person may complete and reopen the deal's tasks. */
  canToggle: boolean;
  /** This row's request is in flight. */
  busy: boolean;
  onToggle: (activity: DealActivityResponse) => void;
}

/**
 * One entry of the deal's timeline: a note, a logged call, a message, an email, a meeting, a task, or the system's own "moved from
 * A to B". A task shows its due date (red when it is past and not done) and a button that completes or reopens it.
 */
function ActivityRowBase({ activity, canToggle, busy, onToggle }: Props) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const isTask = activity.type === 'task';
  const overdue =
    isTask && !activity.done && activity.dueAt !== null && new Date(activity.dueAt) < new Date();
  let text = activity.body ?? '';
  if (activity.type === 'stage_change') {
    const change = activity.stageChange;
    text = change
      ? change.from
        ? t('deals.timeline.stageChange', { from: change.from.name, to: change.to.name })
        : t('deals.timeline.placed', { to: change.to.name })
      : t('deals.timeline.stageChanged');
  }
  const author = activity.author?.name ?? t('deals.timeline.system');
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <View style={[styles.badge, { backgroundColor: colors.surfaceMuted }]}>
        <Icon name={ICON[activity.type]} size={16} color="textMuted" />
      </View>
      <View style={styles.body}>
        <Text muted={activity.done} style={activity.done ? styles.struck : undefined}>
          {text}
        </Text>
        <Text variant="caption" muted>
          {`${t(`deals.timeline.kinds.${activity.type}`)} · ${author} · ${formatMoment(activity.createdAt, i18n.language)}`}
        </Text>
        {isTask && activity.dueAt ? (
          <Text variant="caption" danger={overdue} muted={!overdue}>
            {t('deals.timeline.dueOn', { when: formatMoment(activity.dueAt, i18n.language) })}
          </Text>
        ) : null}
        {isTask && activity.assignee ? (
          <Text variant="caption" muted>
            {t('deals.timeline.assignedTo', { name: activity.assignee.name })}
          </Text>
        ) : null}
        {isTask && canToggle ? (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={
              activity.done ? t('deals.timeline.reopenTask') : t('deals.timeline.markDone')
            }
            accessibilityState={{ checked: activity.done, disabled: busy, busy }}
            disabled={busy}
            onPress={() => onToggle(activity)}
            style={[
              styles.toggle,
              {
                backgroundColor: activity.done ? colors.successSoft : colors.surfaceMuted,
                opacity: busy ? 0.5 : 1,
              },
            ]}
          >
            <Icon
              name={activity.done ? 'checkmark-circle' : 'ellipse-outline'}
              size={18}
              color={activity.done ? 'success' : 'textMuted'}
            />
            <Text variant="label" color={activity.done ? 'success' : 'text'}>
              {activity.done ? t('deals.timeline.done') : t('deals.timeline.markDone')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export const ActivityRow = memo(ActivityRowBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  struck: { textDecorationLine: 'line-through' },
  toggle: {
    alignSelf: 'flex-start',
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
});
