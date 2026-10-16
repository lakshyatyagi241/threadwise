import type { BoardStageResponse } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { formatCount } from '@/lib/format/numbers';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { StageDot } from './deal-parts';

interface Props {
  stages: readonly BoardStageResponse[];
  selectedId: string | undefined;
  onSelect: (stageId: string) => void;
}

/**
 * The board's columns as a row of tabs: each stage with its colour and how many deals sit in it. A phone shows one column at a
 * time, so the row is how the person moves between them; the open one is ticked and its deals are the list below.
 */
export function StageStrip({ stages, selectedId, onSelect }: Props) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityRole="tablist"
      accessibilityLabel={t('deals.stages.label')}
      testID="deals-stages"
    >
      {stages.map(({ stage, count }) => {
        const selected = stage.id === selectedId;
        const shown = formatCount(count, i18n.language);
        return (
          <Pressable
            key={stage.id}
            accessibilityRole="tab"
            accessibilityLabel={t('deals.stages.tab', { name: stage.name, n: shown })}
            accessibilityState={{ selected }}
            onPress={() => onSelect(stage.id)}
            style={[
              styles.tab,
              {
                backgroundColor: selected ? colors.primarySoft : colors.surface,
                borderColor: selected ? colors.primary : colors.borderStrong,
              },
            ]}
          >
            <StageDot color={stage.color} />
            <Text variant="label" color={selected ? 'primary' : 'text'} numberOfLines={1}>
              {stage.name}
            </Text>
            <View style={[styles.count, { backgroundColor: colors.surfaceMuted }]}>
              <Text variant="caption" muted>
                {shown}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  tab: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  count: { borderRadius: radius.pill, paddingHorizontal: spacing.sm },
});
