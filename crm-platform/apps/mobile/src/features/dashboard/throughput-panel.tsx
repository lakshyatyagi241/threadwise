import type { DashSummaryResponse, DashThroughputResponse } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { BarChart, type BarSeries } from '@/components/charts/bar-chart';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/ui/panel';
import { Text } from '@/components/ui/text';
import { compact } from '@/lib/format/numbers';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { bucketLabel } from './format';

interface Props {
  /** The window as a person reads it ("13 Sep – 12 Oct 2026"). */
  rangeName: string;
  summary: DashSummaryResponse | undefined;
  throughput: DashThroughputResponse | undefined;
  /** The throughput request failed and there is nothing to show yet. */
  failed: boolean;
  timezone: string;
}

/** The message throughput chart (TW-DASH-010): outbound, delivered and failed per hour or per day, with the peak and the four totals. */
export function ThroughputPanel({ rangeName, summary, throughput, failed, timezone }: Props) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const locale = i18n.language;

  const series: BarSeries[] = throughput
    ? [
        { name: t('dashboard.throughput.sent'), values: throughput.sent, color: 'chartSent' },
        {
          name: t('dashboard.throughput.delivered'),
          values: throughput.delivered,
          color: 'chartDelivered',
        },
        { name: t('dashboard.throughput.failed'), values: throughput.failed, color: 'danger' },
      ]
    : [];
  const totals = summary
    ? [summary.current.sent, summary.current.delivered, summary.current.failed]
    : [];
  const hourly = throughput?.bucket === 'hour';
  const label = (iso: string) => bucketLabel(iso, hourly, locale, throughput?.timezone ?? timezone);

  return (
    <Panel
      title={t('dashboard.throughput.title')}
      subtitle={t('dashboard.throughput.subtitleCustom', { range: rangeName })}
    >
      {throughput ? (
        <View style={styles.stack}>
          {throughput.peak ? (
            <Badge
              label={t('dashboard.throughput.peak', {
                when: label(throughput.peak.start),
                n: throughput.peak.count,
              })}
            />
          ) : null}
          <View style={styles.legend}>
            {series.map((s, index) => (
              <View key={s.name} style={styles.legendItem}>
                <View style={[styles.swatch, { backgroundColor: colors[s.color] }]} />
                <Text variant="caption">
                  {s.name}
                  {totals[index] !== undefined ? ` ${compact(totals[index])}` : ''}
                </Text>
              </View>
            ))}
          </View>
          <BarChart
            labels={throughput.starts.map(label)}
            series={series}
            summary={t('dashboard.throughput.summary', {
              sent: summary?.current.sent ?? 0,
              delivered: summary?.current.delivered ?? 0,
              failed: summary?.current.failed ?? 0,
            })}
          />
          {summary ? (
            <View style={[styles.tiles, { borderColor: colors.border }]}>
              <Tile
                label={t('dashboard.throughput.avgHour')}
                value={compact(throughput.avgPerHour)}
              />
              <Tile
                label={t('dashboard.throughput.replies')}
                value={compact(summary.current.replies)}
              />
              <Tile
                label={t('dashboard.throughput.replyRate')}
                value={`${summary.current.replyRate}%`}
              />
              <Tile
                label={t('dashboard.throughput.failed')}
                value={compact(summary.current.failed)}
              />
            </View>
          ) : null}
        </View>
      ) : failed ? (
        <Text danger accessibilityRole="alert">
          {t('dashboard.error.generic')}
        </Text>
      ) : (
        <ActivityIndicator accessibilityLabel={t('common.loading')} />
      )}
    </Panel>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tile}>
      <Text variant="caption" muted>
        {label}
      </Text>
      <Text variant="subheading">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: spacing.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  swatch: { width: 10, height: 10, borderRadius: radius.sm / 2 },
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.md,
    borderTopWidth: 1,
    paddingTop: spacing.md,
  },
  tile: { width: '50%', gap: 2 },
});
