import type { LeadEventResponse, LeadSourceResponse } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import { formatMoment } from '@/lib/format/dates';
import { can, useSession } from '@/lib/session/use-session';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { isNotFound, isPlanLocked, retryMessage } from './lead-errors';
import { LeadEventRow } from './lead-event-row';
import { LeadEventSheet } from './lead-event-sheet';
import { EVENT_FILTERS, type EventFilter } from './lead-model';
import { LeadSkeleton } from './lead-skeleton';
import { LEADS_MANAGE, LEADS_READ } from './leads-screen';
import { firstParam } from './route-params';
import {
  sourceKey,
  useLeadEvents,
  useLeadSource,
  useRetryEvent,
  useSetSourceStatus,
} from './use-leads';

/**
 * One lead source: how it is doing (active or paused, its last lead, how many wait) and the leads it received, newest first, a page
 * at a time, filtered to all, those that need review or those that failed. A lead opens its details, where a person who may manage
 * lead sources can retry it. Pausing asks first, because the source's URL then answers 404 and its leads are not received.
 */
export function LeadSourceScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = firstParam(params.id);
  const session = useSession();
  const allowed = can(session.data, LEADS_READ);
  const canManage = can(session.data, LEADS_MANAGE);

  const [filter, setFilter] = useState<EventFilter>('all');
  const [open, setOpen] = useState<LeadEventResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryNotice, setRetryNotice] = useState<string | null>(null);
  const [pausing, setPausing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const source = useLeadSource(id, allowed);
  const events = useLeadEvents(id, filter, allowed && source.isSuccess);
  const rows = useMemo(() => events.data?.pages.flatMap((p) => p.data) ?? [], [events.data]);
  const setStatus = useSetSourceStatus();
  const retry = useRetryEvent(id);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/leads'));

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([source.refetch(), events.refetch()]);
    setRefreshing(false);
  };

  const changeStatus = (current: LeadSourceResponse) => {
    setNotice(null);
    setStatus.mutate(current, {
      onSuccess: (updated) =>
        setNotice(
          t(updated.status === 'paused' ? 'leads.detail.pausedToast' : 'leads.detail.resumedToast'),
        ),
      onError: (error) => {
        // Someone else changed or removed the source first: show what is there now and say why nothing happened.
        if (isApiError(error) && error.isRowVersionConflict) setNotice(t('leads.errors.conflict'));
        else if (isNotFound(error)) setNotice(t('leads.errors.notFound'));
        else setNotice(messageForError(error, t));
        void queryClient.invalidateQueries({ queryKey: sourceKey(id) });
      },
    });
  };

  const runRetry = (event: LeadEventResponse) => {
    setRetryNotice(null);
    retry.mutate(event, {
      onSuccess: (answer) => {
        setOpen(null);
        setNotice(
          t('leads.events.retriedToast', { status: t(`leads.eventStatus.${answer.event.status}`) }),
        );
      },
      onError: (error) => setRetryNotice(retryMessage(error, t)),
    });
  };

  const openEvent = useCallback((event: LeadEventResponse) => {
    setRetryNotice(null);
    setOpen(event);
  }, []);

  const header = (current: LeadSourceResponse) => (
    <View style={styles.header}>
      <Card>
        <View style={styles.titleRow}>
          <Text variant="heading" numberOfLines={2} style={styles.fill}>
            {current.name}
          </Text>
          <Badge
            label={t(`leads.sourceStatus.${current.status}`)}
            tone={current.status === 'active' ? 'success' : 'warning'}
          />
        </View>
        <Text muted>{t(`leads.kinds.${current.kind}`)}</Text>
        <Detail
          label={t('leads.detail.lastEvent')}
          value={
            current.lastEventAt
              ? formatMoment(current.lastEventAt, i18n.language)
              : t('leads.detail.noEvents')
          }
        />
        {current.kind === 'connector' ? (
          <Text variant="caption" muted>
            {t('leads.detail.connector')}
          </Text>
        ) : (
          <>
            <Text variant="caption" muted>
              {current.tokenHint
                ? t('leads.detail.endsIn', { hint: current.tokenHint })
                : t('leads.detail.noHint')}
            </Text>
            <Text variant="caption" muted>
              {current.hasSecret ? t('leads.detail.secretYes') : t('leads.detail.secretNo')}
            </Text>
          </>
        )}
        {current.status === 'paused' ? (
          <Banner tone="warning" message={t('leads.detail.pausedNote')} />
        ) : null}
        {current.needsAttention > 0 ? (
          <Banner
            tone="warning"
            message={t('leads.detail.needsAttention', { count: current.needsAttention })}
          />
        ) : null}
        {canManage ? (
          <Button
            variant="secondary"
            label={current.status === 'active' ? t('leads.detail.pause') : t('leads.detail.resume')}
            loading={setStatus.isPending}
            onPress={() => (current.status === 'active' ? setPausing(true) : changeStatus(current))}
          />
        ) : null}
      </Card>
      {notice ? <Banner tone="info" message={notice} /> : null}
      <Text variant="subheading" accessibilityRole="header">
        {t('leads.events.title')}
      </Text>
      <SegmentedControl
        label={t('leads.events.filterStatus')}
        value={filter}
        onChange={setFilter}
        options={EVENT_FILTERS.map((value) => ({
          value,
          label: t(`leads.eventFilters.${value}`),
        }))}
      />
    </View>
  );

  let body;
  if (session.data === undefined || (allowed && source.isPending)) {
    body = <LeadSkeleton />;
  } else if (!allowed) {
    body = (
      <EmptyState
        icon="lock-closed-outline"
        title={t('leads.states.noAccessTitle')}
        hint={t('leads.states.noAccessBody', { permission: LEADS_READ })}
      />
    );
  } else if (source.isError) {
    body = isPlanLocked(source.error) ? (
      <EmptyState
        icon="lock-closed-outline"
        title={t('leads.states.lockedTitle')}
        hint={t('leads.states.lockedBody')}
      />
    ) : isNotFound(source.error) ? (
      <EmptyState icon="funnel-outline" title={t('leads.errors.notFound')} />
    ) : (
      <View style={styles.header}>
        <Card>
          <Text danger accessibilityRole="alert">
            {messageForError(source.error, t)}
          </Text>
          <Button
            variant="secondary"
            label={t('common.retry')}
            onPress={() => void source.refetch()}
          />
        </Card>
      </View>
    );
  } else {
    body = (
      <FlatList
        testID="lead-events-list"
        data={rows}
        keyExtractor={(event) => event.id}
        renderItem={({ item }) => <LeadEventRow event={item} onOpen={openEvent} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        ListHeaderComponent={source.data ? header(source.data) : null}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (events.hasNextPage && !events.isFetchingNextPage) void events.fetchNextPage();
        }}
        ListEmptyComponent={
          events.isPending ? (
            <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.footer} />
          ) : events.isError ? (
            <View style={styles.header}>
              <Text danger accessibilityRole="alert">
                {messageForError(events.error, t)}
              </Text>
              <Button
                variant="secondary"
                label={t('common.retry')}
                onPress={() => void events.refetch()}
              />
            </View>
          ) : filter === 'all' ? (
            <EmptyState
              icon="funnel-outline"
              title={t('leads.events.emptyTitle')}
              hint={t('leads.events.empty')}
            />
          ) : (
            <EmptyState
              icon="funnel-outline"
              title={t('leads.events.emptyFilteredTitle')}
              hint={t('leads.events.emptyFiltered')}
            />
          )
        }
        ListFooterComponent={
          events.isFetchingNextPage ? (
            <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.footer} />
          ) : null
        }
        contentContainerStyle={styles.listContent}
      />
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader title={t('leads.detail.pageTitle')} onBack={goBack} />
      <View style={styles.fill}>{body}</View>

      <LeadEventSheet
        event={open}
        canRetry={canManage}
        canOpenContact={can(session.data, 'record.contacts.read')}
        canOpenDeal={can(session.data, 'record.deals.read')}
        retrying={retry.isPending}
        notice={retryNotice}
        onRetry={runRetry}
        onOpenContact={(contactId) => {
          setOpen(null);
          router.push({ pathname: '/contact/[id]', params: { id: contactId } });
        }}
        onOpenDeal={(dealId) => {
          setOpen(null);
          router.push({ pathname: '/deal/[id]', params: { id: dealId } });
        }}
        onClose={() => setOpen(null)}
      />

      <ConfirmDialog
        visible={pausing}
        title={t('leads.detail.confirm.pause.title')}
        message={t('leads.detail.confirm.pause.body')}
        confirmLabel={t('leads.detail.confirm.pause.action')}
        cancelLabel={t('leads.detail.confirm.cancel')}
        pending={setStatus.isPending}
        onConfirm={() => {
          setPausing(false);
          if (source.data) changeStatus(source.data);
        }}
        onCancel={() => setPausing(false)}
      />
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="caption" muted>
        {label}
      </Text>
      <Text variant="body">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { padding: spacing.lg, gap: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  detail: { gap: spacing.xs },
  footer: { paddingVertical: spacing.lg },
  listContent: { flexGrow: 1 },
});
