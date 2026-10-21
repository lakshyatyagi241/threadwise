import type { TaskResponse } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { messageForError } from '@/lib/api/error-message';
import { isApiError } from '@/lib/api';
import { can, useSession } from '@/lib/session/use-session';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import {
  NO_CHOICES,
  activeChoiceCount,
  listRequest,
  type DueTab,
  type TaskChoices,
} from './filters';
import { firstParam } from './route-params';
import { isNotFound, isPlanLocked } from './task-errors';
import { TaskActionsSheet } from './task-actions-sheet';
import { TaskDueTabs } from './task-due-tabs';
import { TaskFilterModal } from './task-filter-modal';
import { TaskRow } from './task-row';
import { TaskSkeleton } from './task-skeleton';
import { SEARCH_DEBOUNCE_MS, useDebounced } from '@/lib/hooks/use-debounced';
import { taskListsKey, useDeleteTask, useTaskList, useToggleTask } from './use-tasks';

const FAB_SIZE = 52;
const FAB_MARGIN = 24;

/**
 * The task list: "My tasks" by default, or one contact's tasks when opened with `?contactId=`. Open tasks first by due date, a
 * page of 50 at a time. The circle completes or reopens a task, the row opens it, the dots offer Edit and Delete, the filter sheet
 * narrows by status, priority, due and owner, and the round button adds a task. Without the permission to read tasks, or on a
 * plan without them, the screen says so and the list stays empty.
 */
