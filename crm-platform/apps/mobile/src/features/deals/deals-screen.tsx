import type { DealResponse, DealStageRef } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { HeaderIconButton } from '@/components/ui/screen-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SelectField } from '@/components/ui/select-field';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { isApiError } from '@/lib/api';
import { formatCount } from '@/lib/format/numbers';
import { SEARCH_DEBOUNCE_MS, useDebounced } from '@/lib/hooks/use-debounced';
import { can, useSession } from '@/lib/session/use-session';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { DealActionsSheet } from './deal-actions-sheet';
import { DealCard } from './deal-card';
import { describeDealFailure, isConflict, isNotFound, isPlanLocked } from './deal-errors';
import { DealFilterModal } from './deal-filter-modal';
import { DealSkeleton } from './deal-skeleton';
import { NO_CHOICES, activeChoiceCount, filtersOf, type DealChoices } from './filters';
import { KpiStrip } from './kpi-strip';
import { LostSheet } from './lost-sheet';
import { toLostBody, type LostReasonPayload } from './lost-reasons';
import { formatTotals } from './money';
import { StageSheet } from './stage-sheet';
import { StageStrip } from './stage-strip';
import {
  boardsKey,
  listsKey,
  stagesKey,
  useBoard,
  useColumnDeals,
  useDealList,
  useDeleteDeal,
  useMarkLost,
  useMarkWon,
  useMoveDeal,
  usePipelines,
  useReopenDeal,
} from './use-deals';

const FAB_SIZE = 52;
const FAB_MARGIN = 24;

type View_ = 'board' | 'list';

/** A lost reason is being asked for: for a deal moved into a lost stage (`stageId`) or one marked lost (none). */
interface LostRequest {
  deal: DealResponse;
  stageId?: string;
}

/**
 * The deals of one pipeline. The board is the web's Kanban made for a phone: the stages are a row of tabs with their counts, the
 * open stage's deals are the list under it, and "Move to" replaces dragging a card. The list view shows every deal of the
 * pipeline, newest first, with a status filter. Above both, the pipeline's four KPIs; the search and filter sheet narrow the
 * deals but never the KPIs. Deals open in their own screen; the round button adds one in the stage that is open.
 */
