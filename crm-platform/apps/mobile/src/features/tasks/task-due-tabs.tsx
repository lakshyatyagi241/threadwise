import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { DUE_TABS, type DueTab } from './filters';

interface Props {
  value: DueTab;
  onChange: (tab: DueTab) => void;
}

/**
 * The quick due-date tabs above the task list: All, Overdue, Today, Tomorrow, This week (the Geta app's tabs, with "All" so the
 * list can also be left unnarrowed). One is chosen at a time; the row scrolls sideways when a language needs more room.
 */
export function TaskDueTabs({ value, onChange }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const label: Record<DueTab, string> = {
    all: t('tasks.tabs.all'),
    overdue: t('tasks.filter.due.overdue'),
    today: t('tasks.filter.due.today'),
    tomorrow: t('tasks.tabs.tomorrow'),
    week: t('tasks.tabs.week'),
  };
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="radiogroup"
      accessibilityLabel={t('tasks.tabs.label')}
      style={styles.scroll}
      contentContainerStyle={styles.row}
      keyboardShouldPersistTaps="handled"
    >
      {DUE_TABS.map((tab) => {
        const selected = tab === value;
        return (
          <Pressable
            key={tab}
            accessibilityRole="radio"
            accessibilityLabel={label[tab]}
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(tab)}
            style={[
              styles.chip,
              {
                backgroundColor: selected ? colors.primary : colors.surface,
                borderColor: selected ? colors.primary : colors.border,
              },
            ]}
          >
            <Text variant="label" color={selected ? 'onPrimary' : 'textMuted'} numberOfLines={1}>
              {label[tab]}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm },
  chip: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
});
