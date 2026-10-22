'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Button, ConfirmDialog, EmptyState, StatTile, cn, useToast } from '@crm/ui';
import type { ContactViewResponse } from '@crm/contracts';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { PageFill } from '@/components/shell/page-fill';
import { CallingProvider, OnCallPanel } from '@/features/calling-voice';
import { useLeadScoringEnabled } from '@/features/lead-scoring';
import {
  invalidateSegments,
  useSegments,
  useTeamFilterOptions,
  appliedConditionCount,
} from '@/features/segments';
import { useStoredValue } from '@/lib/use-stored-value';
import type { ContactTouchChannel } from '@crm/contracts';
import { bulkSetUncontacted, reportContactTouch } from '../api/lead-handling';
import { useAttributes, useContactFilterValues, useStatusOptions } from '../api/attributes';
import {
  bulkDelete,
  bulkGroupMembership,
  bulkOwner,
  bulkTag,
  bulkUpdate,
  exportContacts,
  startCampaignDraft,
  type BulkOutcome,
  type BulkUpdateValues,
} from '../api/bulk';
import {
  contactFilterBody,
  DEFAULT_FILTERS,
  deleteContact,
  invalidateContacts,
  KEYS,
  useContactsPage,
  useContactStats,
  type ContactFilters,
} from '../api/contacts';
import { useGroups } from '../api/groups';
import { useOwnerNames } from '../api/owners';
import { openConversation, useChannels } from '../api/single-send';
import { useTags } from '../api/tags';
import type { ContactRow } from '../api/schemas';
import {
  addableColumns,
  allColumns,
  hideColumn,
  parseStoredColumns,
  serializeColumns,
  showColumn,
  STORAGE_KEY as COLUMNS_KEY,
  ORDER_STORAGE_KEY as COLUMN_ORDER_KEY,
  moveColumn,
  nudgeColumn,
  omittedColumns,
  restoreOmitted,
  visibleColumns,
  type ColumnId,
} from '../lib/columns';
import { appliedFilterChips, clearAllPatch, type FilterChip } from '../lib/applied-filters';
import { displayName } from '../lib/contact-model';
import { downloadBlob } from '../lib/download';
import { deleteFailure, errorKind } from '../lib/errors';
import { filtersToSearch, hasActiveFilter, parseFilters } from '../lib/filters';
import { presetFilters, type PresetView } from '../lib/preset-views';
import { filtersOfView, viewColumnsOf, viewIdOf, withView } from '../lib/views';
import { useContactViews } from '../api/views';
import { stageChoices, statusChoices } from '../lib/option-sets';
import { clampPage, totalPages } from '../lib/pagination';
import { defaultPageSize, PAGE_SIZE_KEY } from '../lib/page-size';
import { neighboursOf, quickViewIdOf, quickViewPanelOf, withQuickView } from '../lib/quick-view';
import { rowView, type RowView } from '../lib/row-view';
import {
  SECTION_OF_TARGET,
  type AddTarget,
  type FocusRequest,
  type SectionId,
} from '../lib/sections';
import { emailChannels, whatsappChannels, type SendChannel } from '../lib/single-send';
import {
  bulkTarget,
  EMPTY_SELECTION,
  headerState,
  selectionReducer,
  type BulkTarget,
} from '../lib/selection';
import { useStoredChoice } from '../lib/use-stored-choice';
import { type BulkPicker, type TagChoice } from './bulk-bar';
import { BulkUpdateDialog } from './bulk-update-dialog';
import { ContactFormModal } from './contact-form-modal';
import { ContactQuickView } from './contact-quick-view';
import { ContactsKanban } from './contacts-kanban';
import { ContactsTable } from './contacts-list';
import { ContactsPagination } from './contacts-pagination';
import { ContactsToolbar } from './contacts-toolbar';
import { AppliedFilters } from './applied-filters';
import type { FilterSection } from './filter-panel';
import { SaveSegmentModal } from './save-segment-modal';
import type { SegmentOption, SegmentsState } from './segment-picker';
import { SelectionBar } from './selection-bar';
import { DedupeDialog } from './dedupe-dialog';
import { ErrorLine } from './error-line';
import { useStageMove } from './use-stage-move';
import { statusAfterMove } from '../lib/status-scope';
import { GroupModal } from './group-modal';
import { SingleSendDrawer, type SingleSendTarget } from './single-send-drawer';
import { ViewsBar } from './views-bar';
import { FirstRun } from './first-run';
import { ImportModal } from './import-modal';
import { DeleteHistoryOption } from './delete-history-option';
import { BulkPickers } from './bulk-bar';

