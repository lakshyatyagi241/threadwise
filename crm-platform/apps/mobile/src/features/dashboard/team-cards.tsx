import type { DashWidgets } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/ui/panel';
import { Text } from '@/components/ui/text';
import { compact } from '@/lib/format/numbers';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { ago, humanize, type AgoUnit } from './format';

const AGO_KEY = {
  minute: 'dashboard.ago.minute',
  hour: 'dashboard.ago.hour',
  day: 'dashboard.ago.day',
} as const satisfies Record<AgoUnit, string>;

/** "5 minutes ago" in the person's language. */
function useAgo() {
  const { t } = useTranslation();
  return (from: string, now: Date): string => {
    const { unit, count } = ago(from, now);
    return t(AGO_KEY[unit], { count });
  };
}

/** Live inbox preview (TW-DASH-016): how many are waiting and the latest conversations. */
export function InboxCard({ data, now }: { data: DashWidgets['inbox']; now: Date }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const agoText = useAgo();
  const subtitle =
    data.unread > 0 && data.oldestUnreadAt
      ? `${t('dashboard.inbox.unread', { n: data.unread })} - ${t('dashboard.inbox.oldest', { when: agoText(data.oldestUnreadAt, now) })}`
      : t('dashboard.inbox.unread', { n: data.unread });
  return (
    <Panel testID="card-inbox" title={t('dashboard.inbox.title')} subtitle={subtitle}>
      {data.recent.length === 0 ? (
        <Text variant="caption" muted>
          {t('dashboard.inbox.empty')}
        </Text>
      ) : (
        <View style={styles.list}>
          <Text variant="overline" muted>
            {t('dashboard.inbox.recent')}
          </Text>
          {data.recent.map((conversation) => (
            <View key={conversation.uuid} style={styles.conversation}>
              <View style={[styles.avatar, { backgroundColor: colors.primarySoft }]}>
                <Text
                  variant="caption"
                  color="primary"
                  style={styles.avatarText}
                  importantForAccessibility="no"
                >
                  {conversation.title.slice(0, 2)}
                </Text>
              </View>
              <View style={styles.fill}>
                <View style={styles.row}>
                  <Text variant="label" numberOfLines={1} style={styles.fill}>
                    {conversation.title}
                  </Text>
                  {conversation.at ? (
                    <Text variant="caption" muted>
                      {agoText(conversation.at, now)}
                    </Text>
                  ) : null}
                </View>
                <Text variant="caption" muted numberOfLines={1}>
                  {conversation.preview || '-'}
                </Text>
              </View>
              {conversation.unread > 0 ? (
                <Badge tone="success" label={String(conversation.unread)} />
              ) : null}
            </View>
          ))}
        </View>
      )}
    </Panel>
  );
}

/** Automation flows (TW-DASH-017): the counters and the six latest flows. (The web also has a promo card to generate a flow from a sentence: it needs the flow builder.) */
export function FlowsCard({
  data,
  showStats = true,
}: {
  data: DashWidgets['flows'];
  /** The three figures at the top; the Bot view shows them as big cards above and leaves them out here. */
  showStats?: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const stats = [
    ['dashboard.flows.stat.flows', data.total],
    ['dashboard.flows.stat.active', data.active],
    ['dashboard.flows.stat.subscribers', data.subscribers],
  ] as const;
  return (
    <Panel
      testID="card-flows"
      title={t('dashboard.flows.title')}
      subtitle={t('dashboard.flows.summary', {
        active: data.active,
        subscribers: data.subscribers,
      })}
    >
      {showStats ? (
        <View style={styles.stats}>
          {stats.map(([key, value]) => (
            <View key={key} style={[styles.stat, { backgroundColor: colors.surfaceMuted }]}>
              <Text variant="caption" muted>
                {t(key)}
              </Text>
              <Text variant="subheading">{compact(value)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {data.recent.length === 0 ? (
        <Text variant="caption" muted>
          {t('dashboard.flows.empty')}
        </Text>
      ) : (
        <View style={styles.list}>
          {data.recent.map((flow) => (
            <View key={flow.uuid} style={styles.conversation}>
              <View style={styles.fill}>
                <Text variant="label" numberOfLines={1}>
                  {flow.name}
                </Text>
                <Text variant="caption" muted numberOfLines={2}>
                  {t('dashboard.flows.meta', {
                    trigger: humanize(flow.trigger),
                    steps: flow.steps,
                    subs: flow.subscribers,
                  })}
                </Text>
              </View>
              <Badge
                tone={flow.active ? 'success' : 'neutral'}
                label={
                  flow.active
                    ? t('dashboard.flows.statusActive')
                    : t('dashboard.flows.statusPaused')
                }
              />
            </View>
          ))}
        </View>
      )}
    </Panel>
  );
}

/** Workspace activity log (TW-DASH-019): the latest audit rows of this workspace. */
export function ActivityCard({ data, now }: { data: DashWidgets['activity']; now: Date }) {
  const { t } = useTranslation();
  const agoText = useAgo();
  return (
    <Panel
      testID="card-activity"
      title={t('dashboard.activity.title')}
      subtitle={t('dashboard.activity.subtitle')}
    >
      {data.length === 0 ? (
        <Text variant="caption" muted>
          {t('dashboard.activity.empty')}
        </Text>
      ) : (
        <View style={styles.list}>
          {data.map((entry, index) => (
            <View key={`${entry.at}-${index}`} style={styles.row}>
              <Text style={styles.fill} numberOfLines={2}>
                {t('dashboard.activity.by', {
                  actor: entry.actor ?? '-',
                  module: entry.module,
                  action: entry.action,
                })}
              </Text>
              <Text variant="caption" muted>
                {agoText(entry.at, now)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  conversation: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontWeight: '700', textTransform: 'uppercase' },
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, borderRadius: radius.md, padding: spacing.md, gap: 2 },
});
