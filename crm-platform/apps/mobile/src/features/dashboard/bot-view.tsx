import type { DashWidgets } from '@crm/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { messageForError } from '@/lib/api/error-message';
import { formatCount } from '@/lib/format/numbers';
import { spacing } from '@/lib/theme/tokens';
import { PairCard } from './summary-cards';
import { FlowsCard } from './team-cards';

interface Props {
  query: UseQueryResult<DashWidgets>;
  onRetry: () => void;
}

/**
 * The Bot view: the automation flows that answer customers without a person. Two big figures (flows running, people in them), then
 * the latest flows with their trigger, steps and state. The flow counters ignore the date window, so this view has no date pill.
 */
export function BotView({ query, onRetry }: Props) {
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

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
});
