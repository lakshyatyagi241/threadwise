import type { AnalyticsPanels } from '@crm/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { messageForError } from '@/lib/api/error-message';
import { formatCount } from '@/lib/format/numbers';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { isForbidden, isPlanLocked } from './format';
import { PairCard, TitledCard } from './summary-cards';

/** What a figure that does not exist (nobody answered, nobody rated) shows. */
const DASH = '—';

type Team = AnalyticsPanels['team'][number];

/** A wait in minutes as people say it: "12 min", "3.5 h", "2 d". Null when there is nothing to average. */
export function formatWait(minutes: number | null, t: TFunction): string {
  if (minutes === null) return DASH;
  const one = (n: number) => String(Math.round(n * 10) / 10);
  if (minutes < 60) return t('dashboard.agents.minutes', { value: one(minutes) });
  if (minutes < 1440) return t('dashboard.agents.hours', { value: one(minutes / 60) });
  return t('dashboard.agents.days', { value: one(minutes / 1440) });
}

interface Props {
  query: UseQueryResult<AnalyticsPanels>;
  /** The person may read analytics (`dash.analytics.read`); without it nothing was asked of the API. */
  allowed: boolean;
  role: string;
  /** The window as written under the title ("13 Sep – 12 Oct 2026"). */
  rangeName: string;
  onRetry: () => void;
}

/**
 * The Agent view: how each person of the team did in the window. Totals first (conversations given, resolved), then one block per
 * person with their resolved count, first-reply and resolution times and the customers' rating. These are the numbers of the web
 * analytics page's team panel; an empty team (nobody was given a conversation in the window) says so.
 */
export function AgentView({ query, allowed, role, rangeName, onRetry }: Props) {
  const { t, i18n } = useTranslation();
  const n = (value: number) => formatCount(value, i18n.language);

  if (!allowed) {
    return (
      <Card>
        <Text accessibilityRole="alert">{t('dashboard.agents.noAccess', { role })}</Text>
      </Card>
    );
  }
  if (query.error && !query.data) {
    return (
      <Card>
        <View style={styles.stack}>
          <Text danger accessibilityRole="alert">
            {isPlanLocked(query.error)
              ? t('dashboard.error.locked')
              : isForbidden(query.error)
                ? t('dashboard.agents.noAccess', { role })
                : messageForError(query.error, t)}
          </Text>
          {isForbidden(query.error) ? null : (
            <Button variant="secondary" label={t('common.retry')} onPress={onRetry} />
          )}
        </View>
      </Card>
    );
  }
  if (!query.data) return <ActivityIndicator accessibilityLabel={t('common.loading')} />;

  const team = query.data.team;
  const given = team.reduce((sum, agent) => sum + agent.conversations, 0);
  const resolved = team.reduce((sum, agent) => sum + agent.resolved, 0);
  return (
    <>
      <PairCard
        left={{
          title: t('dashboard.agents.conversations'),
          subtitle: rangeName,
          value: n(given),
          icon: 'chatbubbles-outline',
          tone: 'primary',
        }}
        right={{
          title: t('dashboard.agents.resolved'),
          subtitle: rangeName,
          value: n(resolved),
          icon: 'checkmark-done-outline',
          tone: 'success',
        }}
      />
      <TitledCard
        title={t('dashboard.agents.title')}
        note={rangeName}
        trailing={team.length > 0 ? n(team.length) : undefined}
      >
        {team.length === 0 ? (
          <Text variant="caption" muted>
            {t('dashboard.agents.empty')}
          </Text>
        ) : (
          <View style={styles.list}>
            {team.map((agent) => (
              <AgentRow key={agent.userUuid} agent={agent} />
            ))}
          </View>
        )}
      </TitledCard>
    </>
  );
}

function AgentRow({ agent }: { agent: Team }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  // Numbers and punctuation only, so there is nothing to translate: "4.6 (9)" is the average and how many ratings it rests on.
  const rating =
    agent.csatAvg === null
      ? DASH
      : `${Math.round(agent.csatAvg * 10) / 10} (${formatCount(agent.csatCount, i18n.language)})`;
  const figures: [string, string][] = [
    [t('dashboard.agents.resolved'), formatCount(agent.resolved, i18n.language)],
    [t('dashboard.agents.csat'), rating],
    [t('dashboard.agents.firstReply'), formatWait(agent.avgFirstResponseMin, t)],
    [t('dashboard.agents.resolution'), formatWait(agent.avgResolutionMin, t)],
  ];
  return (
    <View
      accessible
      accessibilityLabel={`${agent.name}: ${t('dashboard.agents.conversations')} ${formatCount(agent.conversations, i18n.language)}, ${figures.map(([label, value]) => `${label} ${value}`).join(', ')}`}
      style={styles.agent}
    >
      <View style={styles.head}>
        <Avatar name={agent.name} seed={agent.userUuid} size={40} />
        <View style={styles.fill}>
          <Text variant="label" numberOfLines={1}>
            {agent.name}
          </Text>
          <Text variant="caption" muted numberOfLines={1}>
            {agent.email}
          </Text>
        </View>
        <View style={styles.count}>
          <Text variant="subheading">{formatCount(agent.conversations, i18n.language)}</Text>
          <Text variant="caption" muted>
            {t('dashboard.agents.conversations')}
          </Text>
        </View>
      </View>
      <View style={styles.figures}>
        {figures.map(([label, value]) => (
          <View key={label} style={[styles.figure, { backgroundColor: colors.surfaceMuted }]}>
            <Text variant="caption" muted numberOfLines={1}>
              {label}
            </Text>
            <Text variant="label" numberOfLines={1}>
              {value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  list: { gap: spacing.lg },
  agent: { gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  fill: { flex: 1 },
  count: { alignItems: 'flex-end' },
  figures: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  figure: {
    flexBasis: '48%',
    flexGrow: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 2,
  },
});
