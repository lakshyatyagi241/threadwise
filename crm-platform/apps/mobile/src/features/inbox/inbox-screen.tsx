import {
  BULK_MAX_CONVERSATIONS,
  type BulkConversationsResponse,
  type InboxTab,
} from '@crm/contracts';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { MenuTitle } from '@/components/ui/menu-title';
import { HeaderIconButton, ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { messageForError } from '@/lib/api/error-message';
import { can, useSession } from '@/lib/session/use-session';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { BulkBar, type BulkKind } from './bulk-bar';
import { BulkSheets, useBulkInstant } from './bulk-sheets';
import { ConversationRow } from './conversation-row';
import { ConversationSkeleton } from './conversation-skeleton';
import { FilterStrip } from './filter-strip';
import {
  DEFAULT_FILTERS,
  hasActiveFilter,
  TABS,
  type InboxFilters,
  type SortFilter,
  type StatusFilter,
} from './filters';
import { FiltersSheet } from './filters-sheet';
import { useAssignees, useChannels, useConversations } from './use-inbox';
import { useInboxLive } from './use-live';
import { useLabelLibrary } from './use-labels';
import { useDebouncedValue } from './use-debounced-value';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * The Inbox tab: the conversations the person may see, newest first, a page at a time. The header switches the view (all, mine,
 * unassigned, unread), searches, and filters by status. Without the read permission nothing is requested.
 */
export function InboxScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const session = useSession();
  const allowed = can(session.data, 'inbox.conversation.read');

  const [tab, setTab] = useState<InboxTab>('all');
  const [status, setStatus] = useState<StatusFilter>('default');
  const [channelId, setChannelId] = useState('');
  const [labelIds, setLabelIds] = useState<readonly string[]>([]);
  const [archived, setArchived] = useState(false);
  const [agentIds, setAgentIds] = useState<readonly string[]>([]);
  const [sort, setSort] = useState<SortFilter>('recent');
  const [searchOpen, setSearchOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Choosing several conversations (a long press starts it): the ids, in the order chosen, and which action's sheet is open.
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [bulkSheet, setBulkSheet] = useState<BulkKind | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkConversationsResponse | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const selecting = selected.length > 0;
  const canBulk = can(session.data, 'inbox.conversation.bulk');
  // Each action needs its own right on top of the bulk one, as the API checks.
  const bulkAllowed = (
    [
      ['read', 'inbox.conversation.read'],
      ['status', 'inbox.conversation.resolve'],
      ['assign', 'inbox.conversation.assign'],
      ['label', 'inbox.conversation.tag'],
      ['priority', 'inbox.conversation.priority'],
      ['snooze', 'inbox.conversation.snooze'],
      ['spam', 'inbox.conversation.resolve'],
    ] as const
  )
    .filter(([, permission]) => canBulk && can(session.data, permission))
    .map(([kind]) => kind);

  const debounced = useDebouncedValue(typed.trim(), SEARCH_DEBOUNCE_MS);
  // Emptying the box shows the full list straight away; only typing waits for a pause.
  const q = typed.trim() === '' ? '' : debounced;
  const filters = useMemo<InboxFilters>(
    () => ({ tab, status, q, channelId, labels: labelIds, archived, agentIds, sort }),
    [tab, status, q, channelId, labelIds, archived, agentIds, sort],
  );
  const active = hasActiveFilter(filters);
  // The sheet's own filters (not the search words): the dot on the filter button says one of them is on.
  const sheetActive = hasActiveFilter({
    ...DEFAULT_FILTERS,
    status,
    channelId,
    labels: labelIds,
    archived,
    agentIds,
    sort,
  });
  // The chips name a channel and its labels, which the filters hold only as ids.
  const channelList = useChannels(allowed && channelId !== '');
  const labelLibrary = useLabelLibrary(allowed && labelIds.length > 0);
  const agentList = useAssignees(allowed && agentIds.length > 0);
  const channelName = channelList.data?.data.find((c) => c.id === channelId)?.name ?? null;
  const labelNames = labelIds
    .map((id) => labelLibrary.data?.find((l) => l.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  const agentNames = agentIds
    .map((id) => {
      const member = agentList.data?.users.find((m) => m.id === id);
      return member ? (member.name ?? member.email) : undefined;
    })
    .filter((name): name is string => Boolean(name));

  // The tab is in front: ask for news on a timer, and stop when another tab or a conversation covers it.
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const live = useInboxLive();
  const query = useConversations(filters, allowed, focused && !live);
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);
  // The clock for "today" and "yesterday" moves only when the list does.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [query.dataUpdatedAt]);

  const refresh = async () => {
    setRefreshing(true);
    await query.refetch();
    setRefreshing(false);
  };
  const startSelecting = useCallback((id: string) => {
    setBulkResult(null);
    setBulkError(null);
    setSelected([id]);
  }, []);
  const toggleSelected = useCallback((id: string) => {
    // One request names at most 200 conversations; a person who ticks more is not offered the 201st.
    setSelected((list) =>
      list.includes(id)
        ? list.filter((x) => x !== id)
        : list.length < BULK_MAX_CONVERSATIONS
          ? [...list, id]
          : list,
    );
  }, []);
  const stopSelecting = useCallback(() => {
    setSelected([]);
    setBulkSheet(null);
  }, []);
  const bulkInstant = useBulkInstant(
    (result) => {
      setBulkResult(result);
      stopSelecting();
    },
    (message) => setBulkError(message),
  );
  // The phone's Back button ends the choosing before it leaves the screen.
  useEffect(() => {
    if (!selecting) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      stopSelecting();
      return true;
    });
    return () => subscription.remove();
  }, [selecting, stopSelecting]);
  const clearSearch = () => setTyped('');
  const toggleSearch = () => {
    if (searchOpen) clearSearch();
    setSearchOpen(!searchOpen);
  };
  const clearAll = () => {
    setStatus(DEFAULT_FILTERS.status);
    setChannelId(DEFAULT_FILTERS.channelId);
    setLabelIds(DEFAULT_FILTERS.labels);
    setArchived(DEFAULT_FILTERS.archived);
    setAgentIds(DEFAULT_FILTERS.agentIds);
    setSort(DEFAULT_FILTERS.sort);
    clearSearch();
  };

  const loadMore = () => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  };

  // The API sends the badge of every view with each page of the list; the first page is the one read most recently.
  const counts = query.data?.pages[0]?.meta.counts;
  const tabOptions = TABS.map((value) => ({
    value,
    label: t(`inbox.tabs.${value}`),
    badge: counts?.[value],
  }));

  const body = () => {
    if (session.isPending) return <ConversationSkeleton />;
    if (!allowed) {
      return (
        <View style={styles.pad}>
          <Card>
            <Text variant="subheading" accessibilityRole="header">
              {t('inbox.list.noAccessTitle')}
            </Text>
            <Text muted>{t('inbox.list.noAccessBody')}</Text>
          </Card>
        </View>
      );
    }
    if (query.isPending) return <ConversationSkeleton />;
    if (query.error && !query.data) {
      return (
        <View style={styles.pad}>
          <Card>
            <Text danger accessibilityRole="alert">
              {messageForError(query.error, t)}
            </Text>
            <Button variant="secondary" label={t('common.retry')} onPress={() => void refresh()} />
          </Card>
        </View>
      );
    }
    return (
      <FlatList
        testID="inbox-list"
        accessibilityLabel={t('inbox.list.label')}
        data={rows}
        keyExtractor={(item) => item.id}
        extraData={selected}
        renderItem={({ item }) => (
          <ConversationRow
            item={item}
            now={now}
            selecting={selecting}
            selected={selected.includes(item.id)}
            onStartSelecting={canBulk ? startSelecting : undefined}
            onToggle={toggleSelected}
          />
        )}
        ItemSeparatorComponent={() => (
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
        )}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        initialNumToRender={12}
        windowSize={7}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        ListHeaderComponent={
          query.error ? (
            <View style={styles.pad}>
              <Banner tone="danger" message={messageForError(query.error, t)} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            icon="chatbubbles-outline"
            title={t('inbox.list.emptyTitle')}
            hint={active ? t('inbox.list.emptyFilteredHint') : t('inbox.list.emptyHint')}
          />
        }
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <ActivityIndicator
              accessibilityLabel={t('inbox.list.loadingMore')}
              style={styles.footer}
            />
          ) : rows.length > 0 && !query.hasNextPage ? (
            <Text variant="caption" muted style={[styles.footer, styles.center]}>
              {t('inbox.list.noMore')}
            </Text>
          ) : null
        }
      />
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface }]}>
      {selecting ? (
        <ScreenHeader
          actions={
            <HeaderIconButton
              icon="checkmark-done-outline"
              label={t('inbox.bulk.selectAll')}
              onPress={() =>
                setSelected(rows.slice(0, BULK_MAX_CONVERSATIONS).map((row) => row.id))
              }
            />
          }
        >
          <View style={styles.selectRow}>
            <HeaderIconButton icon="close" label={t('inbox.bulk.close')} onPress={stopSelecting} />
            <Text variant="heading" accessibilityRole="header">
              {t('inbox.bulk.selected', { count: selected.length })}
            </Text>
          </View>
        </ScreenHeader>
      ) : (
        <ScreenHeader
          actions={
            <>
              <HeaderIconButton
                icon="search-outline"
                label={searchOpen ? t('inbox.search.close') : t('inbox.search.open')}
                onPress={toggleSearch}
              />
              <HeaderIconButton
                icon={{ material: 'filter-list' }}
                label={t('inbox.filter.open')}
                dot={sheetActive}
                onPress={() => setSheetOpen(true)}
              />
            </>
          }
        >
          <MenuTitle
            label={t('inbox.tabs.label')}
            options={tabOptions}
            value={tab}
            onChange={setTab}
          />
        </ScreenHeader>
      )}

      {searchOpen ? (
        <View style={styles.search}>
          <TextField
            label={t('inbox.search.label')}
            placeholder={t('inbox.search.placeholder')}
            value={typed}
            onChangeText={setTyped}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>
      ) : null}

      {active ? (
        <FilterStrip
          filters={filters}
          channelName={channelName}
          labelNames={labelNames}
          agentNames={agentNames}
          onClearStatus={() => setStatus('default')}
          onClearSearch={clearSearch}
          onClearChannel={() => setChannelId('')}
          onClearLabels={() => setLabelIds([])}
          onClearAgents={() => setAgentIds([])}
          onClearSort={() => setSort('recent')}
          onClearArchived={() => setArchived(false)}
          onClearAll={clearAll}
        />
      ) : null}

      {bulkResult ? (
        <View style={styles.search}>
          <Banner
            tone={bulkResult.failed > 0 ? 'warning' : 'info'}
            message={t('inbox.bulk.result', {
              done: bulkResult.done,
              unchanged: bulkResult.unchanged,
              failed: bulkResult.failed,
            })}
          />
          <Button
            variant="link"
            align="start"
            label={t('inbox.bulk.resultDismiss')}
            onPress={() => setBulkResult(null)}
          />
        </View>
      ) : null}
      {bulkError ? (
        <View style={styles.search}>
          <Banner tone="danger" message={bulkError} />
        </View>
      ) : null}

      <View style={styles.screen}>{body()}</View>
      {selecting ? (
        <BulkBar
          allowed={bulkAllowed}
          busy={bulkInstant.pending}
          onPick={(kind) => {
            setBulkError(null);
            if (kind === 'read') bulkInstant.run(selected, { type: 'mark_read' });
            else if (kind === 'spam') bulkInstant.run(selected, { type: 'spam' });
            else setBulkSheet(kind);
          }}
        />
      ) : null}
      <BulkSheets
        kind={bulkSheet}
        ids={selected}
        onClose={() => setBulkSheet(null)}
        onDone={(result) => {
          setBulkResult(result);
          setSelected([]);
        }}
      />

      <FiltersSheet
        visible={sheetOpen}
        value={{ status, channelId, labels: labelIds, archived, agentIds, sort }}
        onApply={(next) => {
          setStatus(next.status);
          setChannelId(next.channelId);
          setLabelIds(next.labels);
          setArchived(next.archived);
          setAgentIds(next.agentIds);
          setSort(next.sort);
          setSheetOpen(false);
        }}
        onClose={() => setSheetOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pad: { padding: spacing.lg },
  divider: { height: StyleSheet.hairlineWidth },
  search: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  selectRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  footer: { paddingVertical: spacing.lg },
  center: { textAlign: 'center' },
});