type View = 'list' | 'kanban';
const VIEWS = ['list', 'kanban'] as const;
const STATS_KEY = 'cat:contacts:stats';

const num = (n: number | undefined) => (n === undefined ? '—' : n.toLocaleString());

/** Which part of the Filter panel a column header's "Filter" opens; the name, phone and email columns open the condition builder on that field instead. */
const COLUMN_FILTER: Partial<Record<ColumnId, FilterSection>> = {
  stage: 'stage',
  status: 'status',
  minor: 'minor',
  owner: 'owner',
  tags: 'tag',
  groups: 'segment',
  whatsapp: 'consent',
  sms: 'consent',
  emailOptIn: 'consent',
  source: 'source',
};
const SEARCH_COLUMNS: readonly ColumnId[] = ['name', 'phone', 'email'];

/**
 * `/contacts`, the Contact Hub (TW-CON-001..008, 019): one slim toolbar (search, Filter, Columns, Create View, layout, Add Contact,
 * the "..." menu, refresh), the applied-filter chips, the saved-view row (or the selection bar while rows are ticked), the table
 * with its fixed footer, and the quick view that opens over it. Filters, the page number and the open contact live in the URL; the
 * visible columns, the layout and the stats strip are per-browser preferences (a saved view can keep its own columns); everything
 * else is local state over the page query.
 */
