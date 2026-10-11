import type { DashWidgets } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Panel } from '@/components/ui/panel';
import { Text } from '@/components/ui/text';
import { spacing } from '@/lib/theme/tokens';
import { formatMoney } from './format';

/** The sales-pipeline strip (TW-DASH-011), only for a plan that has a pipeline. Money arrives in minor units as a string. */
export function PipelineCard({ data }: { data: NonNullable<DashWidgets['pipeline']> }) {
  const { t, i18n } = useTranslation();
  const money = (minor: string) => formatMoney(Number(minor) / 100, data.currency, i18n.language);
  const cells = [
    ['dashboard.pipeline.open', money(data.openValueMinor)],
    ['dashboard.pipeline.deals', String(data.openDeals)],
    ['dashboard.pipeline.won', money(data.wonThisMonthMinor)],
    ['dashboard.pipeline.winRate', `${data.winRatePct}%`],
  ] as const;
  return (
    <Panel testID="strip-pipeline" title={t('dashboard.pipeline.kicker')}>
      <View style={styles.grid}>
        {cells.map(([key, value]) => (
          <View key={key} style={styles.cell}>
            <Text variant="heading">{value}</Text>
            <Text variant="caption" muted>
              {t(key)}
            </Text>
          </View>
        ))}
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.lg },
  cell: { width: '50%', gap: 2, paddingEnd: spacing.md },
});
