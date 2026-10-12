import type { TaskResponse } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

interface Props {
  /** The task whose actions are offered; the sheet is closed when there is none. */
  task: TaskResponse | null;
  /** Editing is offered for an open task the person may update. */
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (task: TaskResponse) => void;
  onDelete: (task: TaskResponse) => void;
  onClose: () => void;
}

/** What can be done to one task from the list, in a sheet that rises from the bottom: Edit task and Delete task. */
export function TaskActionsSheet({ task, canEdit, canDelete, onEdit, onDelete, onClose }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const edit = canEdit && task?.status === 'open';
  return (
    <Modal transparent visible={task !== null} animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('tasks.cancel')}
        style={[styles.scrim, { backgroundColor: colors.scrim }]}
        onPress={onClose}
      >
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text variant="label" muted numberOfLines={1} style={styles.heading}>
            {task?.title}
          </Text>
          {edit && task ? (
            <Action
              icon="create-outline"
              label={t('tasks.actions.edit')}
              onPress={() => onEdit(task)}
            />
          ) : null}
          {canDelete && task ? (
            <Action
              icon="trash-outline"
              label={t('tasks.actions.delete')}
              danger
              onPress={() => onDelete(task)}
            />
          ) : null}
        </View>
      </Pressable>
    </Modal>
  );
}

function Action({
  icon,
  label,
  danger,
  onPress,
}: {
  icon: IconName;
  label: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.action}
    >
      <Icon name={icon} size={22} color={danger ? 'danger' : 'text'} />
      <Text variant="body" danger={danger}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.sm,
  },
  heading: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  action: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
});
