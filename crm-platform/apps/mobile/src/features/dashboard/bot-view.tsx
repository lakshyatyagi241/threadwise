import type { AnalyticsConversations, DashSummaryResponse, DashWidgets } from '@crm/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { messageForError } from '@/lib/api/error-message';
import { compact, formatCount } from '@/lib/format/numbers';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { formatWait } from './format';
import { PairCard, StatCard, TitledCard } from './summary-cards';
import { FlowsCard } from './team-cards';

interface Props {
  query: UseQueryResult<DashWidgets>;
  /** The window's message totals (sent and received). */
  summary: UseQueryResult<DashSummaryResponse>;
  /** The window's conversation times; `undefined` when the person may not read analytics (nothing was asked of the API). */
  stats: UseQueryResult<AnalyticsConversations> | undefined;
  /** The window as written under the title ("23 Sep – 22 Oct 2026"). */
  rangeName: string;
  onRetry: () => void;
}

/**
 * The Bot view, laid out like the Geta app's: the window's messages sent and received as one split bar with their total, the average
 * conversation duration, then the automation flows that answer customers without a person (flows running, people in them, the latest
 * flows). The messages and the duration follow the date pill; the flow counters ignore it. The figures the Geta app has beyond these
 * (conversations handled by the bot, handed to an agent, time saved, failed bot answers) are not in the API: see README.md.
 */
export function BotView({ query, summary, stats, rangeName, onRetry }: Props) {
  const { t, i18n } = useTranslation();
  const n = (value: number) => formatCount(value, i18n.language);
  const flows = query.data?.flows;

  if (!flows) {
    return query.error ? (
      <Card>
        <View style={styles.stack}>
          <Text danger accessibilityRole="alert">
            {messageForError(query.error, t)}
          </Text>
          <Button variant="secondary" label={t('common.retry')} onPress={onRetry} />
        </View>
      </Card>
    ) : (
      <ActivityIndicator accessibilityLabel={t('common.loading')} />
    );
  }
  return (
    <>
      <MessageSplit query={summary} rangeName={rangeName} />
      {stats?.data ? (
        <StatCard
          title={t('dashboard.agents.avgDuration')}
          value={formatWait(stats.data.avgDurationMin, t)}
          icon="timer-outline"
          tone="instagram"
        />
      ) : null}
      <PairCard
        left={{
          title: t('dashboard.bots.activeFlows'),
          subtitle: t('dashboard.bots.ofTotal', { total: flows.total }),
          value: n(flows.active),
          icon: 'flash-outline',
          tone: 'success',
        }}
        right={{
          title: t('dashboard.bots.subscribers'),
          subtitle: t('dashboard.bots.subscribersNote'),
          value: n(flows.subscribers),
          icon: 'people-outline',
          tone: 'primary',
        }}
      />
      <FlowsCard data={flows} showStats={false} />
    </>
  );
}

/** One legend line under the bar: the colour dot, the name, and the figure. */
function LegendRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.legendRow}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text>{`${label} : ${value}`}</Text>
    </View>
  );
}

/**
 * Messages sent and received in the window as one bar split in proportion, with their total on the title line and the two figures
 * under it (the Geta app draws a ring here; the app has no drawing library, so the same split is a bar).
 */
function MessageSplit({
  query,
  rangeName,
}: {
  query: UseQueryResult<DashSummaryResponse>;
  rangeName: string;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const current = query.data?.current;
  if (!current) {
    return query.error ? null : <ActivityIndicator accessibilityLabel={t('common.loading')} />;
  }
  const sent = current.sent;
  const received = current.replies;
  const total = sent + received;
  const share = total > 0 ? sent / total : 0;
  return (
    <TitledCard
      title={t('summary.allMessages.title')}
      note={rangeName}
      trailing={formatCount(total, i18n.language)}
    >
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={t('summary.allMessages.title')}
        accessibilityValue={{ text: `${compact(sent)} / ${compact(received)}` }}
        style={[styles.split, { backgroundColor: colors.border }]}
      >
        {total > 0 ? (
          <>
            <View style={{ flex: share, backgroundColor: colors.chartSent }} />
            <View style={{ flex: 1 - share, backgroundColor: colors.success }} />
          </>
        ) : null}
      </View>
      <View style={styles.legend}>
        <LegendRow
          color={colors.chartSent}
          label={t('summary.allMessages.sent')}
          value={compact(sent)}
        />
        <LegendRow
          color={colors.success}
          label={t('summary.allMessages.received')}
          value={compact(received)}
        />
      </View>
    </TitledCard>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  split: { height: 20, flexDirection: 'row', borderRadius: radius.pill, overflow: 'hidden' },
  legend: { gap: spacing.sm },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dot: { width: 14, height: 14, borderRadius: radius.pill },
});
