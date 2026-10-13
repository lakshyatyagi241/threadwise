import type { InboxTab } from '@crm/contracts';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
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
import { ConversationRow } from './conversation-row';
import { ConversationSkeleton } from './conversation-skeleton';
import { FilterStrip } from './filter-strip';
import { hasActiveFilter, TABS, type InboxFilters, type StatusFilter } from './filters';
import { StatusFilterSheet } from './status-filter-sheet';
import { useConversations } from './use-inbox';
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const debounced = useDebouncedValue(typed.trim(), SEARCH_DEBOUNCE_MS);
  // Emptying the box shows the full list straight away; only typing waits for a pause.
  const q = typed.trim() === '' ? '' : debounced;
  const filters = useMemo<InboxFilters>(() => ({ tab, status, q }), [tab, status, q]);
  const active = hasActiveFilter(filters);

  // The tab is in front: ask for news on a timer, and stop when another tab or a conversation covers it.
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const query = useConversations(filters, allowed, focused);
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);
  // The clock for "today" and "yesterday" moves only when the list does.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [query.dataUpdatedAt]);

  const refresh = async () => {
    setRefreshing(true);
    await query.refetch();
    setRefreshing(false);
  };
  const clearSearch = () => setTyped('');
  const toggleSearch = () => {
    if (searchOpen) clearSearch();
    setSearchOpen(!searchOpen);
  };
  const clearAll = () => {
    setStatus('default');
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
        renderItem={({ item }) => <ConversationRow item={item} now={now} />}
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
              dot={status !== 'default'}
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
          status={status}
          q={q}
          onClearStatus={() => setStatus('default')}
          onClearSearch={clearSearch}
          onClearAll={clearAll}
        />
      ) : null}

      <View style={styles.screen}>{body()}</View>

      <StatusFilterSheet
        visible={sheetOpen}
        value={status}
        onSelect={setStatus}
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
  footer: { paddingVertical: spacing.lg },
  center: { textAlign: 'center' },
});
