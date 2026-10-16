import type { DealResponse } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

interface Props {
  /** The deal whose actions are offered; the sheet is closed when there is none. */
  deal: DealResponse | null;
  canUpdate: boolean;
  canDelete: boolean;
  /** The pipeline has a won stage / a lost stage to move to (a ladder without one cannot offer the button). */
  hasWon: boolean;
  hasLost: boolean;
  onOpen: (deal: DealResponse) => void;
  onMove: (deal: DealResponse) => void;
  onWon: (deal: DealResponse) => void;
  onLost: (deal: DealResponse) => void;
  onReopen: (deal: DealResponse) => void;
  onEdit: (deal: DealResponse) => void;
  onDelete: (deal: DealResponse) => void;
  onClose: () => void;
}

/** What can be done to one deal from the list, in a sheet that rises from the bottom. */
export function DealActionsSheet({
  deal,
  canUpdate,
  canDelete,
  hasWon,
  hasLost,
  onOpen,
  onMove,
  onWon,
  onLost,
  onReopen,
  onEdit,
  onDelete,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const open = deal?.status === 'open';
  return (
    <Modal transparent visible={deal !== null} animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('deals.cancel')}
        style={[styles.scrim, { backgroundColor: colors.scrim }]}
        onPress={onClose}
      >
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text variant="label" muted numberOfLines={1} style={styles.heading}>
            {deal?.title}
          </Text>
          {deal ? (
            <>
              <Action
                icon="open-outline"
                label={t('deals.actions.open')}
                onPress={() => onOpen(deal)}
              />
              {canUpdate ? (
                <Action
                  icon="swap-horizontal-outline"
                  label={t('deals.actions.moveTo')}
                  onPress={() => onMove(deal)}
                />
              ) : null}
              {canUpdate && open && hasWon ? (
                <Action
                  icon="trophy-outline"
                  label={t('deals.actions.markWon')}
                  onPress={() => onWon(deal)}
                />
              ) : null}
              {canUpdate && open && hasLost ? (
                <Action
                  icon="close-circle-outline"
                  label={t('deals.actions.markLost')}
                  onPress={() => onLost(deal)}
                />
              ) : null}
              {canUpdate && !open ? (
                <Action
                  icon="refresh-outline"
                  label={t('deals.actions.reopen')}
                  onPress={() => onReopen(deal)}
                />
              ) : null}
              {canUpdate ? (
                <Action
                  icon="create-outline"
                  label={t('deals.actions.edit')}
                  onPress={() => onEdit(deal)}
                />
              ) : null}
              {canDelete ? (
                <Action
                  icon="trash-outline"
                  label={t('deals.actions.delete')}
                  danger
                  onPress={() => onDelete(deal)}
                />
              ) : null}
            </>
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