export function DealsScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useSession();
  const allowed = can(session.data, 'record.deals.read');
  const canCreate = can(session.data, 'record.deals.create');
  const canUpdate = can(session.data, 'record.deals.update');
  const canDelete = can(session.data, 'record.deals.delete');
  const canReadSettings = can(session.data, 'record.pipelines.read');
  const myId = session.data?.user.id;

  const [view, setView] = useState<View_>('board');
  const [pipelineId, setPipelineId] = useState<string | undefined>();
  const [stageId, setStageId] = useState<string | undefined>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [choices, setChoices] = useState<DealChoices>(NO_CHOICES);
  const [filterOpen, setFilterOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [menuFor, setMenuFor] = useState<DealResponse | null>(null);
  const [moving, setMoving] = useState<DealResponse | null>(null);
  const [lostFor, setLostFor] = useState<LostRequest | null>(null);
  const [lostError, setLostError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<DealResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const q = useDebounced(searchText.trim(), SEARCH_DEBOUNCE_MS);
  const filters = useMemo(() => filtersOf(choices, q, myId), [choices, q, myId]);
  const listView = view === 'list';
  const narrowed = activeChoiceCount(choices, listView) > 0 || filters.q !== undefined;

  const pipelines = usePipelines(allowed && canReadSettings);
  const board = useBoard(pipelineId, filters, allowed);
  const stages = useMemo(() => board.data?.stages ?? [], [board.data]);
  const active =
    stages.find((s) => s.stage.id === stageId) ??
    stages.find((s) => s.stage.kind === 'open') ??
    stages[0];
  const stageRefs: DealStageRef[] = useMemo(() => stages.map((s) => s.stage), [stages]);
  const hasWon = stages.some((s) => s.stage.kind === 'won');
  const hasLost = stages.some((s) => s.stage.kind === 'lost');

  const column = useColumnDeals(active?.stage.id, filters, allowed && !listView);
  const list = useDealList(
    board.data?.pipeline.id,
    { ...filters, ...(choices.status ? { status: choices.status } : {}) },
    allowed && listView && board.data !== undefined,
  );
  const source = listView ? list : column;
  const deals = useMemo(() => source.data?.pages.flatMap((page) => page.data) ?? [], [source.data]);
  const locked = board.isError && isPlanLocked(board.error);

  const move = useMoveDeal();
  const won = useMarkWon();
  const lost = useMarkLost();
  const reopen = useReopenDeal();
  const remove = useDeleteDeal();
  const busyId = move.isPending
    ? move.variables?.deal.id
    : won.isPending
      ? won.variables?.id
      : reopen.isPending
        ? reopen.variables?.id
        : undefined;

  const refetchAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: boardsKey });
    void queryClient.invalidateQueries({ queryKey: stagesKey });
    void queryClient.invalidateQueries({ queryKey: listsKey });
  }, [queryClient]);

  /** What the person is told when a change did not happen; the lists are refreshed so they show what is there now. */
  const failed = useCallback(
    (error: unknown) => {
      if (isApiError(error) && isConflict(error)) setNotice(t('deals.list.conflict'));
      else setNotice(describeDealFailure(error, t));
      refetchAll();
    },
    [refetchAll, t],
  );

  const open = useCallback(
    (id: string) => router.push({ pathname: '/deal/[id]', params: { id } }),
    [router],
  );
  const more = useCallback((deal: DealResponse) => setMenuFor(deal), []);

  const moveTo = (deal: DealResponse, stage: DealStageRef) => {
    setNotice(null);
    if (stage.kind === 'lost' && deal.status !== 'lost') {
      setLostFor({ deal, stageId: stage.id });
      return;
    }
    move.mutate(
      { deal, body: { stageId: stage.id } },
      {
        onSuccess: () => setNotice(t('deals.list.moved', { stage: stage.name })),
        onError: failed,
      },
    );
  };
  const markWon = (deal: DealResponse) => {
    setNotice(null);
    won.mutate(deal, {
      onSuccess: () => setNotice(t('deals.list.wonDone')),
      onError: failed,
    });
  };
  const reopenDeal = (deal: DealResponse) => {
    setNotice(null);
    reopen.mutate(deal, {
      onSuccess: () => setNotice(t('deals.list.reopened')),
      onError: failed,
    });
  };
  const confirmLost = (reason: LostReasonPayload) => {
    if (!lostFor) return;
    const { deal, stageId: target } = lostFor;
    setLostError(null);
    const done = {
      onSuccess: () => {
        setLostFor(null);
        setNotice(t('deals.list.lostDone'));
      },
      onError: (error: unknown) => {
        // A missing reason keeps the sheet open to try again; anything else closes it and says what happened.
        if (isApiError(error) && !isConflict(error) && !isNotFound(error)) {
          setLostError(describeDealFailure(error, t));
          return;
        }
        setLostFor(null);
        failed(error);
      },
    };
    if (target) {
      move.mutate(
        {
          deal,
          body: {
            stageId: target,
            ...('lostReasonId' in reason || 'lostReason' in reason ? reason : {}),
          },
        },
        done,
      );
    } else {
      lost.mutate({ deal, body: toLostBody(reason) }, done);
    }
  };
  const confirmDelete = () => {
    if (!deleting) return;
    remove.mutate(deleting.id, {
      onSuccess: () => setDeleting(null),
      onError: (error) => {
        setDeleting(null);
        // Already gone counts as deleted: the refreshed list no longer shows it.
        if (isNotFound(error)) refetchAll();
        else failed(error);
      },
    });
  };

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([board.refetch(), source.refetch()]);
    setRefreshing(false);
  };
  const toggleSearch = () => {
    if (searchOpen) setSearchText('');
    setSearchOpen(!searchOpen);
  };
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/menu'));
  const add = () =>
    router.push({
      pathname: '/deal-form',
      params: {
        ...(board.data ? { pipelineId: board.data.pipeline.id } : {}),
        ...(active && !listView ? { stageId: active.stage.id } : {}),
      },
    });

  const header = board.data ? (
    <View>
      {(pipelines.data?.length ?? 0) > 1 ? (
        <View style={styles.pad}>
          <SelectField
            label={t('deals.pipeline.label')}
            placeholder={t('deals.pipeline.label')}
            options={(pipelines.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
            value={board.data.pipeline.id}
            onChange={(id) => {
              setPipelineId(id);
              setStageId(undefined);
            }}
          />
        </View>
      ) : null}
      <View style={styles.pad}>
        <SegmentedControl
          label={t('deals.view.label')}
          value={view}
          onChange={setView}
          options={[
            { value: 'board', label: t('deals.view.board') },
            { value: 'list', label: t('deals.view.list') },
          ]}
        />
      </View>
      <KpiStrip kpis={board.data.kpis} />
      {listView ? null : (
        <>
          <StageStrip stages={stages} selectedId={active?.stage.id} onSelect={setStageId} />
          {active ? (
            <View style={styles.summary}>
              <Text variant="caption" muted>
                {t('deals.column.count', { n: formatCount(active.count, i18n.language) })}
                {' · '}
                {formatTotals(active.total.byCurrency, i18n.language)}
                {active.stage.kind === 'open'
                  ? ` · ${t('deals.column.weighted', {
                      amount: formatTotals(active.weighted.byCurrency, i18n.language),
                    })}`
                  : ''}
              </Text>
            </View>
          ) : null}
        </>
      )}
    </View>
  ) : null;

  let body;
  if (session.data === undefined) {
    body = session.isError ? (
      <ErrorCard error={session.error} onRetry={() => void session.refetch()} />
    ) : (
      <DealSkeleton />
    );
  } else if (!allowed) {
    body = (
      <EmptyState
        icon="lock-closed-outline"
        title={t('deals.denied.title')}
        hint={t('deals.denied.hint')}
      />
    );
  } else if (locked) {
    body = (
      <EmptyState
        icon="lock-closed-outline"
        title={t('deals.planLocked.title')}
        hint={t('deals.planLocked.hint')}
      />
    );
  } else if (board.isPending) {
    body = <DealSkeleton />;
  } else if (board.isError && !board.data) {
    body = <ErrorCard error={board.error} onRetry={() => void board.refetch()} />;
  } else if (stages.length === 0) {
    body = (
      <EmptyState
        icon="git-network-outline"
        title={t('deals.noPipelines.title')}
        hint={t('deals.noPipelines.hint')}
      />
    );
  } else {
    body = (
      <FlatList
        // A new column (or the other view) starts at the top, with its own list.
        key={`${view}:${active?.stage.id ?? ''}:${source.isPending ? 'loading' : 'ready'}`}
        testID="deals-list"
        data={deals}
        extraData={busyId}
        keyExtractor={(deal) => deal.id}
        renderItem={({ item }) => (
          <DealCard
            deal={item}
            showStage={listView}
            canMore={canUpdate || canDelete}
            busy={busyId === item.id}
            onOpen={open}
            onMore={more}
          />
        )}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (source.hasNextPage && !source.isFetchingNextPage) void source.fetchNextPage();
        }}
        ListEmptyComponent={
          source.isPending ? (
            <DealSkeleton />
          ) : source.isError ? (
            <ErrorCard error={source.error} onRetry={() => void source.refetch()} />
          ) : (
            <EmptyState
              icon="cash-outline"
              title={t('deals.empty.title')}
              hint={narrowed ? t('deals.empty.filteredHint') : t('deals.empty.hint')}
            />
          )
        }
        ListFooterComponent={
          source.isFetchingNextPage ? (
            <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.footer} />
          ) : null
        }
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
      />
    );
  }

  const showTools = allowed && !locked && board.data !== undefined;
  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader
        title={t('deals.title')}
        onBack={goBack}
        actions={
          showTools ? (
            <>
              <HeaderIconButton
                icon={searchOpen ? 'close' : 'search-outline'}
                label={searchOpen ? t('deals.search.close') : t('deals.search.open')}
                onPress={toggleSearch}
              />
              <HeaderIconButton
                icon={{ material: 'filter-list' }}
                label={t('deals.filter.open')}
                dot={activeChoiceCount(choices, listView) > 0}
                onPress={() => setFilterOpen(true)}
              />
            </>
          ) : null
        }
      />

      {searchOpen ? (
        <View style={styles.search}>
          <TextField
            label={t('deals.search.label')}
            placeholder={t('deals.search.placeholder')}
            value={searchText}
            onChangeText={setSearchText}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>
      ) : null}

      {notice ? (
        <View style={styles.notice}>
          <Banner tone="info" message={notice} />
        </View>
      ) : null}

      <View style={styles.fill}>{body}</View>

      {showTools && canCreate && stages.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('deals.add')}
          onPress={add}
          style={[styles.fab, { backgroundColor: colors.primary, shadowColor: colors.shadow }]}
        >
          <Icon name="add" size={24} color="onPrimary" />
        </Pressable>
      ) : null}

      {filterOpen ? (
        <DealFilterModal
          choices={choices}
          listView={listView}
          onClose={() => setFilterOpen(false)}
          onApply={(next) => {
            setChoices(next);
            setFilterOpen(false);
          }}
        />
      ) : null}

      <DealActionsSheet
        deal={menuFor}
        canUpdate={canUpdate}
        canDelete={canDelete}
        hasWon={hasWon}
        hasLost={hasLost}
        onClose={() => setMenuFor(null)}
        onOpen={(deal) => {
          setMenuFor(null);
          open(deal.id);
        }}
        onMove={(deal) => {
          setMenuFor(null);
          setMoving(deal);
        }}
        onWon={(deal) => {
          setMenuFor(null);
          markWon(deal);
        }}
        onLost={(deal) => {
          setMenuFor(null);
          setLostError(null);
          setLostFor({ deal });
        }}
        onReopen={(deal) => {
          setMenuFor(null);
          reopenDeal(deal);
        }}
        onEdit={(deal) => {
          setMenuFor(null);
          router.push({ pathname: '/deal-form', params: { dealId: deal.id } });
        }}
        onDelete={(deal) => {
          setMenuFor(null);
          setDeleting(deal);
        }}
      />

      <StageSheet
        visible={moving !== null}
        dealTitle={moving?.title ?? ''}
        stages={stageRefs}
        currentId={moving?.stage.id}
        onClose={() => setMoving(null)}
        onPick={(stage) => {
          const deal = moving;
          setMoving(null);
          if (deal) moveTo(deal, stage);
        }}
      />

      {lostFor ? (
        <LostSheet
          dealTitle={lostFor.deal.title}
          canReadSettings={canReadSettings}
          pending={move.isPending || lost.isPending}
          error={lostError}
          onClose={() => setLostFor(null)}
          onConfirm={confirmLost}
        />
      ) : null}

      <ConfirmDialog
        visible={deleting !== null}
        title={t('deals.delete.title')}
        message={t('deals.delete.message', { title: deleting?.title ?? '' })}
        confirmLabel={t('deals.delete.confirm')}
        cancelLabel={t('deals.cancel')}
        pending={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </View>
  );
}

function ErrorCard({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.error}>
      <Card>
        <Text danger accessibilityRole="alert">
          {describeDealFailure(error, t)}
        </Text>
        <Button variant="secondary" label={t('common.retry')} onPress={onRetry} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  summary: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  search: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  notice: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  error: { padding: spacing.lg },
  footer: { paddingVertical: spacing.lg },
  // Room under the last card for the round button, so it never covers a deal.
  listContent: { flexGrow: 1, paddingBottom: FAB_SIZE + FAB_MARGIN * 2 },
  fab: {
    position: 'absolute',
    end: FAB_MARGIN,
    bottom: FAB_MARGIN,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
});
