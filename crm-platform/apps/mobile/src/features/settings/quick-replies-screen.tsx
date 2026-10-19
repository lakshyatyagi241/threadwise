import type { SavedReply } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
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
import { ProgressBar } from '@/components/ui/progress-bar';
import { HeaderIconButton } from '@/components/ui/screen-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import { SEARCH_DEBOUNCE_MS, useDebounced } from '@/lib/hooks/use-debounced';
import { can, useSession } from '@/lib/session/use-session';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { limitState } from './quick-reply-draft';
import { QuickReplyActionsSheet } from './quick-reply-actions-sheet';
import { isReplyGone } from './quick-reply-errors';
import { QuickReplyRow } from './quick-reply-row';
import type { ScopeFilter } from './quick-replies-api';
import {
  quickRepliesKey,
  useDeleteQuickReply,
  useDuplicateQuickReply,
  useQuickReplyList,
} from './use-quick-replies';

const FAB_SIZE = 52;
const FAB_MARGIN = 24;

/**
 * Settings, Saved replies (TW-TIB1-024): the workspace's library of reusable replies, newest first, a page at a time. The tabs narrow it
 * to the shared ones or the person's own (with the server's counts), the search box looks in shortcut, title and text, the dots offer
 * Edit, Duplicate and Delete, and the round button adds one. A plan with a limit shows how much of it is used, and the add button
 * stops at the limit. Needs `inbox.savedreply.manage`, like the web screen.
 */
