import type { AnalyticsConversations, ConversationStatusCounts } from '@crm/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SelectField } from '@/components/ui/select-field';
import { Text } from '@/components/ui/text';
import { messageForError } from '@/lib/api/error-message';
import { formatCount } from '@/lib/format/numbers';
import { spacing } from '@/lib/theme/tokens';
import { formatWait, isForbidden, isPlanLocked } from './format';
import { StatCard, StatusGrid, TitledCard, type GridItem } from './summary-cards';

interface Props {
  query: UseQueryResult<AnalyticsConversations>;
  /** The person (a user uuid) the headline is narrowed to; absent means everyone. */
  agent: string | undefined;
  onAgent: (agent: string | undefined) => void;
  role: string;
  rangeName: string;
  onRetry: () => void;
}

/** The value of the "everyone" choice of the agent picker. */
const EVERYONE = 'all';

/**
 * The top of the Agent view: a picker for one person (or everyone), the conversation status tiles (open, pending, closed, assigned,
 * unassigned, unattended) with their total, the two average times, and the status counts of one person at a time.
 */
export function ConversationStats({ query, agent, onAgent, role, rangeName, onRetry }: Props) {
  const { t, i18n } = useTranslation();
  const n = (value: number) => formatCount(value, i18n.language);
  const [byAgent, setByAgent] = useState<string | undefined>(undefined);

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
  const data = query.data;
  if (!data) return <ActivityIndicator accessibilityLabel={t('common.loading')} />;

  const options = [
    { value: EVERYONE, label: t('dashboard.agents.everyone') },
    ...data.agents.map((a) => ({ value: a.userUuid, label: a.name })),
  ];
  const picked = data.agents.find((a) => a.userUuid === (byAgent ?? data.agents[0]?.userUuid));
  const tiles = (c: ConversationStatusCounts): GridItem[] => [
    {
      key: 'open',
      icon: 'lock-open-outline',
      label: t('dashboard.agents.status.open'),
      value: n(c.open),
    },
    {
      key: 'pending',
      icon: 'time-outline',
      label: t('dashboard.agents.status.pending'),
      value: n(c.pending),
    },
    {
      key: 'closed',
      icon: 'lock-closed-outline',
      label: t('dashboard.agents.status.closed'),
      value: n(c.closed),
    },
    {
      key: 'assigned',
      icon: 'person-circle-outline',
      label: t('dashboard.agents.status.assigned'),
      value: n(c.assigned),
    },
    {
      key: 'unassigned',
      icon: 'person-remove-outline',
      label: t('dashboard.agents.status.unassigned'),
      value: n(c.unassigned),
    },
    {
      key: 'unattended',
      icon: 'alert-circle-outline',
      label: t('dashboard.agents.status.unattended'),
      value: n(c.unattended),
    },
  ];
  return (
    <>
      <SelectField
        label={t('dashboard.agents.pickerLabel')}
        placeholder={t('dashboard.agents.pickerPlaceholder')}
        options={options}
        value={agent ?? EVERYONE}
        onChange={(value) => onAgent(value === EVERYONE ? undefined : value)}
      />
      <TitledCard
        title={t('dashboard.agents.statusTitle')}
        note={rangeName}
        trailing={n(data.counts.total)}
      >
        <StatusGrid items={tiles(data.counts)} />
      </TitledCard>
      <StatCard
        title={t('dashboard.agents.avgResolution')}
        value={formatWait(data.avgResolutionMin, t)}
        icon="checkmark-done-outline"
        tone="primary"
      />
      <StatCard
        title={t('dashboard.agents.avgDuration')}
        value={formatWait(data.avgDurationMin, t)}
        icon="timer-outline"
        tone="instagram"
      />
      {data.agents.length > 0 ? (
        <TitledCard title={t('dashboard.agents.byAgentTitle')}>
          <View style={styles.stack}>
            <SelectField
              label={t('dashboard.agents.byAgentPicker')}
              placeholder={t('dashboard.agents.pickerPlaceholder')}
              options={data.agents.map((a) => ({ value: a.userUuid, label: a.name }))}
              value={picked?.userUuid}
              onChange={setByAgent}
            />
            {picked ? (
              <View style={styles.rows}>
                {tiles(picked.counts).map((row) => (
                  <View
                    key={row.key}
                    accessible
                    accessibilityLabel={`${row.label}: ${row.value}`}
                    style={styles.row}
                  >
                    <Text>{row.label}</Text>
                    <Text variant="label">{row.value}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </TitledCard>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  rows: { gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
});
