import type { BoardKpis } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { formatCount } from '@/lib/format/numbers';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { formatTotals } from './money';

interface TileProps {
  label: string;
  value: string;
  hint: string;
}

function Tile({ label, value, hint }: TileProps) {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}. ${hint}`}
      style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Text variant="caption" muted numberOfLines={1}>
        {label}
      </Text>
      <Text variant="subheading" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text variant="caption" muted numberOfLines={1}>
        {hint}
      </Text>
    </View>
  );
}

/**
 * Four tiles over the board that describe the whole pipeline: what is open, the probability-weighted forecast, what was won this
 * month and the win rate. The search and owner filters never change them, and money is per currency, never a mix added together.
 */
export function KpiStrip({ kpis }: { kpis: BoardKpis }) {
  const { t, i18n } = useTranslation();
  const money = (totals: BoardKpis['openValue']) =>
    formatTotals(totals.converted ? [totals.converted] : totals.byCurrency, i18n.language, {
      compact: true,
    });
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      testID="deals-kpis"
    >
      <Tile
        label={t('deals.kpi.openPipeline')}
        value={money(kpis.openValue)}
        hint={t('deals.kpi.openDeals', { n: formatCount(kpis.openCount, i18n.language) })}
      />
      <Tile
        label={t('deals.kpi.forecast')}
        value={money(kpis.forecast)}
        hint={t('deals.kpi.forecastHint')}
      />
      <Tile
        label={t('deals.kpi.wonThisMonth')}
        value={money(kpis.wonThisMonthValue)}
        hint={t('deals.kpi.dealsCount', {
          n: formatCount(kpis.wonThisMonthCount, i18n.language),
        })}
      />
      <Tile
        label={t('deals.kpi.winRate')}
        value={`${formatCount(kpis.winRate, i18n.language)}%`}
        hint={t('deals.kpi.winRateHint')}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  tile: {
    minWidth: 140,
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
});
