import type { DashWidgets } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/ui/panel';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Text } from '@/components/ui/text';
import { compact } from '@/lib/format/numbers';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { CAMPAIGN_TONE, TEMPLATE_TONE, campaignStatus, templateStatus } from './status';

/** Active campaigns (TW-DASH-013): the latest few with how far each has got. */
export function CampaignsCard({ data }: { data: DashWidgets['campaigns'] }) {
  const { t } = useTranslation();
  return (
    <Panel
      testID="card-campaigns"
      title={t('dashboard.campaigns.title')}
      subtitle={t('dashboard.campaigns.summary', {
        running: data.running,
        scheduled: data.scheduled,
        paused: data.paused,
      })}
      trailing={<Badge label={t('dashboard.campaigns.total', { n: data.total })} />}
    >
      {data.recent.length === 0 ? (
        <View style={styles.empty}>
          <Text variant="label">{t('dashboard.campaigns.emptyTitle')}</Text>
          <Text variant="caption" muted>
            {t('dashboard.campaigns.emptyBody')}
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {data.recent.map((campaign) => {
            const status = campaignStatus(campaign.status);
            return (
              <View key={campaign.uuid} style={styles.item}>
                <View style={styles.row}>
                  <Text variant="label" style={styles.fill} numberOfLines={1}>
                    {campaign.name ?? t('dashboard.campaigns.untitled')}
                  </Text>
                  <Badge
                    tone={status ? CAMPAIGN_TONE[status] : 'neutral'}
                    label={status ? t(`dashboard.campaigns.status.${status}`) : campaign.status}
                  />
                </View>
                {campaign.category || campaign.template ? (
                  <Text variant="caption" muted numberOfLines={1}>
                    {[campaign.category, campaign.template].filter(Boolean).join(' - ')}
                  </Text>
                ) : null}
                <ProgressBar percent={campaign.pct} />
                <View style={styles.row}>
                  <Text variant="caption" muted style={styles.fill}>
                    {t('dashboard.campaigns.delivered', {
                      done: campaign.done,
                      total: campaign.total,
                    })}
                  </Text>
                  <Text variant="caption" muted>
                    {`${campaign.pct}%`}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </Panel>
  );
}

/** Top performing templates (TW-DASH-015): the web table, as one block per template. "CTR" is shown as what it measures, the read rate. */
export function TemplatesCard({ data }: { data: DashWidgets['templates'] }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Panel
      testID="card-templates"
      title={t('dashboard.templates.title')}
      subtitle={t('dashboard.templates.subtitle')}
      trailing={<Badge label={t('dashboard.templates.count', { count: data.count })} />}
    >
      {data.rows.length === 0 ? (
        <Text variant="caption" muted>
          {t('dashboard.templates.empty')}
        </Text>
      ) : (
        <View style={styles.list}>
          {data.rows.map((row) => {
            const status = templateStatus(row.status);
            const sent = row.sent > 0;
            return (
              <View key={row.uuid} style={[styles.template, { borderColor: colors.border }]}>
                <View style={styles.row}>
                  <View style={styles.fill}>
                    <Text variant="label" numberOfLines={1}>
                      {row.name}
                    </Text>
                    <Text variant="caption" muted numberOfLines={1}>
                      {[row.language?.toUpperCase(), row.category, row.type]
                        .filter(Boolean)
                        .join(' - ') || '-'}
                    </Text>
                  </View>
                  <Badge
                    tone={status ? TEMPLATE_TONE[status] : 'neutral'}
                    label={status ? t(`dashboard.templates.status.${status}`) : row.status}
                  />
                </View>
                <View style={styles.stats}>
                  <Stat
                    label={t('dashboard.templates.sent')}
                    value={sent ? compact(row.sent) : '-'}
                  />
                  <Stat
                    label={t('dashboard.templates.delivered')}
                    value={sent ? compact(row.delivered) : '-'}
                  />
                  <Stat
                    label={t('dashboard.templates.read')}
                    value={sent ? compact(row.read) : '-'}
                  />
                  <Stat
                    label={t('dashboard.templates.readRate')}
                    value={row.readRatePct !== null ? `${row.readRatePct}%` : '-'}
                  />
                </View>
                {sent ? <ProgressBar percent={row.performance} /> : null}
              </View>
            );
          })}
        </View>
      )}
    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="caption" muted numberOfLines={1}>
        {label}
      </Text>
      <Text variant="label">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { gap: spacing.lg },
  item: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  empty: { gap: spacing.xs },
  template: { gap: spacing.sm, borderTopWidth: 1, paddingTop: spacing.md },
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, gap: 2 },
});
