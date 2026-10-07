'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useReducer, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Button, ConfirmDialog, EmptyState, StatTile, cn, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { invalidateSegments, useSegments } from '@/features/segments';
import { useStoredValue } from '@/lib/use-stored-value';
import { useAttributes, useStatusOptions } from '../api/attributes';
import {
  bulkDelete,
  bulkGroupMembership,
  bulkTag,
  bulkUpdate,
  exportContacts,
  startCampaignDraft,
  type BulkOutcome,
  type BulkUpdateValues,
} from '../api/bulk';
import {
  contactFilterBody,
  deleteContact,
  invalidateContacts,
  KEYS,
  useContactsPage,
  useContactStats,
  updateContact,
  type ContactFilters,
} from '../api/contacts';
import { useGroups } from '../api/groups';
import { useTags } from '../api/tags';
import type { ContactRow } from '../api/schemas';
import {
  allColumns,
  defaultColumns,
  parseStoredColumns,
  serializeColumns,
  STORAGE_KEY as COLUMNS_KEY,
  ORDER_STORAGE_KEY as COLUMN_ORDER_KEY,
  moveColumn,
  nudgeColumn,
  toggleColumn,
  visibleColumns,
} from '../lib/columns';
import { displayName } from '../lib/contact-model';
import { downloadBlob } from '../lib/download';
import { deleteFailure, errorKind } from '../lib/errors';
import { filtersToSearch, hasActiveFilter, parseFilters } from '../lib/filters';
import { stageChoices, statusChoices } from '../lib/option-sets';
import { clampPage, totalPages } from '../lib/pagination';
import { defaultPageSize, PAGE_SIZE_KEY } from '../lib/page-size';
import { rowView } from '../lib/row-view';
import {
  bulkTarget,
  EMPTY_SELECTION,
  headerState,
  selectionReducer,
  type BulkTarget,
} from '../lib/selection';
import { useStoredChoice } from '../lib/use-stored-choice';
import { BulkPickers, type BulkPicker, type TagChoice } from './bulk-bar';
import { BulkUpdateDialog } from './bulk-update-dialog';
import { ContactFormModal } from './contact-form-modal';
import { ContactsKanban } from './contacts-kanban';
import { ContactsTable } from './contacts-list';
import { ContactsPagination } from './contacts-pagination';
import { ContactsToolbar, filtersOfSegment, segmentOf } from './contacts-toolbar';
import { SaveSegmentModal } from './save-segment-modal';
import type { SegmentOption, SegmentsState } from './segment-picker';
import { DedupeDialog } from './dedupe-dialog';
import { ErrorLine } from './error-line';
import { LostReasonDialog, type LostPrompt } from './lost-reason';
import { isLostStage } from '../lib/stage-flow';
import { statusAfterMove, statusNotice } from '../lib/status-scope';
import { GroupModal } from './group-modal';
import { ImportModal } from './import-modal';
import { BookUserIcon, ChevronDownIcon, ChevronRightIcon, PlusIcon } from './icons';

type View = 'list' | 'kanban';
const VIEWS = ['list', 'kanban'] as const;
const STATS_KEY = 'cat:contacts:stats';

const num = (n: number | undefined) => (n === undefined ? '—' : n.toLocaleString());

/**
 * `/contacts`, the Contact Hub (TW-CON-001..008, 019). Filters and the page number live in the URL; the visible
 * columns, the layout and the stats strip are per-browser preferences; everything else is local state over the page
 * query.
 */