export function QuickRepliesScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useSession();
  const allowed = can(session.data, 'inbox.savedreply.manage');
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const q = useDebounced(searchText.trim(), SEARCH_DEBOUNCE_MS);
  const [menuFor, setMenuFor] = useState<SavedReply | null>(null);
  const [deleting, setDeleting] = useState<SavedReply | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const list = useQuickReplyList(scope, q, allowed);
  const remove = useDeleteQuickReply();
  const duplicate = useDuplicateQuickReply();
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);
  const first = list.data?.pages[0];
  const total = first?.total ?? 0;
  const limit = first?.limit ?? null;
  const state = limitState(total, limit);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/menu'));
  const add = () => router.push('/quick-reply-form');
  const edit = (reply: SavedReply) =>
    router.push({ pathname: '/quick-reply-form', params: { replyId: reply.id } });
  // A reply the person may not change opens read-only on the web; here the dots still offer Duplicate, and a tap says why.
  const open = (reply: SavedReply) =>
    reply.canEdit ? edit(reply) : setNotice(t('settings.quickReplies.readOnly'));

  const refresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: quickRepliesKey });
    setRefreshing(false);
  };

  const confirmDelete = async () => {
    const reply = deleting;
    if (!reply) return;
    try {
      await remove.mutateAsync(reply);
      setNotice(t('settings.quickReplies.deleted'));
    } catch (e) {
      // Already gone (deleted by someone else): the list was read again, which is the answer the person wanted.
      setNotice(isReplyGone(e) ? t('settings.quickReplies.deleted') : messageForError(e, t));
    } finally {
      setDeleting(null);
    }
  };

  const copy = async (reply: SavedReply) => {
    setMenuFor(null);
    try {
      await duplicate.mutateAsync(reply);
      setNotice(t('settings.quickReplies.duplicated'));
    } catch (e) {
      setNotice(
        isApiError(e) && e.code === 'PLAN_LIMIT_REACHED'
          ? t('settings.quickReplies.form.planLimit')
          : messageForError(e, t),
      );
    }
  };

  let body;
  if (session.data === undefined) {
    body = <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
  } else if (!allowed) {
    body = <EmptyState icon="lock-closed-outline" title={t('settings.quickReplies.noAccess')} />;
  } else if (list.isPending) {
    body = <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
  } else if (list.isError) {
    body = (
      <View style={styles.pad}>
        <Card>
          <Text danger accessibilityRole="alert">
            {messageForError(list.error, t)}
          </Text>
          <Button
            variant="secondary"
            label={t('common.retry')}
            onPress={() => void list.refetch()}
          />
        </Card>
      </View>
    );
  } else {
    const searching = q !== '';
    body = (
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <QuickReplyRow reply={item} onOpen={open} onMore={setMenuFor} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        ListEmptyComponent={
          searching ? (
            <EmptyState
              icon="search-outline"
              title={t('settings.quickReplies.noMatch.title')}
              hint={t('settings.quickReplies.noMatch.hint', { q })}
            />
          ) : (
            <EmptyState
              icon="flash-outline"
              title={t('settings.quickReplies.empty.title')}
              hint={t('settings.quickReplies.empty.hint')}
            />
          )
        }
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.footer} />
          ) : null
        }
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
      />
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader
        title={t('settings.quickReplies.title')}
        onBack={goBack}
        actions={
          allowed ? (
            <HeaderIconButton
              icon={searchOpen ? 'close' : 'search-outline'}
              label={
                searchOpen
                  ? t('settings.quickReplies.search.close')
                  : t('settings.quickReplies.search.label')
              }
              onPress={() => {
                setSearchOpen((v) => !v);
                setSearchText('');
              }}
            />
          ) : null
        }
      />

      {allowed ? (
        <View style={styles.controls}>
          {searchOpen ? (
            <TextField
              label={t('settings.quickReplies.search.label')}
              placeholder={t('settings.quickReplies.search.placeholder')}
              value={searchText}
              onChangeText={setSearchText}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
          ) : null}
          <SegmentedControl
            label={t('settings.quickReplies.tabsLabel')}
            value={scope}
            onChange={setScope}
            options={[
              {
                value: 'all',
                label: t('settings.quickReplies.tab.all', { count: first?.counts.all ?? 0 }),
              },
              {
                value: 'shared',
                label: t('settings.quickReplies.tab.shared', { count: first?.counts.shared ?? 0 }),
              },
              {
                value: 'mine',
                label: t('settings.quickReplies.tab.mine', { count: first?.counts.mine ?? 0 }),
              },
            ]}
          />
          {limit !== null ? (
            <View style={styles.meter}>
              <Text variant="caption" muted>
                {t('settings.quickReplies.meter', { used: total, limit })}
              </Text>
              <ProgressBar
                percent={(Math.min(total, limit) / limit) * 100}
                tone={state === 'reached' ? 'danger' : state === 'near' ? 'warning' : 'primary'}
                label={t('settings.quickReplies.meterLabel')}
              />
            </View>
          ) : null}
          {state === 'reached' ? (
            <Banner tone="danger" message={t('settings.quickReplies.atLimit', { limit })} />
          ) : null}
          {state === 'near' ? (
            <Banner tone="warning" message={t('settings.quickReplies.nearLimit', { limit })} />
          ) : null}
        </View>
      ) : null}

      {notice ? (
        <View style={styles.notice}>
          <Banner tone="info" message={notice} />
        </View>
      ) : null}

      <View style={styles.fill}>{body}</View>

      {allowed && state !== 'reached' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('settings.quickReplies.create')}
          onPress={add}
          style={[styles.fab, { backgroundColor: colors.primary, shadowColor: colors.shadow }]}
        >
          <Icon name="add" size={24} color="onPrimary" />
        </Pressable>
      ) : null}

      <QuickReplyActionsSheet
        reply={menuFor}
        onClose={() => setMenuFor(null)}
        onEdit={(reply) => {
          setMenuFor(null);
          edit(reply);
        }}
        onDuplicate={(reply) => void copy(reply)}
        onDelete={(reply) => {
          setMenuFor(null);
          setDeleting(reply);
        }}
      />

      <ConfirmDialog
        visible={deleting !== null}
        title={t('settings.quickReplies.deleteTitle')}
        message={
          deleting?.scope === 'mine'
            ? t('settings.quickReplies.deleteMine', { shortcut: deleting.shortcut })
            : t('settings.quickReplies.deleteShared', { shortcut: deleting?.shortcut ?? '' })
        }
        confirmLabel={t('settings.quickReplies.delete')}
        cancelLabel={t('settings.quickReplies.cancel')}
        pending={remove.isPending}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  loading: { marginTop: spacing.xl },
  pad: { padding: spacing.lg },
  controls: { gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  meter: { gap: spacing.xs },
  notice: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  footer: { paddingVertical: spacing.lg },
  // Room under the last row for the round button, so it never covers a reply.
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
