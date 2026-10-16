'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useMemo, useReducer, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, ConfirmDialog, EmptyState, Spinner, cn, useToast } from '@crm/ui';
import type { TaskResponse } from '@crm/contracts';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { useStoredValue } from '@/lib/use-stored-value';
import {
  invalidateTasks,
  removeTaskFromCache,
  useMembers,
  useTaskCounts,
  useTasksList,
  useTasksSetup,
} from '../api/hooks';
import { tasksApi } from '../api/service';
import type { BulkOutcome } from '../api/schemas';
import {
  parseStoredColumns,
  serializeColumns,
  STORAGE_KEY as COLUMNS_KEY,
  toggleColumn,
  visibleColumns,
  DEFAULT_COLUMNS,
} from '../lib/columns';
import { isUnavailable } from '../lib/errors';
import {
  countsQuery,
  filtersToSearch,
  hasActiveFilter,
  listQuery,
  parseFilters,
  type TaskFilters,
  type TaskTab,
} from '../lib/filters';
import { hotkeyAction, moveActive } from '../lib/hotkeys';
import { EMPTY_SELECTION, headerState, selectionReducer } from '../lib/selection';
import { BulkBar } from './bulk-bar';
import { PlusIcon, TasksIcon } from './icons';
import { ErrorLine, useErrorText, useNow, useTasksCan, useWorkspaceZone } from './parts';
import { QuickAdd, type QuickAddValue } from './quick-add';
import { ShortcutsModal } from './shortcuts-modal';
import { TaskDrawer } from './task-drawer';
import { TaskFormModal } from './task-form-modal';
import { TasksBoard } from './tasks-board';
import { TasksTable } from './tasks-table';
import { TasksTabs } from './tasks-tabs';
import { SEARCH_ID, TasksToolbar } from './tasks-toolbar';
import { useTaskActions } from './use-task-actions';

/**
 * `/tasks`, the Tasks hub (TW-TASK-002..009). The tab, the filters and the open task live in the address; the visible columns
 * are a per-browser preference; everything else is local state over the list query.
 */