export function ContactsScreen() {
  const t = useTranslations('contacts-attributes-tags.list');
  const tb = useTranslations('contacts-attributes-tags.bulk');
  const tu = useTranslations('contacts-attributes-tags.leadHandling.uncontacted');
  const tfu = useTranslations('contacts-attributes-tags.leadHandling.followUp');
  const tf = useTranslations('contacts-attributes-tags.form');
  const ts = useTranslations('contacts-attributes-tags.stageMenu');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const session = useSession();
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
  const canReadViews = useCan('record.contact-views.read');
  const canCreateViews = useCan('record.contact-views.create');
  const canUpdateViews = useCan('record.contact-views.update');
  const canDeleteViews = useCan('record.contact-views.delete');
  const canReadCompanies = useCan('record.companies.read');
  const canSend = useCan('inbox.conversation.reply');
  const canCall = useCan('call.calls.use');
  const canTask = useCan('record.tasks.create');
  const canConnectWhatsapp = useCan('waba.numbers.read');

  // The rows-per-page choice is remembered per browser; a `per=` in the URL (a shared link) still wins.
  const [storedSize, setStoredSize] = useStoredValue(PAGE_SIZE_KEY);
  const sizeDefault = defaultPageSize(storedSize);
  const filters = useMemo(() => parseFilters(search, sizeDefault), [search, sizeDefault]);
  /** The open saved view (`?view=`), kept in the URL beside the filters it applied. */
  const viewId = viewIdOf(search);
  /** The contact the quick view shows (`?contact=`) and its section (`&panel=`). */
  const quickId = quickViewIdOf(search);
  const quickPanel = quickViewPanelOf(search);
  /** A request to put the cursor in an inline composer of the quick view (the row's quick add, the action bar's buttons). */
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const askFocus = useCallback(
    (target: AddTarget | null, clickedAt?: number) =>
      setFocus(target ? { target, n: Date.now(), ...(clickedAt ? { clickedAt } : {}) } : null),
    [],
  );
  /** Changing any filter, the sort or the page size starts again from page 1 and closes the quick view; only `page` keeps the position. */
  const setFilters = (patch: Partial<ContactFilters>) => {
    if (patch.limit !== undefined) setStoredSize(String(patch.limit));
    router.replace(
      `${pathname}${withView(filtersToSearch({ ...filters, page: 1, ...patch }, patch.limit ?? sizeDefault), viewId)}`,
      { scroll: false },
    );
  };

  /** The view whose saved filters were last put in the URL (so landing on `?view=` applies them once). */
  const appliedView = useRef('');

  /** A view tab: apply the filters it saved (all defaults for "All contacts"). */
  const selectView = (view: ContactViewResponse | null) => {
    appliedView.current = view?.id ?? '';
    const next = view
      ? filtersOfView(view.filter, sizeDefault)
      : { ...DEFAULT_FILTERS, limit: sizeDefault };
    router.replace(`${pathname}${withView(filtersToSearch(next, sizeDefault), view?.id ?? '')}`, {
      scroll: false,
    });
  };

  /** A built-in view: the filters it stands for, on top of the defaults, with no saved view open. */
  const selectPreset = (preset: PresetView) => {
    appliedView.current = '';
    const next = {
      ...DEFAULT_FILTERS,
      limit: sizeDefault,
      ...presetFilters(preset, session.user.id),
    };
    router.replace(`${pathname}${filtersToSearch(next, sizeDefault)}`, { scroll: false });
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
  const { owners, nameOf: ownerName, loading: ownersLoading } = useOwnerNames();
  const teamFilter = useTeamFilterOptions();
  const channels = useChannels(canSend);
  const numbers = useMemo(() => whatsappChannels(channels.data?.data ?? []), [channels.data]);

  const rows = list.items;
  const total = list.total;
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const attrLabels = useMemo(
    () => new Map((attributes.data ?? []).map((a) => [a.key, a.name])),
    [attributes.data],
  );
  // The filters also offer the stages and statuses contacts hold that the workspace never listed (e.g. the default stage `new`).
  const filterValues = useContactFilterValues();
  const stages = useMemo(
    () => stageChoices(statusOptions.data, undefined, filterValues.data?.lifecycleStages),
    [statusOptions.data, filterValues.data],
  );
  const statuses = useMemo(
    () =>
      statusChoices(
        statusOptions.data,
        (v) => tf(`statuses.${v}`),
        undefined,
        undefined,
        filterValues.data?.statuses,
      ),
    [statusOptions.data, filterValues.data, tf],
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
      router.replace(
        `${pathname}${withView(filtersToSearch({ ...filters, page: want }, sizeDefault), viewId)}`,
        { scroll: false },
      );
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
      (attributes.data ?? [])
        .filter((a) => a.active && !a.hidden)
        .map((a) => ({ key: a.key, name: a.name })),
    [attributes.data],
  );
  // Lead scoring off: no Lead score column, and none in the picker (the choice is kept; it comes back when scoring is switched on).
  const scoringOn = useLeadScoringEnabled();
  const omitted = useMemo(
    () => omittedColumns({ canCompany: canReadCompanies, scoringOn }),
    [canReadCompanies, scoringOn],
  );
  const stored = useMemo(() => parseStoredColumns(storedColumns), [storedColumns]);
  // A saved view can keep its own columns: while it is open they replace the person's, and edits to them stay on this
  // screen (a draft) until "Save current filters" stores them in the view.
  const viewsList = useContactViews(canReadViews);
  const activeView = viewId ? viewsList.data?.find((v) => v.id === viewId) : undefined;

  // Landing on `?view=` with no filters in the URL (a fresh create, a reload, a shared link): apply what the view saved. Filters already
  // in the URL (the tab was clicked, or a link carries them) are left as they are.
  useEffect(() => {
    if (!viewId) {
      appliedView.current = '';
      return;
    }
    if (!activeView || appliedView.current === viewId) return;
    appliedView.current = viewId;
    if (hasActiveFilter(filters)) return;
    router.replace(
      `${pathname}${withView(filtersToSearch(filtersOfView(activeView.filter, sizeDefault), sizeDefault), viewId)}`,
      { scroll: false },
    );
    // Runs when the open view or its data changes; `filters` is read for the URL as it is now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId, activeView]);

  const savedViewCols = useMemo(
    () => (activeView ? (viewColumnsOf(activeView.filter) as ColumnId[] | null) : null),
    [activeView],
  );
  const [colDraft, setColDraft] = useState<{ viewId: string; ids: ColumnId[] } | null>(null);
  const viewCols = savedViewCols
    ? colDraft?.viewId === viewId
      ? colDraft.ids
      : savedViewCols
    : null;
  const columns = useMemo(
    () =>
      viewCols
        ? visibleColumns(viewCols, attributeColumns, viewCols, omitted)
        : visibleColumns(stored, attributeColumns, parseStoredColumns(storedOrder), omitted),
    [viewCols, stored, attributeColumns, storedOrder, omitted],
  );
  const columnIds = useMemo(() => columns.map((c) => c.id), [columns]);
  /** What the views bar compares with and saves into the open view: the view's own columns left out only for now are kept in it. */
  const viewColumnIds = useMemo(
    () => (savedViewCols ? restoreOmitted(columnIds, savedViewCols, omitted) : columnIds),
    [columnIds, savedViewCols, omitted],
  );
  /** Where a column change goes: the open view's draft, or the person's own stored columns. */
  const chooseColumns = (ids: ColumnId[], order: boolean) => {
    if (viewCols) setColDraft({ viewId, ids });
    else if (order) setStoredOrder(serializeColumns(ids));
    else setStoredColumns(serializeColumns(ids));
  };
  /** Both the set and its order: a view's draft holds one list that is also the order. */
  const applyColumns = (ids: ColumnId[]) => {
    chooseColumns(ids, false);
    if (!viewCols) chooseColumns(ids, true);
  };
  const allCols = useMemo(() => allColumns(attributeColumns, omitted), [attributeColumns, omitted]);
  const addable = useMemo(() => addableColumns(allCols, columnIds), [allCols, columnIds]);

  // Which part of the Filter panel to open from a column header, and a nudge that puts the cursor in the search box.
  const [filterRequest, setFilterRequest] = useState<{
    section: FilterSection;
    nonce: number;
  } | null>(null);
  const [fieldRequest, setFieldRequest] = useState<{ field: string; nonce: number } | null>(null);
  const filterColumn = (id: ColumnId) => {
    const section = COLUMN_FILTER[id];
    if (section) setFilterRequest({ section, nonce: (filterRequest?.nonce ?? 0) + 1 });
    // Name, phone and email have no quick filter: the condition builder opens with that field ready to fill.
    else setFieldRequest({ field: id, nonce: (fieldRequest?.nonce ?? 0) + 1 });
  };

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
    status: filters.status,
    minor: filters.minor,
    source: filters.source,
    segment: filters.segment,
    owner: filters.owner,
    team: filters.team,
    rules: filters.rules,
  };
  const target = (): BulkTarget =>
    pickerRow ? { kind: 'ids', ids: [pickerRow] } : bulkTarget(sel, snapshot);

  // modals
  const [formFor, setFormFor] = useState<ContactRow | 'new' | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [keepHistory, setKeepHistory] = useState(false);
  const [dedupeOpen, setDedupeOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [saveSegmentOpen, setSaveSegmentOpen] = useState(false);
  const [picker, setPicker] = useState<BulkPicker>(null);
  const [updateOpen, setUpdateOpen] = useState<null | 'all' | 'owner' | 'stage'>(null);
  /** The contact a group/tag picker opened from a row's menu acts on; null when it acts on the selection. */
  const [pickerRow, setPickerRow] = useState<string | null>(null);
  const [sendTarget, setSendTarget] = useState<SingleSendTarget | null>(null);
  const closePicker = () => {
    setPicker(null);
    setPickerRow(null);
  };
  const [busy, setBusy] = useState(false);
  // Every stage move of the list and the board (the cell's picker, a dragged card) is the shared one: optimistic, with undo.
  const stageMove = useStageMove();
  const stageBusy = stageMove.busyId;
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
      router.push(`/campaigns/create?draft=${await startCampaignDraft(target())}`);
    } catch {
      toast(tb('failed'), 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function onBulkDelete() {
    const out = await guarded(() => bulkDelete(target(), { eraseHistory: !keepHistory }));
    setConfirmBulkDelete(false);
    setKeepHistory(false);
    if (!out) return;
    dispatch({ type: 'clear' });
    await refresh();
    report(tb('deleted', { count: out.changed }), out);
  }

  /** Marks the selection as uncontacted (`true`) or as contacted (`false`) by hand. */
  async function onBulkMark(uncontacted: boolean) {
    const out = await guarded(() => bulkSetUncontacted(target(), uncontacted));
    if (!out) return;
    dispatch({ type: 'clear' });
    await refresh();
    report(
      tu(uncontacted ? 'bulkMarkedUncontacted' : 'bulkMarkedContacted', { count: out.changed }),
      out,
    );
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
    // "All N matching" has no ids to list: it can only change the owner, which the API does for a whole filter at once.
    const out = await guarded(() =>
      sel.allMatching
        ? bulkOwner(target(), values.ownerId ?? null)
        : bulkUpdate([...sel.ids], values),
    );
    if (!out) return false;
    dispatch({ type: 'clear' });
    await refresh();
    report(tb('updated', { count: out.changed }), out);
    return true;
  }

  async function onBulkTag(action: 'add' | 'remove', choices: TagChoice[]): Promise<boolean> {
    let out: Awaited<ReturnType<typeof bulkTag>> | null | undefined = null;
    for (const choice of choices) {
      out = await guarded(() => bulkTag(target(), action, choice));
      if (!out) return false;
    }
    if (!out) return false;
    if (!pickerRow) dispatch({ type: 'clear' });
    await refresh();
    const name = choices
      .map((c) =>
        c.tagId ? ((tags.data ?? []).find((x) => x.id === c.tagId)?.name ?? '') : (c.name ?? ''),
      )
      .filter(Boolean)
      .join(', ');
    report(tb(action === 'add' ? 'tagged' : 'untagged', { count: out.changed, name }), out);
    return true;
  }

  /** The stage cell's picker and the board: moves one contact, with the row version the table last read. */
  function changeStage(id: string, stage: string, status?: string | null) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    void stageMove.move(
      {
        id,
        name: row.name ?? '',
        rowVersion: row.rowVersion,
        stage: row.lifecycleStage || null,
        status: row.status || null,
      },
      { stage, status },
    );
  }

  async function onDeleteOne() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await deleteContact(deleteTarget.id, { eraseHistory: !keepHistory });
      setDeleteId(null);
      setKeepHistory(false);
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

  /** A contact button was pressed: the workspace's lead handling settings decide whether that marks the contact as contacted. */
  const pressed = (row: RowView, channel: ContactTouchChannel) => {
    if (!canUpdate) return;
    reportContactTouch(row.id, channel, row.uncontactedSince ? () => void refresh() : undefined);
  };

  /** The chat icon: open the conversation with the contact on the one connected number and go to it; several numbers: pick in the drawer. */
  async function onChat(row: RowView) {
    if (numbers.length !== 1) return setSendTarget({ row, channel: 'whatsapp' });
    try {
      const opened = await openConversation(row.id, numbers[0]!.id);
      router.push(`/inbox?c=${opened.id}`);
    } catch {
      toast(tb('failed'), 'danger');
    }
  }

  // --- the quick view ---
  const neighbours = neighboursOf(rowIds, quickId);
  /** Opens or moves the quick view; opening pushes a history entry (Back closes it), moving between contacts replaces it. */
  const goQuick = useCallback(
    (id: string, panel: SectionId = 'overview', how: 'push' | 'replace' = 'push') => {
      const next = `${pathname}${withQuickView(search.toString(), id, panel)}`;
      if (how === 'push') router.push(next, { scroll: false });
      else router.replace(next, { scroll: false });
    },
    [pathname, router, search],
  );

  const filtered = hasActiveFilter(filters);
  const count = sel.allMatching ? (total ?? null) : sel.ids.size;
  const selectedAny = sel.ids.size > 0 || sel.allMatching;
  const s = stats.data;

  const conditions = appliedConditionCount(filters.rules);
  const [aiSummary, setAiSummary] = useState<{ rules: string; summary: string } | null>(null);
  const chips = appliedFilterChips(filters, {
    words: {
      segment: t('segmentLabel'),
      group: t('groupLabel'),
      tag: t('tagLabel'),
      owner: t('ownerLabel'),
      team: t('teamLabel'),
      stage: t('stageLabel'),
      status: t('statusLabel'),
      minor: t('minorLabel'),
      minorYes: t('minorYes'),
      minorNo: t('minorNo'),
      followUp: tfu('filterLabel'),
      followUpStates: {
        overdue: tfu('filter.overdue'),
        today: tfu('filter.today'),
        upcoming: tfu('filter.upcoming'),
        someday: tfu('filter.someday'),
        none: tfu('filter.none'),
      },
      consent: t('consentLabel'),
      source: t('sourceLabel'),
      conditions: t('conditionsLabel'),
      imported: t('imported'),
      noGroup: t('noGroup'),
      unassigned: t('unassigned'),
      myContacts: t('myContacts'),
      formerMember: t('ownerFormer'),
      formerTeam: t('teamFormer'),
      subscribed: t('subscribedOnly'),
      unsubscribed: t('unsubscribedOnly'),
      conditionsValue: (n) => t('conditionsChip', { count: n }),
    },
    group: (id) => (groups.data ?? []).find((g) => g.id === id)?.name,
    segment: (id) => segmentOptions.find((x) => x.id === id)?.name,
    tag: (id) => (tags.data ?? []).find((x) => x.id === id)?.name,
    owner: (id) => ownerName(id),
    team: (id) => teamFilter.teams.find((x) => x.id === id)?.name,
    stage: (v) => stages.find((x) => x.value === v)?.label,
    status: (v) => statuses.find((x) => x.value === v)?.label,
    conditionCount: appliedConditionCount,
    aiSummary:
      aiSummary && aiSummary.rules === filters.rules && aiSummary.summary !== ''
        ? aiSummary.summary
        : null,
    meId: session.user.id,
  });
  const removeChip = (chip: FilterChip) => setFilters(chip.clear);

  const handlers = {
    selected: sel.ids,
    canEdit: canUpdate,
    canDelete,
    can: { note: canUpdate, task: canTask, call: canCall, send: canSend, chat: canSend },
    // Unknown while the channel list loads: the Message button then assumes the number or mailbox is there.
    connected: channels.isSuccess
      ? { whatsapp: numbers.length > 0, email: emailChannels(channels.data.data).length > 0 }
      : undefined,
    stageLabel: (v: string) => stages.find((x) => x.value === v)?.label ?? v,
    stageChoices: stages,
    onStageChange: canUpdate
      ? (id: string, stage: string, status?: string | null) => changeStage(id, stage, status)
      : undefined,
    stageBusyId: stageBusy,
    stageStatusesOf: stageMove.statusesOf,
    stageDefaultStatusOf: stageMove.defaultStatusOf,
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
    // While the people are loading the cell stays empty; a person who has left the workspace reads "Former member".
    ownerLabel: (id: string) => ownerName(id) ?? (ownersLoading ? '' : t('ownerFormer')),
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
    onSend:
      canSend || canCall
        ? (row: RowView, channel: SendChannel) => {
            pressed(row, channel);
            setSendTarget({ row, channel });
          }
        : undefined,
    onFilterTag: (tagId: string) => setFilters({ tag: tagId }),
    onOpenQuick: (id: string, target?: AddTarget) => {
      askFocus(target ?? null);
      goQuick(id, target ? SECTION_OF_TARGET[target] : 'overview');
    },
    onChat: canSend
      ? (row: RowView) => {
          pressed(row, 'whatsapp');
          void onChat(row);
        }
      : undefined,
    onCopy: (value: string) => {
      void navigator.clipboard?.writeText(value).then(
        () => toast(t('copied'), 'success'),
        () => toast(t('copyFailed'), 'danger'),
      );
    },
  };

  return (
    <CallingProvider>
      {/* The content area fills the window under the top bar and any notice bars (the shell subtracts them): the rows scroll inside the card and its footer stays put. */}
      <PageFill minHeight="26rem" className="gap-3">
        <div className="shrink-0 space-y-3">
          <nav aria-label={t('breadcrumb')} className="text-sm text-muted-foreground">
            <ol className="flex items-center gap-1.5">
              <li>{t('breadcrumbContacts')}</li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="font-semibold text-foreground">
                {t('breadcrumbList')}
              </li>
            </ol>
          </nav>
          <h1 className="sr-only">{t('title')}</h1>

          <ContactsToolbar
            q={q}
            onQ={setQ}
            filter={{
              filters,
              onChange: (patch) => setFilters(patch),
              stats: s,
              groups: groups.data ?? [],
              segments: segmentOptions,
              segmentsState,
              onRetrySegments: () => void segmentList.refetch(),
              canCreateSegment: canCreateSegments,
              tags: tags.data ?? [],
              owners,
              teams: teamFilter.teams,
              meId: session.user.id,
              // The shortcut on a one-person filter: select everything the view matches and open the owner change.
              onReassignView:
                canUpdate && total !== 0
                  ? () => {
                      dispatch({ type: 'selectAllMatching' });
                      setUpdateOpen('owner');
                    }
                  : undefined,
              stages,
              statuses,
              onAiSummary: (rules, summary) => setAiSummary({ rules, summary }),
              conditionCount: conditions,
              request: filterRequest,
              fieldRequest,
            }}
            allColumns={allCols}
            columnIds={columnIds}
            onApplyColumns={applyColumns}
            onResetColumns={() => {
              if (viewCols) return setColDraft(null);
              setStoredColumns(null);
              setStoredOrder(null);
            }}
            onAddColumnField={() => router.push('/contact-properties')}
            onCreateView={canCreateViews ? () => router.push('/contacts/views/new') : undefined}
            view={view}
            onView={chooseView}
            onAdd={canCreate ? () => setFormFor('new') : undefined}
            can={{
              export: canExport,
              import: canImport,
              merge: canMerge,
              createGroups: canCreateGroups,
            }}
            exporting={exporting}
            onExportAll={() => void runExport({ kind: 'filter', filter: snapshot }, setExporting)}
            onImport={() => setImportOpen(true)}
            onDedupe={() => setDedupeOpen(true)}
            onNewGroup={() => setGroupOpen(true)}
            showStats={showStats}
            onToggleStats={() => setStatsRaw(showStats ? '0' : '1')}
            // A segment is saved from plain filters; with a segment already chosen there is nothing new to describe.
            onSaveAsSegment={
              canCreateSegments && filtered && !filters.segment && !filters.rules
                ? () => setSaveSegmentOpen(true)
                : undefined
            }
            onRefresh={() => void Promise.all([refresh(), list.refetch()])}
            refreshing={list.isFetching}
          />

          <AppliedFilters
            chips={chips}
            onRemove={removeChip}
            onClearAll={() => setFilters(clearAllPatch())}
            onSaveAsSegment={
              canCreateSegments && filtered && !filters.segment && !filters.rules
                ? () => setSaveSegmentOpen(true)
                : undefined
            }
          />

          {selectedAny ? (
            <SelectionBar
              count={count}
              busy={busy}
              can={{
                update: canUpdate,
                delete: canDelete,
                export: canExport,
                createTags: canCreateTags,
              }}
              onClear={() => dispatch({ type: 'clear' })}
              onSendCampaign={() => void onSendCampaign()}
              onExport={() => void runExport(target(), setBusy)}
              onDelete={() => setConfirmBulkDelete(true)}
              onAssignOwner={() => setUpdateOpen('owner')}
              onChangeStage={() => setUpdateOpen('stage')}
              onUpdate={() => setUpdateOpen('all')}
              onMarkUncontacted={(v) => void onBulkMark(v)}
              picker={pickerRow ? null : picker}
              onPicker={(p) => (p === null ? closePicker() : setPicker(p))}
              onGroup={onBulkGroup}
              onTagApply={onBulkTag}
            />
          ) : (
            canReadViews && (
              <div className="flex min-h-[3.25rem] flex-wrap items-center gap-x-4 gap-y-2">
                <ViewsBar
                  filters={filters}
                  defaultLimit={sizeDefault}
                  activeId={viewId}
                  columnIds={viewColumnIds}
                  keepsColumns={savedViewCols !== null}
                  onSelect={selectView}
                  onPreset={selectPreset}
                  meId={session.user.id}
                  count={viewId || !filtered ? (viewId ? total : s?.total) : undefined}
                  can={{ create: canCreateViews, update: canUpdateViews, delete: canDeleteViews }}
                  hasUncontacted={(s?.uncontacted ?? 0) > 0}
                  hasFollowUp={(s?.withFollowUp ?? 0) > 0}
                />
                {/* One count only: the pill on the view picker says it, except while a filter is on (the pill would be the workspace's). */}
                {filtered && !viewId && (
                  <p className="text-sm text-muted-foreground">
                    {t('totalLabel')}{' '}
                    <strong className="font-semibold tabular-nums text-foreground">
                      {total === undefined
                        ? '—'
                        : list.totalApproximate
                          ? t('approxTotal', { total })
                          : total.toLocaleString()}
                    </strong>
                  </p>
                )}
              </div>
            )
          )}
        </div>

        {showStats && (
          <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
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

        {list.segmentInvalid > 0 && (
          <Alert
            tone="warning"
            className="flex shrink-0 flex-wrap items-center justify-between gap-2"
          >
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
            className="flex shrink-0 flex-wrap items-center justify-center gap-2 rounded-md border border-border bg-brand/5 px-3 py-2 text-sm"
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
          // The card takes what is left of the content area: the rows scroll inside it and the footer stays pinned to its bottom edge.
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background"
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
            ) : rows.length === 0 && !filtered ? (
              <FirstRun
                onAdd={canCreate ? () => setFormFor('new') : undefined}
                onImport={canImport ? () => setImportOpen(true) : undefined}
                connectHref={canConnectWhatsapp ? '/channels/whatsapp' : undefined}
              />
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
                onSortTo={(key, order) => setFilters({ sort: key, order })}
                onMoveColumn={(id, target) =>
                  chooseColumns(
                    moveColumn(
                      columns.map((c) => c.id),
                      id,
                      target,
                    ),
                    true,
                  )
                }
                onNudgeColumn={(id, step) =>
                  chooseColumns(
                    nudgeColumn(
                      columns.map((c) => c.id),
                      id,
                      step,
                    ),
                    true,
                  )
                }
                columnTools={{
                  addable,
                  onAdd: (id) => applyColumns(showColumn(columnIds, id)),
                  onHide: (id) => applyColumns(hideColumn(columnIds, id)),
                  hasFilter: (id) => id in COLUMN_FILTER || SEARCH_COLUMNS.includes(id),
                  onFilter: filterColumn,
                  onAddField: () => router.push('/contact-properties'),
                }}
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
              rowsOnPage={rows.length}
              loading={list.isFetching}
              onPage={(p) => setFilters({ page: p })}
              onLimit={(n) => setFilters({ limit: n })}
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

        <ContactQuickView
          contactId={quickId}
          panel={quickPanel}
          focus={focus}
          previousId={neighbours.previous}
          nextId={neighbours.next}
          position={
            neighbours.index >= 0
              ? {
                  index: neighbours.index + (list.page - 1) * filters.limit,
                  total: total ?? rows.length,
                }
              : null
          }
          onNavigate={(id) => {
            askFocus(null);
            goQuick(id, quickPanel, 'replace');
          }}
          onPanel={(section, opts) => {
            askFocus(opts?.focus ?? null, opts?.clickedAt);
            goQuick(quickId, section, 'replace');
          }}
          onClose={() => {
            askFocus(null);
            router.replace(`${pathname}${withQuickView(search.toString(), '')}`, { scroll: false });
          }}
        />

        <ContactFormModal
          open={formFor !== null}
          contact={formFor === 'new' || formFor === null ? undefined : formFor}
          onClose={() => setFormFor(null)}
        />
        <>{stageMove.dialog}</>
        <BulkUpdateDialog
          open={updateOpen !== null}
          count={sel.allMatching ? (total ?? null) : sel.ids.size}
          ownerOnly={sel.allMatching}
          focus={updateOpen === 'owner' || updateOpen === 'stage' ? updateOpen : undefined}
          busy={busy}
          onApply={onBulkUpdate}
          onClose={() => setUpdateOpen(null)}
        />
        <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
        <GroupModal open={groupOpen} onClose={() => setGroupOpen(false)} />
        <SingleSendDrawer target={sendTarget} onClose={() => setSendTarget(null)} />
        <OnCallPanel />
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
          message={
            <>
              <p>{t('deleteMessage', { name: deleteTarget ? displayName(deleteTarget) : '' })}</p>
              <DeleteHistoryOption keepHistory={keepHistory} onChange={setKeepHistory} />
            </>
          }
          confirmLabel={t('delete')}
          cancelLabel={t('keep')}
          onClose={() => {
            setDeleteId(null);
            setKeepHistory(false);
          }}
          onConfirm={() => void onDeleteOne()}
        />
        <ConfirmDialog
          open={confirmBulkDelete}
          tone="danger"
          busy={busy}
          title={tb('deleteTitle')}
          message={
            <>
              <p>{count === null ? tb('deleteAllMessage') : tb('deleteMessage', { count })}</p>
              <DeleteHistoryOption many keepHistory={keepHistory} onChange={setKeepHistory} />
            </>
          }
          confirmLabel={tb('delete')}
          cancelLabel={tb('keep')}
          onClose={() => {
            setConfirmBulkDelete(false);
            setKeepHistory(false);
          }}
          onConfirm={() => void onBulkDelete()}
        />
      </PageFill>
    </CallingProvider>
  );
}

function ListSkeleton() {
  const t = useTranslations('contacts-attributes-tags.list');
  return (
    <div role="status" aria-label={t('loading')} className="divide-y divide-border">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="flex h-12 animate-pulse items-center gap-4 px-4">
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