export function TasksScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ contactId?: string | string[] }>();
  const contactId = firstParam(params.contactId);
  const session = useSession();
  const allowed =
    can(session.data, 'record.tasks.read') &&
    (!contactId || can(session.data, 'record.contacts.read'));
  const canCreate = can(session.data, 'record.tasks.create');
  const canUpdate = can(session.data, 'record.tasks.update');
  const canDelete = can(session.data, 'record.tasks.delete');

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [choices, setChoices] = useState<TaskChoices>(NO_CHOICES);
  const [tab, setTab] = useState<DueTab>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [menuFor, setMenuFor] = useState<TaskResponse | null>(null);
  const [deleting, setDeleting] = useState<TaskResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const q = useDebounced(searchText.trim(), SEARCH_DEBOUNCE_MS);
  const request = useMemo(
    () => listRequest(contactId, choices, q, tab),
    [contactId, choices, q, tab],
  );
  const list = useTaskList(request.source, request.filters, allowed);
  const tasks = useMemo(() => list.data?.pages.flatMap((page) => page.data) ?? [], [list.data]);
  const narrowed =
    activeChoiceCount(choices, contactId) > 0 || tab !== 'all' || request.filters.q !== undefined;
  const locked = list.isError && isPlanLocked(list.error);

  const toggle = useToggleTask();
  const toggleTask = toggle.mutate;
  const remove = useDeleteTask();
  const busyId = toggle.isPending ? toggle.variables?.id : undefined;

  const open = useCallback(
    (id: string) => router.push({ pathname: '/task/[id]', params: { id } }),
    [router],
  );
  const complete = useCallback(
    (task: TaskResponse) => {
      setNotice(null);
      toggleTask(
        { id: task.id, rowVersion: task.rowVersion, status: task.status },
        {
          onError: (error) => {
            // Someone else changed or deleted the task first: show what is there now and say why nothing happened.
            if (isApiError(error) && error.isRowVersionConflict)
              setNotice(t('tasks.list.conflict'));
            else if (isNotFound(error)) setNotice(t('tasks.notFound'));
            else setNotice(messageForError(error, t));
            void queryClient.invalidateQueries({ queryKey: taskListsKey });
          },
        },
      );
    },
    [toggleTask, t, queryClient],
  );
  const more = useCallback((task: TaskResponse) => setMenuFor(task), []);

  const refresh = async () => {
    setRefreshing(true);
    await list.refetch();
    setRefreshing(false);
  };
  const toggleSearch = () => {
    if (searchOpen) setSearchText('');
    setSearchOpen(!searchOpen);
  };
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/menu'));
  const add = () =>
    router.push(contactId ? { pathname: '/task-form', params: { contactId } } : '/task-form');

  const confirmDelete = () => {
    if (!deleting) return;
    const id = deleting.id;
    remove.mutate(id, {
      onSuccess: () => setDeleting(null),
      onError: (error) => {
        setDeleting(null);
        // Already gone counts as deleted: the refreshed list no longer shows it.
        if (isNotFound(error)) void queryClient.invalidateQueries({ queryKey: taskListsKey });
        else setNotice(messageForError(error, t));
      },
    });
  };

  let body;
  if (session.data === undefined) {
    body = session.isError ? (
      <ErrorCard error={session.error} onRetry={() => void session.refetch()} />
    ) : (
      <TaskSkeleton />
    );
  } else if (!allowed) {
    body = (
      <EmptyState
        icon="lock-closed-outline"
        title={t('tasks.denied.title')}
        hint={t('tasks.denied.hint')}
      />
    );
  } else if (list.isPending) {
    body = <TaskSkeleton />;
  } else if (locked) {
    body = (
      <EmptyState
        icon="lock-closed-outline"
        title={t('tasks.planLocked.title')}
        hint={t('tasks.planLocked.hint')}
      />
    );
  } else if (list.isError && tasks.length === 0) {
    body = <ErrorCard error={list.error} onRetry={() => void list.refetch()} />;
  } else {
    body = (
      <FlatList
        testID="tasks-list"
        data={tasks}
        extraData={busyId}
        keyExtractor={(task) => task.id}
        renderItem={({ item }) => (
          <TaskRow
            task={item}
            canUpdate={canUpdate}
            canMore={canDelete || (canUpdate && item.status === 'open')}
            busy={busyId === item.id}
            onOpen={open}
            onToggle={complete}
            onMore={more}
          />
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        ListEmptyComponent={
          <EmptyState
            icon="checkbox-outline"
            title={t('tasks.empty.title')}
            hint={narrowed ? t('tasks.empty.filteredHint') : t('tasks.empty.hint')}
          />
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
        title={t('tasks.title')}
        onBack={goBack}
        actions={
          allowed ? (
            <>
              <HeaderIconButton
                icon={searchOpen ? 'close' : 'search-outline'}
                label={searchOpen ? t('tasks.search.close') : t('tasks.search.open')}
                onPress={toggleSearch}
              />
              <HeaderIconButton
                icon={{ material: 'filter-list' }}
                label={t('tasks.filter.open')}
                dot={activeChoiceCount(choices, contactId) > 0}
                onPress={() => setFilterOpen(true)}
              />
            </>
          ) : null
        }
      />

      {allowed && !locked ? (
        <TaskDueTabs
          value={tab}
          onChange={(next) => {
            setTab(next);
            // A tab and the filter sheet's due choice are the same narrowing: the later pick wins.
            if (next !== 'all') setChoices((current) => ({ ...current, due: undefined }));
          }}
        />
      ) : null}

      {searchOpen ? (
        <View style={styles.search}>
          <TextField
            label={t('tasks.search.label')}
            placeholder={t('tasks.search.placeholder')}
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
          <Banner tone="warning" message={notice} />
        </View>
      ) : null}

      <View style={styles.fill}>{body}</View>

      {allowed && canCreate && !locked ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('tasks.add')}
          onPress={add}
          style={[styles.fab, { backgroundColor: colors.primary, shadowColor: colors.shadow }]}
        >
          <Icon name="add" size={24} color="onPrimary" />
        </Pressable>
      ) : null}

      {filterOpen ? (
        <TaskFilterModal
          choices={choices}
          contactId={contactId}
          onClose={() => setFilterOpen(false)}
          onApply={(next) => {
            setChoices(next);
            if (next.due) setTab('all');
            setFilterOpen(false);
          }}
        />
      ) : null}

      <TaskActionsSheet
        task={menuFor}
        canEdit={canUpdate}
        canDelete={canDelete}
        onClose={() => setMenuFor(null)}
        onEdit={(task) => {
          setMenuFor(null);
          router.push({ pathname: '/task-form', params: { taskId: task.id } });
        }}
        onDelete={(task) => {
          setMenuFor(null);
          setDeleting(task);
        }}
      />

      <ConfirmDialog
        visible={deleting !== null}
        title={t('tasks.delete.title')}
        message={t('tasks.delete.message')}
        confirmLabel={t('tasks.delete.confirm')}
        cancelLabel={t('tasks.cancel')}
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
          {messageForError(error, t)}
        </Text>
        <Button variant="secondary" label={t('common.retry')} onPress={onRetry} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  search: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  notice: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  error: { padding: spacing.lg },
  footer: { paddingVertical: spacing.lg },
  // Room under the last row for the round button, so it never covers a task.
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