export function TasksScreen() {
  const t = useTranslations('tasks.hub');
  const tb = useTranslations('tasks.bulk');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const session = useSession();
  const can = useTasksCan();
  const errorText = useErrorText();
  const actions = useTaskActions();
  const panelId = useId();
  useTasksSetup();

  const filters = useMemo(() => parseFilters(search), [search]);
  const setFilters = useCallback(
    (patch: Partial<TaskFilters>) =>
      router.replace(`${pathname}${filtersToSearch({ ...filters, ...patch })}`, { scroll: false }),
    [router, pathname, filters],
  );

  // Search applies 350 ms after typing stops.
  const [q, setQ] = useState(filters.q);
  const [seenQ, setSeenQ] = useState(filters.q);
  if (filters.q !== seenQ) {
    setSeenQ(filters.q);
    setQ(filters.q);
  }
  useEffect(() => {
    if (q.trim() === filters.q.trim()) return;
    const id = window.setTimeout(() => setFilters({ q: q.trim() }), 350);
    return () => window.clearTimeout(id);
    // The timer restarts on every keystroke; setFilters closes over the current filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const members = useMembers();
  const list = useTasksList({ kind: 'all' }, listQuery(filters));
  const counts = useTaskCounts(countsQuery(filters));
  const now = useNow();
  const zone = useWorkspaceZone();
  const rows = list.items;
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);

  // columns (remembered per browser)
  const [storedColumns, setStoredColumns] = useStoredValue(COLUMNS_KEY);
  const stored = useMemo(() => parseStoredColumns(storedColumns), [storedColumns]);
  const columns = useMemo(() => visibleColumns(stored), [stored]);
  const columnSet = useMemo(() => new Set(columns), [columns]);

  // selection and the keyboard's row
  const [sel, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);
  const idsKey = rowIds.join(',');
  useEffect(() => dispatch({ type: 'retain', ids: rowIds }), [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [activeId, setActiveId] = useState<string | null>(null);
  const header = headerState(rowIds, sel.ids);

  // dialogs
  const [formFor, setFormFor] = useState<TaskResponse | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskResponse | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const changeTab = (tab: TaskTab) => {
    dispatch({ type: 'clear' });
    setActiveId(null);
    setFilters({ tab, task: '' });
  };

  async function guarded<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      toast(`${tb('failed')} ${errorText(e)}`, 'danger');
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  const report = (label: string, out: BulkOutcome) => {
    toast(label, out.changed === 0 ? 'danger' : 'success');
    if (out.failed > 0) toast(tb('someFailed', { count: out.failed }), 'danger');
  };

  async function bulkComplete() {
    const ids = [...sel.ids];
    const out = await guarded(() => tasksApi.bulkComplete(ids));
    if (!out) return;
    dispatch({ type: 'clear' });
    await invalidateTasks(qc);
    report(tb('completed', { count: out.changed }), out);
  }

  async function bulkAssign(assigneeId: string | null) {
    const ids = [...sel.ids];
    const out = await guarded(() => tasksApi.bulkAssign(ids, assigneeId));
    if (!out) return;
    dispatch({ type: 'clear' });
    await invalidateTasks(qc);
    const name = (members.data ?? []).find((m) => m.id === assigneeId)?.fullName ?? '';
    report(
      assigneeId
        ? tb('assigned', { count: out.changed, name })
        : tb('unassigned', { count: out.changed }),
      out,
    );
  }

  async function bulkDelete() {
    const ids = [...sel.ids];
    const out = await guarded(() => tasksApi.bulkDelete(ids));
    setConfirmBulkDelete(false);
    if (!out) return;
    removeTaskFromCache(qc, new Set(ids));
    dispatch({ type: 'clear' });
    await invalidateTasks(qc);
    report(tb('deleted', { count: out.changed }), out);
  }

  async function quickAdd(v: QuickAddValue): Promise<boolean> {
    const next = await actions.create({
      title: v.title,
      priority: v.priority,
      dueAt: v.dueAt,
      assigneeId: session.user.id,
    });
    return next !== null;
  }

  async function confirmDeleteOne() {
    if (!deleteTarget) return;
    setBusy(true);
    const ok = await actions.remove(deleteTarget.id);
    setBusy(false);
    if (ok) {
      if (filters.task === deleteTarget.id) setFilters({ task: '' });
      setDeleteTarget(null);
    }
  }

  // keyboard
  const board = filters.view === 'board' && filters.tab !== 'completed';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      const action = hotkeyAction({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        targetTag: el?.tagName,
        targetEditable: el?.isContentEditable,
        inDialog: !!document.querySelector('dialog[open]') || !!el?.closest('[role="menu"]'),
      });
      if (!action) return;
      const at = activeId ? rowIds.indexOf(activeId) : -1;
      const active = at >= 0 ? rows[at] : undefined;
      switch (action) {
        case 'next':
        case 'prev': {
          if (board) return;
          e.preventDefault();
          const to = moveActive(at, rowIds.length, action);
          setActiveId(to >= 0 ? (rowIds[to] ?? null) : null);
          return;
        }
        case 'open':
          if (active) {
            e.preventDefault();
            setFilters({ task: active.id });
          }
          return;
        case 'toggleComplete':
          if (active && can.update) void actions.toggle(active);
          return;
        case 'toggleSelect':
          if (active) dispatch({ type: 'toggle', id: active.id });
          return;
        case 'newTask':
          if (can.create) {
            e.preventDefault();
            setFormFor('new');
          }
          return;
        case 'focusSearch':
          e.preventDefault();
          document.getElementById(SEARCH_ID)?.focus();
          return;
        case 'clearSelection':
          if (filters.task) return;
          dispatch({ type: 'clear' });
          setActiveId(null);
          return;
        case 'help':
          e.preventDefault();
          setHelpOpen(true);
          return;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const filtered = hasActiveFilter({ ...filters, q });
  const selectedCount = sel.ids.size;
  const drawerSeed = filters.task ? rows.find((r) => r.id === filters.task) : undefined;
  const settled = !list.isPending;

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground"
          >
            <TasksIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight">{t('title')}</h1>
            <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">{t('subtitle')}</p>
          </div>
        </div>
        {can.create && (
          <Button variant="brand" className="h-10 px-5" onClick={() => setFormFor('new')}>
            <PlusIcon /> {t('newTask')}
          </Button>
        )}
      </header>

      <TasksTabs value={filters.tab} onChange={changeTab} counts={counts.data} panelId={panelId} />

      <TasksToolbar
        filters={filters}
        q={q}
        onQ={setQ}
        onChange={setFilters}
        members={members.data ?? []}
        visibleColumns={columnSet}
        onColumn={(id, on) =>
          setStoredColumns(serializeColumns(toggleColumn(stored ?? DEFAULT_COLUMNS, id, on)))
        }
        onResetColumns={() => setStoredColumns(null)}
        onRefresh={() => void Promise.all([invalidateTasks(qc), list.refetch()])}
        refreshing={list.isFetching}
        onHelp={() => setHelpOpen(true)}
      />

      {selectedCount > 0 && (
        <BulkBar
          count={selectedCount}
          busy={busy}
          members={members.data ?? []}
          meId={session.user.id}
          canUpdate={can.update}
          canDelete={can.remove}
          onComplete={() => void bulkComplete()}
          onAssign={(id) => void bulkAssign(id)}
          onDelete={() => setConfirmBulkDelete(true)}
          onClear={() => dispatch({ type: 'clear' })}
        />
      )}

      <section
        id={panelId}
        role="tabpanel"
        aria-label={t('tableLabel')}
        aria-busy={list.isFetching}
        // The card is as tall as the window allows: the rows scroll inside it and the footer stays pinned.
        className="flex max-h-[max(26rem,calc(100dvh-19rem))] flex-col overflow-hidden rounded-xl border border-border bg-background"
      >
        {can.create && filters.tab !== 'completed' && (
          <div className="shrink-0 border-b border-border p-3">
            <QuickAdd onAdd={quickAdd} />
          </div>
        )}
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col transition-opacity',
            list.isPlaceholderData && 'opacity-60',
          )}
        >
          {list.isPending ? (
            <ListSkeleton />
          ) : list.isError ? (
            <div className="space-y-3 p-4">
              <ErrorLine error={list.error} onRetry={() => void list.refetch()} />
              {isUnavailable(list.error) && process.env.NODE_ENV === 'development' && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    try {
                      window.localStorage.setItem('tasks:mock', '1');
                    } catch {
                      /* nothing to remember */
                    }
                    window.location.reload();
                  }}
                >
                  {t('useSampleData')}
                </Button>
              )}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={filtered ? t('emptyFilteredTitle') : t(`empty.${filters.tab}.title`)}
                message={filtered ? t('emptyFiltered') : t(`empty.${filters.tab}.message`)}
                actions={
                  <>
                    {filtered && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setQ('');
                          setFilters({
                            q: '',
                            status: 'open',
                            priority: '',
                            assignee: '',
                            contact: '',
                            deal: '',
                            company: '',
                          });
                        }}
                      >
                        {t('resetFilters')}
                      </Button>
                    )}
                    {can.create && !filtered && filters.tab !== 'completed' && (
                      <Button variant="brand" onClick={() => setFormFor('new')}>
                        {t('newTask')}
                      </Button>
                    )}
                  </>
                }
              />
            </div>
          ) : board ? (
            <TasksBoard
              tasks={rows}
              now={now}
              zone={zone}
              canUpdate={can.update}
              selected={sel.ids}
              onOpen={(id) => setFilters({ task: id })}
              onToggleComplete={(task) => void actions.toggle(task)}
            />
          ) : (
            <TasksTable
              tasks={rows}
              columns={columns}
              headerState={header}
              onToggleAll={(checked) => dispatch({ type: 'setMany', ids: rowIds, checked })}
              selected={sel.ids}
              activeId={activeId}
              canUpdate={can.update}
              canDelete={can.remove}
              now={now}
              zone={zone}
              onToggleSelect={(id) => dispatch({ type: 'toggle', id })}
              onOpen={(id) => setFilters({ task: id })}
              onToggleComplete={(task) => void actions.toggle(task)}
              onEdit={setFormFor}
              onDelete={setDeleteTarget}
            />
          )}
        </div>
        {settled && !list.isError && rows.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-4 py-2.5 text-sm">
            <span className="flex items-center gap-2 text-muted-foreground" aria-live="polite">
              {list.isFetching && <Spinner label={t('loading')} />}
              {t('showing', { count: rows.length })}
            </span>
            {list.hasNextPage ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage && <Spinner />}
                {t('loadMore')}
              </Button>
            ) : (
              <span className="text-muted-foreground">{t('allLoaded')}</span>
            )}
          </div>
        )}
      </section>

      {formFor !== null && (
        <TaskFormModal
          task={formFor === 'new' ? undefined : formFor}
          onClose={() => setFormFor(null)}
        />
      )}

      {filters.task && (
        <TaskDrawer
          taskId={filters.task}
          seed={drawerSeed}
          canUpdate={can.update}
          canDelete={can.remove}
          onClose={() => setFilters({ task: '' })}
          onEdit={setFormFor}
          onDeleted={() => setFilters({ task: '' })}
        />
      )}

      <ShortcutsModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      <ConfirmDialog
        open={deleteTarget !== null}
        tone="danger"
        busy={busy}
        title={t('deleteTitle')}
        message={t('deleteMessage', { title: deleteTarget?.title ?? '' })}
        confirmLabel={t('delete')}
        cancelLabel={t('keep')}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDeleteOne()}
      />
      <ConfirmDialog
        open={confirmBulkDelete}
        tone="danger"
        busy={busy}
        title={tb('deleteTitle')}
        message={tb('deleteMessage', { count: selectedCount })}
        confirmLabel={tb('delete')}
        cancelLabel={tb('keep')}
        onClose={() => setConfirmBulkDelete(false)}
        onConfirm={() => void bulkDelete()}
      />
    </div>
  );
}

function ListSkeleton() {
  const t = useTranslations('tasks.hub');
  return (
    <div role="status" aria-label={t('loading')} className="divide-y divide-border">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex h-14 animate-pulse items-center gap-4 px-4">
          <span className="size-4 rounded bg-muted" />
          <span className="size-[18px] rounded-full bg-muted" />
          <span className="h-3 w-56 rounded bg-muted" />
          <span className="hidden h-5 w-16 rounded-full bg-muted sm:block" />
          <span className="hidden h-3 w-32 rounded bg-muted md:block" />
          <span className="ms-auto size-6 rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}
