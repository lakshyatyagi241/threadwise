import type { SavedReply } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

interface Props {
  /** The reply whose actions are offered; the sheet is closed when there is none. */
  reply: SavedReply | null;
  /** Editing and deleting are offered for a reply the person may change (a shared one needs the manage right, the API says `canEdit`). */
  onEdit: (reply: SavedReply) => void;
  onDuplicate: (reply: SavedReply) => void;
  onDelete: (reply: SavedReply) => void;
  onClose: () => void;
}

/** What can be done to one reply from the list, in a sheet that rises from the bottom: Edit, Duplicate and Delete. */
export function QuickReplyActionsSheet({ reply, onEdit, onDuplicate, onDelete, onClose }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Modal transparent visible={reply !== null} animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('settings.quickReplies.cancel')}
        style={[styles.scrim, { backgroundColor: colors.scrim }]}
        onPress={onClose}
      >
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text variant="label" muted numberOfLines={1} style={styles.heading}>
            {reply?.title}
          </Text>
          {reply?.canEdit ? (
            <Action
              icon="create-outline"
              label={t('settings.quickReplies.edit')}
              onPress={() => onEdit(reply)}
            />
          ) : null}
          {reply ? (
            <Action
              icon="copy-outline"
              label={t('settings.quickReplies.duplicate')}
              onPress={() => onDuplicate(reply)}
            />
          ) : null}
          {reply?.canEdit ? (
            <Action
              icon="trash-outline"
              label={t('settings.quickReplies.delete')}
              danger
              onPress={() => onDelete(reply)}
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
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.action}
    >
      <Icon name={icon} size={22} color={danger ? 'danger' : 'text'} />
      <Text color={danger ? 'danger' : 'text'}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingBottom: spacing.xl,
  },
  heading: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  action: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
});
