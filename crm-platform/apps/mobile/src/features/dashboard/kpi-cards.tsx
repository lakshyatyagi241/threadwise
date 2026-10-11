import type { DashSummaryResponse, DashWidgets, WalletSummary } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Sparkline } from '@/components/charts/sparkline';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Text } from '@/components/ui/text';
import { compact, formatCount } from '@/lib/format/numbers';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { formatMoney } from './format';
import { Trend } from './trend';

/** Placeholder for a figure that has not arrived yet (the same dash the web shows). */
const WAITING = '-';

interface RangeProps {
  /** The short name of the window ("7d"). */
  range: string;
}

/** Card 1 (TW-DASH-004): messages sent in the window, the change against the one before, the shape over the last 20 hours. */
export function SentCard({
  summary,
  range,
}: RangeProps & { summary: DashSummaryResponse | undefined }) {
  const { t, i18n } = useTranslation();
  return (
    <Card>
      <View testID="card-sent" style={styles.stack}>
        <View style={styles.titleRow}>
          <Text variant="label" muted style={styles.fill}>
            {t('dashboard.kpi.sent', { range })}
          </Text>
          {summary ? <Trend delta={summary.sentDeltaPct} /> : null}
        </View>
        <Text variant="metric">
          {summary ? formatCount(summary.current.sent, i18n.language) : WAITING}
        </Text>
        {summary ? (
          <>
            <Sparkline values={summary.sparkline} label={t('dashboard.kpi.sparkline')} />
            <Text variant="caption" muted>
              {t('dashboard.kpi.sentLegend', {
                delivered: summary.current.delivered,
                failed: summary.current.failed,
              })}
            </Text>
          </>
        ) : null}
      </View>
    </Card>
  );
}

/** Card 2 (TW-DASH-005): the share of messages read, with sent / delivered / read side by side. */
export function ReadRateCard({ summary }: { summary: DashSummaryResponse | undefined }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const current = summary?.current;
  const cells = current
    ? ([
        ['dashboard.kpi.readMini.sent', compact(current.sent)],
        ['dashboard.kpi.readMini.delivered', `${current.deliverability}%`],
        ['dashboard.kpi.readMini.read', `${current.readRate}%`],
      ] as const)
    : [];
  return (
    <Card>
      <View testID="card-read" style={styles.stack}>
        <View style={styles.titleRow}>
          <Text variant="label" muted style={styles.fill}>
            {t('dashboard.kpi.readRate')}
          </Text>
          {summary ? <Trend delta={summary.readRateDeltaPp} unit="pp" /> : null}
        </View>
        <Text variant="metric">{current ? `${current.readRate}%` : WAITING}</Text>
        {current ? <ProgressBar percent={current.readRate} tone="success" /> : null}
        {cells.length > 0 ? (
          <View style={styles.cells}>
            {cells.map(([key, value]) => (
              <View key={key} style={[styles.cell, { borderColor: colors.border }]}>
                <Text variant="caption" muted>
                  {t(key)}
                </Text>
                <Text variant="label">{value}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Card>
  );
}

/** Card 3 (TW-DASH-006): all contacts, how many are subscribed or blocked, and the growth since before the window. */
export function ContactsCard({ data }: { data: DashWidgets['contacts'] | undefined }) {
  const { t, i18n } = useTranslation();
  const denominator = Math.max(1, data?.total ?? 0);
  // Subscribed and Opted-in share one count and one row each, exactly as on the web.
  const rows = data
    ? ([
        ['dashboard.contacts.subscribed', data.subscribed, 'primary'],
        ['dashboard.contacts.optedIn', data.subscribed, 'primary'],
        ['dashboard.contacts.blocked', data.blocked, 'danger'],
      ] as const)
    : [];
  return (
    <Card>
      <View testID="card-contacts" style={styles.stack}>
        <View style={styles.titleRow}>
          <Text variant="label" muted style={styles.fill}>
            {t('dashboard.contacts.title')}
          </Text>
          {data ? <Trend delta={data.deltaPct} /> : null}
        </View>
        <Text variant="metric">{data ? formatCount(data.total, i18n.language) : WAITING}</Text>
        {rows.map(([key, count, tone]) => (
          <View key={key} style={styles.barRow}>
            <Text variant="caption" muted style={styles.barLabel}>
              {t(key)}
            </Text>
            <View style={styles.fill}>
              <ProgressBar percent={(count / denominator) * 100} tone={tone} />
            </View>
            <View style={styles.barCount}>
              <Text variant="caption">{count}</Text>
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** Card 4 (TW-DASH-007): the wallet balance when the workspace holds money. */
export function WalletCard({ wallet }: { wallet: WalletSummary }) {
  const { t, i18n } = useTranslation();
  return (
    <Card>
      <View testID="card-wallet" style={styles.stack}>
        <View style={styles.titleRow}>
          <Text variant="label" muted style={styles.fill}>
            {t('dashboard.wallet.title')}
          </Text>
          {wallet.billingMode === 'wallet' ? (
            <Badge label={t('dashboard.wallet.payPerMessage')} />
          ) : null}
        </View>
        <Text variant="metric">
          {formatMoney(wallet.balanceMinor / 100, wallet.currency, i18n.language)}
        </Text>
        <ProgressBar percent={100} />
      </View>
    </Card>
  );
}

/** Card 4 when there is no money in the wallet (or the person may not see it): the "get more done" prompt. */
export function AutopilotCard() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View testID="card-autopilot" style={[styles.autopilot, { backgroundColor: colors.brand }]}>
      <Text variant="overline" color="onBrandMuted">
        {t('dashboard.autopilot.kicker')}
      </Text>
      <Text variant="heading" color="onBrand" accessibilityRole="header">
        {t('dashboard.autopilot.title')}
      </Text>
      <Text color="onBrandMuted">{t('dashboard.autopilot.body')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  fill: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cells: { flexDirection: 'row', gap: spacing.sm },
  cell: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
  },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  barLabel: { width: 84 },
  barCount: { width: 40, alignItems: 'flex-end' },
  autopilot: { borderRadius: radius.lg, padding: spacing.xl, gap: spacing.sm },
});