export function ContactsScreen() {
  const t = useTranslations('contacts-attributes-tags.list');
  const tb = useTranslations('contacts-attributes-tags.bulk');
  const tf = useTranslations('contacts-attributes-tags.form');
  const ts = useTranslations('contacts-attributes-tags.stageMenu');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canCreate = useCan('record.contacts.create');
  const canUpdate = useCan('record.contacts.update');
  const canDelete = useCan('record.contacts.delete');
  const canExport = useCan('record.contacts.export');
  const canImport = useCan('record.contacts.import');
  const canMerge = useCan('record.contacts.merge');
  const canCreateGroups = useCan('record.contact-groups.create');
  const canCreateTags = useCan('record.tags.create');
  const canReadSegments = useCan('record.segments.read');
  const canCreateSegments = useCan('record.segments.create');

  // The rows-per-page choice is remembered per browser; a `per=` in the URL (a shared link) still wins.
  const [storedSize, setStoredSize] = useStoredValue(PAGE_SIZE_KEY);
  const sizeDefault = defaultPageSize(storedSize);
  const filters = useMemo(() => parseFilters(search, sizeDefault), [search, sizeDefault]);
  /** Changing any filter, the sort or the page size starts again from page 1; only `page` itself keeps the position. */
  const setFilters = (patch: Partial<ContactFilters>) => {
    if (patch.limit !== undefined) setStoredSize(String(patch.limit));
    router.replace(
      `${pathname}${filtersToSearch({ ...filters, page: 1, ...patch }, patch.limit ?? sizeDefault)}`,
      { scroll: false },
    );
  };

  /**
   * A header click: first A to Z, then Z to A, then back to the default (newest first). The created-on column is the
   * default itself, so it only flips between newest and oldest.
   */
  const onSortColumn = (key: string) => {
    if (filters.sort !== key) return setFilters({ sort: key, order: 'asc' });
    if (key === 'createdAt')
      return setFilters({ order: filters.order === 'desc' ? 'asc' : 'desc' });
    if (filters.order === 'asc') return setFilters({ order: 'desc' });
    setFilters({ sort: 'createdAt', order: 'desc' });
  };

  // Search is applied 450 ms after typing stops (Reference's rhythm), without a page reload.
  const [q, setQ] = useState(filters.q);
  const [seenQ, setSeenQ] = useState(filters.q);
  if (filters.q !== seenQ) {
    // The URL changed under us (Reset filters, back button): follow it.
    setSeenQ(filters.q);
    setQ(filters.q);
  }
  useEffect(() => {
    if (q.trim() === filters.q.trim()) return;
    const id = window.setTimeout(() => setFilters({ q: q.trim() }), 450);
    return () => window.clearTimeout(id);
    // setFilters closes over the current filters; the timer restarts on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const list = useContactsPage(filters, filters.page);
  const stats = useContactStats();
  const groups = useGroups();
  const tags = useTags();
  const segmentList = useSegments(canReadSegments);
  const segmentOptions = useMemo<SegmentOption[]>(
    () =>
      (segmentList.data ?? [])
        .map((s) => ({
          id: s.id,
          name: s.name,
          color: s.color ?? null,
          memberCount: s.memberCount,
          countApproximate: s.countApproximate,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [segmentList.data],
  );
  const segmentsState: SegmentsState = !canReadSegments
    ? 'off'
    : segmentList.isError
      ? 'error'
      : segmentList.isPending
        ? 'loading'
        : 'ready';
  const attributes = useAttributes();
  const statusOptions = useStatusOptions();

  const rows = list.items;
  const total = list.total;
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const attrLabels = useMemo(
    () => new Map((attributes.data ?? []).map((a) => [a.key, a.name])),
    [attributes.data],
  );
  const stages = useMemo(() => stageChoices(statusOptions.data), [statusOptions.data]);
  const statuses = useMemo(
    () => statusChoices(statusOptions.data, (v) => tf(`statuses.${v}`)),
    [statusOptions.data, tf],
  );
  const views = useMemo(() => rows.map((r) => rowView(r, attrLabels)), [rows, attrLabels]);

  // Keep the URL's page honest: a jump past the end lands on the last page, and a page emptied by deletes steps back.
  const settled = list.data !== undefined && !list.isPlaceholderData;
  useEffect(() => {
    if (!settled) return;
    let want = list.page;
    if (rows.length === 0 && filters.page > 1) {
      want = clampPage(totalPages(total ?? 0, filters.limit), filters.page - 1);
      if (want >= filters.page) want = filters.page - 1;
    }
    if (want !== filters.page) {
      router.replace(`${pathname}${filtersToSearch({ ...filters, page: want }, sizeDefault)}`, {
        scroll: false,
      });
    }
    // Only the settled response decides; `filters` is read for the current URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, list.page, rows.length, total]);

  // layout, columns and the stats strip (remembered per browser)
  const [view, chooseView] = useStoredChoice<View>('cat:contacts:view', VIEWS, 'list');
  const [storedColumns, setStoredColumns] = useStoredValue(COLUMNS_KEY);
  const [storedOrder, setStoredOrder] = useStoredValue(COLUMN_ORDER_KEY);
  const [statsRaw, setStatsRaw] = useStoredValue(STATS_KEY);
  const showStats = statsRaw === '1';
  const attributeColumns = useMemo(
    () =>
      (attributes.data ?? []).filter((a) => a.active).map((a) => ({ key: a.key, name: a.name })),
    [attributes.data],
  );
  const stored = useMemo(() => parseStoredColumns(storedColumns), [storedColumns]);
  const baseColumns = stored ?? defaultColumns(attributeColumns);
  const columns = useMemo(
    () => visibleColumns(stored, attributeColumns, parseStoredColumns(storedOrder)),
    [stored, attributeColumns, storedOrder],
  );
  const allCols = useMemo(() => allColumns(attributeColumns), [attributeColumns]);
  const visibleIds = useMemo(() => new Set(columns.map((c) => c.id)), [columns]);

  // selection
  const [sel, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);
  const idsKey = rowIds.join(',');
  useEffect(() => dispatch({ type: 'retain', ids: rowIds }), [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const header = headerState(rowIds, sel.ids);
  const snapshot = {
    q: filters.q,
    lifecycleStage: filters.lifecycleStage,
    group: filters.group,
    tag: filters.tag,
    consent: filters.consent,
    imported: filters.imported,
    segment: filters.segment,
    rules: filters.rules,
  };
  const target = (): BulkTarget =>
    pickerRow ? { kind: 'ids', ids: [pickerRow] } : bulkTarget(sel, snapshot);

  // modals
  const [formFor, setFormFor] = useState<ContactRow | 'new' | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [dedupeOpen, setDedupeOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [saveSegmentOpen, setSaveSegmentOpen] = useState(false);
  const [picker, setPicker] = useState<BulkPicker>(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  /** The contact a group/tag picker opened from a row's menu acts on; null when it acts on the selection. */
  const [pickerRow, setPickerRow] = useState<string | null>(null);
  const closePicker = () => {
    setPicker(null);
    setPickerRow(null);
  };
  const [busy, setBusy] = useState(false);
  const [stageBusy, setStageBusy] = useState<string | null>(null);
  const [lostPrompt, setLostPrompt] = useState<LostPrompt | null>(null);
  const [exporting, setExporting] = useState(false);
  const deleteTarget = rows.find((r) => r.id === deleteId);

  const refresh = () =>
    Promise.all([
      invalidateContacts(qc),
      qc.invalidateQueries({ queryKey: KEYS.groups }),
      qc.invalidateQueries({ queryKey: KEYS.tags }),
      invalidateSegments(qc),
    ]);

  async function guarded<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      const kind = errorKind(e);
      toast(
        tb(kind === 'forbidden' ? 'forbidden' : kind === 'unavailable' ? 'unavailable' : 'failed'),
        'danger',
      );
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  const report = (label: string, out: BulkOutcome) => {
    toast(label, out.failed ? 'info' : 'success');
    if (out.failed) toast(tb('someFailed', { count: out.failed }), 'danger');
  };

  async function runExport(tgt: BulkTarget, set: (v: boolean) => void) {
    set(true);
    try {
      const { blob, filename } = await exportContacts(tgt);
      downloadBlob(filename, blob);
      toast(tb('exportStarted'), 'success');
    } catch (e) {
      const kind = errorKind(e);
      toast(
        tb(kind === 'conflict' || kind === 'validation' ? 'exportTooLarge' : 'failed'),
        'danger',
      );
    } finally {
      set(false);
    }
  }

  /** Opens the broadcast wizard on a draft whose audience is the ticked rows (or everything the view matches, after "select all"). */
  async function onSendCampaign() {
    setBusy(true);
    try {
      router.push(`/campaigns/wizard/${await startCampaignDraft(target())}`);
    } catch {
      toast(tb('failed'), 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function onBulkDelete() {
    const out = await guarded(() => bulkDelete(target()));
    setConfirmBulkDelete(false);
    if (!out) return;
    dispatch({ type: 'clear' });
    await refresh();
    report(tb('deleted', { count: out.changed }), out);
  }

  async function onBulkGroup(action: 'add' | 'remove', groupId: string): Promise<boolean> {
    const out = await guarded(() => bulkGroupMembership(target(), groupId, action));
    if (!out) return false;
    if (!pickerRow) dispatch({ type: 'clear' });
    await refresh();
    const name = (groups.data ?? []).find((g) => g.id === groupId)?.name ?? '';
    report(tb(action === 'add' ? 'groupAdded' : 'groupRemoved', { count: out.changed, name }), out);
    return true;
  }

  async function onBulkUpdate(values: BulkUpdateValues): Promise<boolean> {
    const out = await guarded(() => bulkUpdate([...sel.ids], values));
    if (!out) return false;
    dispatch({ type: 'clear' });
    await refresh();
    report(tb('updated', { count: out.changed }), out);
    return true;
  }

  async function onBulkTag(action: 'add' | 'remove', choice: TagChoice): Promise<boolean> {
    const out = await guarded(() => bulkTag(target(), action, choice));
    if (!out) return false;
    if (!pickerRow) dispatch({ type: 'clear' });
    await refresh();
    const name = choice.tagId
      ? ((tags.data ?? []).find((x) => x.id === choice.tagId)?.name ?? '')
      : (choice.name ?? '');
    report(tb(action === 'add' ? 'tagged' : 'untagged', { count: out.changed, name }), out);
    return true;
  }

  /** The stage cell's menu: saves the new stage of one contact, with the row version the table last read. */
  async function changeStage(
    id: string,
    stage: string,
    reason?: { lostReason?: string | null; otherLostReason?: string | null },
  ) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    // A lost stage asks why first; nothing is saved until the dialog gives a reason.
    if (!reason && isLostStage(stages, stage)) {
      setLostPrompt({
        contactId: id,
        contactName: row.name ?? '',
        stageValue: stage,
        stageLabel: stages.find((x) => x.value === stage)?.label ?? stage,
      });
      return;
    }
    setStageBusy(id);
    try {
      const saved = await updateContact(id, {
        lifecycleStage: stage,
        ...reason,
        rowVersion: row.rowVersion,
      });
      setLostPrompt(null);
      await refresh();
      // The API keeps the status valid for the stage: say what happened to it, from its answer.
      const stageName = stages.find((x) => x.value === stage)?.label ?? stage;
      const notice = statusNotice(row.status, saved.status);
      toast(
        notice.kind === 'none'
          ? ts('changed', { stage: stageName })
          : notice.kind === 'cleared'
            ? ts('changedStatusCleared', { stage: stageName })
            : ts(notice.kind === 'reset' ? 'changedStatusReset' : 'changedStatusSet', {
                stage: stageName,
                status: statuses.find((x) => x.value === notice.status)?.label ?? notice.status,
              }),
        'success',
      );
    } catch (e) {
      const kind = errorKind(e);
      toast(
        ts(kind === 'conflict' ? 'conflict' : kind === 'forbidden' ? 'forbidden' : 'failed'),
        'danger',
      );
      if (kind === 'conflict') await refresh();
    } finally {
      setStageBusy(null);
    }
  }

  async function onDeleteOne() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await deleteContact(deleteTarget.id);
      setDeleteId(null);
      await refresh();
      toast(t('deleted'), 'success');
    } catch (e) {
      setDeleteId(null);
      const why = deleteFailure(e);
      if (why === 'gone') {
        // Deleted in another tab or by someone else: the list is stale, the contact is not "unavailable".
        await refresh();
        toast(t('alreadyDeleted'), 'info');
      } else {
        toast(tb(why), 'danger');
      }
    } finally {
      setBusy(false);
    }
  }

  const filtered = hasActiveFilter(filters);
  const count = sel.allMatching ? (total ?? null) : sel.ids.size;
  const selectedAny = sel.ids.size > 0 || sel.allMatching;
  const s = stats.data;

  const handlers = {
    selected: sel.ids,
    canEdit: canUpdate,
    canDelete,
    stageLabel: (v: string) => stages.find((x) => x.value === v)?.label ?? v,
    stageChoices: stages,
    onStageChange: canUpdate
      ? (id: string, stage: string) => void changeStage(id, stage)
      : undefined,
    stageBusyId: stageBusy,
    // Under each stage of the menu: what moving there would do to the contact's status.
    stageStatusHint: (status: string, stage: string) => {
      const move = statusAfterMove(statusOptions.data, status || null, stage);
      if (!move.changed) return null;
      return move.status === null
        ? ts('willClear')
        : ts('willReset', {
            status: statuses.find((x) => x.value === move.status)?.label ?? move.status,
          });
    },
    statusLabel: (v: string) => statuses.find((x) => x.value === v)?.label ?? v,
    onToggle: (id: string) => dispatch({ type: 'toggle', id }),
    onView: (id: string) => router.push(`/contacts/${id}`),
    onAddToGroup: (id: string) => {
      setPickerRow(id);
      setPicker('groupAdd');
    },
    onTag: (id: string) => {
      setPickerRow(id);
      setPicker('tagAdd');
    },
    onEdit: (id: string) => {
      const row = rows.find((r) => r.id === id);
      if (row) setFormFor(row);
    },
    onDelete: (id: string) => setDeleteId(id),
    onFilterTag: (tagId: string) => setFilters({ tag: tagId }),
  };

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground"
          >
            <BookUserIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight">{t('title')}</h1>
            <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">{t('subtitle')}</p>
          </div>
        </div>
        {canCreate && (
          <Button variant="brand" className="h-10 px-5" onClick={() => setFormFor('new')}>
            <PlusIcon /> {t('addContact')}
          </Button>
        )}
      </header>

      <ContactsToolbar
        q={q}
        onQ={setQ}
        segment={segmentOf(filters)}
        onSegment={(v) => setFilters(filtersOfSegment(v))}
        stats={s}
        groups={groups.data ?? []}
        segments={segmentOptions}
        segmentsState={segmentsState}
        onRetrySegments={() => void segmentList.refetch()}
        canCreateSegment={canCreateSegments}
        // A segment is saved from plain filters; with a segment already chosen there is nothing new to describe.
        onSaveAsSegment={
          canCreateSegments && filtered && !filters.segment && !filters.rules
            ? () => setSaveSegmentOpen(true)
            : undefined
        }
        rules={filters.rules}
        onRules={(rules) => setFilters({ rules })}
        tag={filters.tag}
        onTag={(id) => setFilters({ tag: id })}
        tags={tags.data ?? []}
        stage={filters.lifecycleStage}
        onStage={(v) => setFilters({ lifecycleStage: v })}
        stages={stages}
        consent={filters.consent}
        onConsent={(v) => setFilters({ consent: v })}
        order={filters.sort === 'createdAt' ? filters.order : null}
        onOrder={(v) => setFilters({ order: v, sort: 'createdAt' })}
        selectedCount={count}
        anySelected={selectedAny}
        busy={busy}
        onClearSelection={() => dispatch({ type: 'clear' })}
        onSendCampaign={() => void onSendCampaign()}
        can={{
          update: canUpdate,
          delete: canDelete,
          export: canExport,
          import: canImport,
          merge: canMerge,
          createGroups: canCreateGroups,
          createTags: canCreateTags,
        }}
        exporting={exporting}
        onExportAll={() => void runExport({ kind: 'filter', filter: snapshot }, setExporting)}
        onExportSelected={() => void runExport(target(), setBusy)}
        onImport={() => setImportOpen(true)}
        onAddColumnField={() => router.push('/contact-properties')}
        onUpdateSelected={() => setUpdateOpen(true)}
        updateDisabled={sel.allMatching}
        onDedupe={() => setDedupeOpen(true)}
        onNewGroup={() => setGroupOpen(true)}
        onDeleteSelected={() => setConfirmBulkDelete(true)}
        picker={pickerRow ? null : picker}
        onPicker={(p) => (p === null ? closePicker() : setPicker(p))}
        onGroup={onBulkGroup}
        onTagApply={onBulkTag}
        allColumns={allCols}
        visibleIds={visibleIds}
        onColumn={(id, on) => setStoredColumns(serializeColumns(toggleColumn(baseColumns, id, on)))}
        onResetColumns={() => {
          setStoredColumns(null);
          setStoredOrder(null);
        }}
        view={view}
        onView={chooseView}
        onRefresh={() => void Promise.all([refresh(), list.refetch()])}
        refreshing={list.isFetching}
      />

      <div>
        <button
          type="button"
          aria-expanded={showStats}
          onClick={() => setStatsRaw(showStats ? '0' : '1')}
          className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          {showStats ? (
            <ChevronDownIcon className="size-3.5" />
          ) : (
            <ChevronRightIcon className="size-3.5 rtl:rotate-180" />
          )}
          {showStats ? t('hideStats') : t('showStats')}
        </button>
        {showStats && (
          <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label={t('stats.total')}
              value={num(s?.total)}
              hint={t('stats.inWorkspace')}
            />
            <StatTile
              tone="accent"
              label={t('stats.groups')}
              value={num(s?.groups ?? groups.data?.length)}
              hint={t('stats.segments')}
            />
            <StatTile
              label={t('stats.subscribed')}
              value={num(s?.subscribed)}
              hint={t('stats.optedIn')}
            />
            <StatTile
              tone="warning"
              label={t('stats.unsubscribed')}
              value={num(s?.unsubscribed)}
              hint={t('stats.optedOut')}
            />
          </div>
        )}
      </div>

      {list.segmentInvalid > 0 && (
        <Alert tone="warning" className="flex flex-wrap items-center justify-between gap-2">
          <span>{t('segmentInvalid', { count: list.segmentInvalid })}</span>
          <Link
            href={`/segments/${filters.segment}/edit`}
            className="font-semibold underline underline-offset-2"
          >
            {t('segmentFix')}
          </Link>
        </Alert>
      )}

      {header === 'all' && total !== undefined && total > rows.length && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-center gap-2 rounded-md border border-border bg-brand/5 px-3 py-2 text-sm"
        >
          {sel.allMatching ? (
            <>
              {t('banner.allSelected', { total })}
              <button
                type="button"
                className="font-semibold text-brand underline underline-offset-2"
                onClick={() => dispatch({ type: 'clear' })}
              >
                {t('banner.clear')}
              </button>
            </>
          ) : (
            <>
              {t('banner.pageSelected', { count: rowIds.length })}
              <button
                type="button"
                className="font-semibold text-brand underline underline-offset-2"
                onClick={() => dispatch({ type: 'selectAllMatching' })}
              >
                {t('banner.selectAllMatching', { total })}
              </button>
            </>
          )}
        </div>
      )}

      <section
        aria-label={t('tableLabel')}
        aria-busy={list.isFetching}
        // The card is as tall as the window allows: the rows scroll inside it and the footer stays pinned.
        className="flex max-h-[max(26rem,calc(100dvh-17rem))] flex-col overflow-hidden rounded-xl border border-border bg-background"
      >
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col transition-opacity',
            list.isPlaceholderData && 'opacity-60',
          )}
        >
          {list.isPending ? (
            <ListSkeleton />
          ) : list.isError ? (
            <div className="p-4">
              <ErrorLine error={list.error} onRetry={() => void list.refetch()} />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={filtered ? t('emptyFilteredTitle') : t('emptyTitle')}
                message={filtered ? t('emptyFiltered') : t('empty')}
                actions={
                  <>
                    {filtered && (
                      <Button variant="secondary" onClick={() => router.replace(pathname)}>
                        {t('resetFilters')}
                      </Button>
                    )}
                    {canCreate && (
                      <Button variant="brand" onClick={() => setFormFor('new')}>
                        {t('addContact')}
                      </Button>
                    )}
                  </>
                }
              />
            </div>
          ) : view === 'list' ? (
            <ContactsTable
              rows={views}
              columns={columns}
              headerState={header}
              onToggleAll={(checked) => dispatch({ type: 'setMany', ids: rowIds, checked })}
              sort={{ key: filters.sort, order: filters.order }}
              onSort={onSortColumn}
              onMoveColumn={(id, target) =>
                setStoredOrder(
                  serializeColumns(
                    moveColumn(
                      columns.map((c) => c.id),
                      id,
                      target,
                    ),
                  ),
                )
              }
              onNudgeColumn={(id, step) =>
                setStoredOrder(
                  serializeColumns(
                    nudgeColumn(
                      columns.map((c) => c.id),
                      id,
                      step,
                    ),
                  ),
                )
              }
              {...handlers}
            />
          ) : (
            <ContactsKanban
              filters={filters}
              stages={stages}
              toView={(r) => rowView(r, attrLabels)}
              onStageChange={handlers.onStageChange}
              stageBusyId={stageBusy}
            />
          )}
        </div>
        {!list.isError && view === 'list' && (
          <ContactsPagination
            page={list.page}
            total={total}
            limit={filters.limit}
            loading={list.isFetching}
            onPage={(p) => setFilters({ page: p })}
            onLimit={(n) => setFilters({ limit: n })}
            onRecount={() => void invalidateContacts(qc)}
            approximate={list.totalApproximate}
          />
        )}
      </section>

      {pickerRow && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[20vh]">
          <div className="relative h-0 w-72">
            <BulkPickers
              picker={picker}
              canCreateTags={canCreateTags}
              onClose={closePicker}
              onGroup={onBulkGroup}
              onTag={onBulkTag}
            />
          </div>
        </div>
      )}

      <ContactFormModal
        open={formFor !== null}
        contact={formFor === 'new' || formFor === null ? undefined : formFor}
        onClose={() => setFormFor(null)}
      />
      <LostReasonDialog
        prompt={lostPrompt}
        busy={stageBusy !== null}
        onConfirm={(p, fields) => void changeStage(p.contactId, p.stageValue, fields)}
        onClose={() => setLostPrompt(null)}
      />
      <BulkUpdateDialog
        open={updateOpen}
        count={sel.ids.size}
        busy={busy}
        onApply={onBulkUpdate}
        onClose={() => setUpdateOpen(false)}
      />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <GroupModal open={groupOpen} onClose={() => setGroupOpen(false)} />
      <SaveSegmentModal
        open={saveSegmentOpen}
        filter={{ ...contactFilterBody({ ...filters, segment: '' }), segmentId: undefined }}
        onClose={() => setSaveSegmentOpen(false)}
      />
      <DedupeDialog open={dedupeOpen} onClose={() => setDedupeOpen(false)} />
      <ConfirmDialog
        open={deleteId !== null}
        tone="danger"
        busy={busy}
        title={t('deleteTitle')}
        message={t('deleteMessage', { name: deleteTarget ? displayName(deleteTarget) : '' })}
        confirmLabel={t('delete')}
        cancelLabel={t('keep')}
        onClose={() => setDeleteId(null)}
        onConfirm={() => void onDeleteOne()}
      />
      <ConfirmDialog
        open={confirmBulkDelete}
        tone="danger"
        busy={busy}
        title={tb('deleteTitle')}
        message={count === null ? tb('deleteAllMessage') : tb('deleteMessage', { count })}
        confirmLabel={tb('delete')}
        cancelLabel={tb('keep')}
        onClose={() => setConfirmBulkDelete(false)}
        onConfirm={() => void onBulkDelete()}
      />
    </div>
  );
}

function ListSkeleton() {
  const t = useTranslations('contacts-attributes-tags.list');
  return (
    <div role="status" aria-label={t('loading')} className="divide-y divide-border">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex h-16 animate-pulse items-center gap-4 px-4">
          <span className="size-4 rounded bg-muted" />
          <span className="size-8 rounded-full bg-muted" />
          <span className="h-3 w-40 rounded bg-muted" />
          <span className="hidden h-3 w-28 rounded bg-muted sm:block" />
          <span className="hidden h-3 w-44 rounded bg-muted md:block" />
          <span className="ms-auto h-3 w-24 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
