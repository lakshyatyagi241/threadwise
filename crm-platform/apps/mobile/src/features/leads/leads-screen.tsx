import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { messageForError } from '@/lib/api/error-message';
import { can, useSession } from '@/lib/session/use-session';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { isPlanLocked } from './lead-errors';
import { totalNeedingAttention } from './lead-model';
import { LeadSkeleton } from './lead-skeleton';
import { LeadSourceRow } from './lead-source-row';
import { useLeadSources } from './use-leads';

export const LEADS_READ = 'leads.sources.read';
export const LEADS_MANAGE = 'leads.sources.manage';

/**
 * Social leads: the lead sources of the workspace (the doors ad and landing-page leads come in through) with how many of their
 * leads wait for a person. A source opens the leads it received. Without the permission to read lead sources, or on a plan without
 * them, the screen says so and nothing is requested. Creating and mapping a source is done on the web.
 */
export function LeadsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const session = useSession();
  const allowed = can(session.data, LEADS_READ);
  const canManage = can(session.data, LEADS_MANAGE);
  const list = useLeadSources(allowed);
  const [refreshing, setRefreshing] = useState(false);

  const sources = list.data ?? [];
  const waiting = totalNeedingAttention(sources);
  const locked = list.isError && isPlanLocked(list.error);

  const refresh = async () => {
    setRefreshing(true);
    await list.refetch();
    setRefreshing(false);
  };
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/menu'));
  const open = (id: string) => router.push({ pathname: '/lead-source/[id]', params: { id } });

  let body;
  if (session.data === undefined) {
    body = session.isError ? (
      <ErrorCard error={session.error} onRetry={() => void session.refetch()} />
    ) : (
      <LeadSkeleton />
    );
  } else if (!allowed) {
    body = (
      <EmptyState
        icon="lock-closed-outline"
        title={t('leads.states.noAccessTitle')}
        hint={t('leads.states.noAccessBody', { permission: LEADS_READ })}
      />
    );
  } else if (list.isPending) {
    body = <LeadSkeleton />;
  } else if (locked) {
    body = (
      <EmptyState
        icon="lock-closed-outline"
        title={t('leads.states.lockedTitle')}
        hint={t('leads.states.lockedBody')}
      />
    );
  } else if (list.isError) {
    body = <ErrorCard error={list.error} onRetry={() => void list.refetch()} />;
  } else {
    body = (
      <FlatList
        testID="lead-sources-list"
        data={sources}
        keyExtractor={(source) => source.id}
        renderItem={({ item }) => <LeadSourceRow source={item} onOpen={open} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        ListHeaderComponent={
          waiting > 0 ? (
            <View style={styles.notice}>
              <Banner tone="warning" message={t('leads.page.attention', { count: waiting })} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            icon="funnel-outline"
            title={t('leads.sources.emptyTitle')}
            hint={canManage ? t('leads.sources.empty') : t('leads.sources.emptyNoManage')}
          />
        }
        contentContainerStyle={styles.listContent}
      />
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader title={t('leads.title')} onBack={goBack} />
      <View style={styles.fill}>{body}</View>
    </View>
  );
}

function ErrorCard({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.error}>
      <Card>
        <Text danger accessibilityRole="alert">
          {messageForError(error, t)}
        </Text>
        <Button variant="secondary" label={t('common.retry')} onPress={onRetry} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  notice: { padding: spacing.lg },
  error: { padding: spacing.lg },
  listContent: { flexGrow: 1 },
});
