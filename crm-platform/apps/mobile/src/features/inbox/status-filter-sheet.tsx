import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { STATUS_FILTERS, type StatusFilter } from './filters';

interface Props {
  visible: boolean;
  value: StatusFilter;
  onSelect: (value: StatusFilter) => void;
  onClose: () => void;
}

/** The list of statuses the filter button opens. The chosen one carries a tick; choosing one closes the sheet. */
export function StatusFilterSheet({ visible, value, onSelect, onClose }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('inbox.filter.close')}
        style={[styles.scrim, { backgroundColor: colors.scrim }]}
        onPress={onClose}
      >
        <View
          accessibilityViewIsModal
          accessibilityLabel={t('inbox.filter.sheet')}
          style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text variant="overline" muted style={styles.heading}>
            {t('inbox.filter.sheet')}
          </Text>
          {STATUS_FILTERS.map((option) => (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityLabel={t(`inbox.statusFilter.${option}`)}
              accessibilityState={{ checked: option === value }}
              onPress={() => {
                onSelect(option);
                onClose();
              }}
              style={styles.option}
            >
              <Text variant={option === value ? 'label' : 'body'}>
                {t(`inbox.statusFilter.${option}`)}
              </Text>
              {option === value ? <Icon name="checkmark" size={20} color="primary" /> : null}
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: 'flex-end', paddingTop: 96, paddingHorizontal: spacing.lg },
  sheet: {
    minWidth: 240,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.xs,
  },
  heading: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  option: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
});
