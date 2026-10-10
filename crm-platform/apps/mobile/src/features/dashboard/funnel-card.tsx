import type { DashFunnel } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Panel } from '@/components/ui/panel';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Text } from '@/components/ui/text';
import { compact } from '@/lib/format/numbers';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { funnelStages } from './funnel-model';
import { Trend } from './trend';

const STAGE_KEY = {
  messaged: 'dashboard.funnel.stage.messaged',
  delivered: 'dashboard.funnel.stage.delivered',
  replied: 'dashboard.funnel.stage.replied',
  goalCompleted: 'dashboard.funnel.stage.goalCompleted',
} as const;

const SEPARATOR = ' · ';

/**
 * The Engagement funnel (TW-DASH-012): contacts messaged, delivered, replied and goal completed as bars of the share of contacts
 * messaged, the conversation activity under it, and the reply rate against the previous window.
 */
export function FunnelCard({ funnel, subtitle }: { funnel: DashFunnel; subtitle: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const stages = funnelStages(funnel);
  const { activity, comparison } = funnel;
  const summary = [
    t('dashboard.funnel.activity.inbound', { count: activity.inbound }),
    t('dashboard.funnel.activity.responding', { count: activity.respondingContacts }),
    t('dashboard.funnel.activity.perContact', { value: activity.repliesPerContact ?? '-' }),
  ].join(SEPARATOR);
  return (
    <Panel testID="engagement-funnel" title={t('dashboard.funnel.title')} subtitle={subtitle}>
      <View style={styles.list}>
        {stages.map((stage) => (
          <View
            key={stage.key}
            accessible
            accessibilityLabel={t('dashboard.funnel.stageLabel', {
              stage: t(STAGE_KEY[stage.key]),
              n: stage.count,
              pct: stage.pct,
            })}
            style={styles.stage}
          >
            <View style={styles.row}>
              <Text variant="label" style={styles.fill} importantForAccessibility="no">
                {t(STAGE_KEY[stage.key])}
              </Text>
              <Text
                variant="label"
                importantForAccessibility="no"
              >{`${compact(stage.count)} · ${stage.pct}%`}</Text>
            </View>
            <ProgressBar percent={stage.pct} />
          </View>
        ))}
      </View>
      <View style={[styles.section, { borderColor: colors.border }]}>
        <Text variant="caption" muted style={styles.upper}>
          {t('dashboard.funnel.activity.title')}
        </Text>
        <Text testID="funnel-activity">{summary}</Text>
      </View>
      {comparison ? (
        <View style={styles.compare} testID="funnel-comparison">
          <Text variant="caption" muted style={styles.upper}>
            {t('dashboard.funnel.comparison.title')}
          </Text>
          <View style={styles.row}>
            <Text muted>{t('dashboard.funnel.comparison.replyRate')}</Text>
            <Text variant="label">{`${funnel.replyRate}%`}</Text>
            <Trend delta={comparison.replyRatePp} unit="pp" mildDown />
          </View>
        </View>
      ) : null}
    </Panel>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { gap: spacing.md },
  stage: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  section: { borderTopWidth: 1, paddingTop: spacing.md, gap: spacing.xs },
  compare: { gap: spacing.xs },
  upper: { textTransform: 'uppercase', letterSpacing: 1 },
});
