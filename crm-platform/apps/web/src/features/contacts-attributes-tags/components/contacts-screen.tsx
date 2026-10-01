'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useReducer, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Input,
  Select,
  Spinner,
  StatTile,
  cn,
  useToast,
} from '@crm/ui';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { useAttributes, useStatusOptions } from '../api/attributes';
import {
  bulkDelete,
  bulkGroupMembership,
  bulkTag,
  exportContacts,
  type BulkOutcome,
} from '../api/bulk';
import {
  deleteContact,
  invalidateContacts,
  KEYS,
  PAGE_SIZES,
  useContactsList,
  useContactStats,
  type ContactFilters,
} from '../api/contacts';
import { useGroups } from '../api/groups';
import { useTags } from '../api/tags';
import type { ContactRow } from '../api/schemas';
import { displayName } from '../lib/contact-model';
import { downloadBlob } from '../lib/download';
import { errorKind } from '../lib/errors';
import { filtersToSearch, hasActiveFilter, parseFilters } from '../lib/filters';
import { stageChoices, statusChoices } from '../lib/option-sets';
import { rowView } from '../lib/row-view';
import {
  bulkTarget,
  EMPTY_SELECTION,
  headerState,
  selectionReducer,
  type BulkTarget,
} from '../lib/selection';
import { useStoredChoice } from '../lib/use-stored-choice';
import { BulkBar, type TagChoice } from './bulk-bar';
import { ContactFormModal } from './contact-form-modal';
import { ContactsGrid, ContactsTable } from './contacts-list';
import { ContactsRail } from './contacts-rail';
import { DedupeDialog } from './dedupe-dialog';
import { ErrorLine } from './error-line';
import { GroupModal } from './group-modal';
import { ImportModal } from './import-modal';
import {
  DownloadIcon,
  GridIcon,
  ListIcon,
  MergeIcon,
  PlusIcon,
  SearchIcon,
  UploadIcon,
  UsersPlusIcon,
} from './icons';

type View = 'list' | 'grid';
const VIEWS = ['list', 'grid'] as const;

const num = (n: number | undefined) => (n === undefined ? '—' : n.toLocaleString());

/** `/contacts` (WD-CON-001..008, 019). Filters live in the URL; everything else is local state over the list query. */
export function ContactsScreen() {
  const t = useTranslations('contacts-attributes-tags.list');
  const tb = useTranslations('contacts-attributes-tags.bulk');
  const tf = useTranslations('contacts-attributes-tags.form');
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

  const filters = useMemo(() => parseFilters(search), [search]);
  const setFilters = (patch: Partial<ContactFilters>) =>
    router.replace(`${pathname}${filtersToSearch({ ...filters, ...patch })}`, { scroll: false });

  // Search is applied 450 ms after typing stops (WaDesk's rhythm), without a page reload.
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

  const list = useContactsList(filters);
  const stats = useContactStats();
  const groups = useGroups();
  const tags = useTags();
  const attributes = useAttributes();
  const statusOptions = useStatusOptions();

  const rows = list.items;
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

  // layout (remembered per browser)
  const [view, chooseView] = useStoredChoice<View>('cat:contacts:view', VIEWS, 'list');

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
  };
  const target = (): BulkTarget => bulkTarget(sel, snapshot);

  // modals
  const [formFor, setFormFor] = useState<ContactRow | 'new' | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [dedupeOpen, setDedupeOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const deleteTarget = rows.find((r) => r.id === deleteId);

  const refresh = () =>
    Promise.all([
      invalidateContacts(qc),
      qc.invalidateQueries({ queryKey: KEYS.groups }),
      qc.invalidateQueries({ queryKey: KEYS.tags }),
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
    dispatch({ type: 'clear' });
    await refresh();
    const name = (groups.data ?? []).find((g) => g.id === groupId)?.name ?? '';
    report(tb(action === 'add' ? 'groupAdded' : 'groupRemoved', { count: out.changed, name }), out);
    return true;
  }

  async function onBulkTag(action: 'add' | 'remove', choice: TagChoice): Promise<boolean> {
    const out = await guarded(() => bulkTag(target(), action, choice));
    if (!out) return false;
    dispatch({ type: 'clear' });
    await refresh();
    const name = choice.tagId
      ? ((tags.data ?? []).find((x) => x.id === choice.tagId)?.name ?? '')
      : (choice.name ?? '');
    report(tb(action === 'add' ? 'tagged' : 'untagged', { count: out.changed, name }), out);
    return true;
  }

  async function onDeleteOne() {
    if (!deleteTarget) return;
    const out = await guarded(() => deleteContact(deleteTarget.id).then(() => true as const));
    setDeleteId(null);
    if (!out) return;
    await refresh();
    toast(t('deleted'), 'success');
  }

  const total = list.total;
  const filtered = hasActiveFilter(filters);
  const count = sel.allMatching ? (total ?? null) : sel.ids.size;
  const selectedAny = sel.ids.size > 0 || sel.allMatching;
  const s = stats.data;

  const handlers = {
    selected: sel.ids,
    canEdit: canUpdate,
    canDelete,
    stageLabel: (v: string) => stages.find((x) => x.value === v)?.label ?? v,
    statusLabel: (v: string) => statuses.find((x) => x.value === v)?.label ?? v,
    onToggle: (id: string) => dispatch({ type: 'toggle', id }),
    onEdit: (id: string) => {
      const row = rows.find((r) => r.id === id);
      if (row) setFormFor(row);
    },
    onDelete: (id: string) => setDeleteId(id),
    onFilterTag: (tagId: string) => setFilters({ tag: tagId }),
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <ContactsRail
        stats={s}
        groups={groups.data}
        groupsPending={groups.isPending}
        groupsError={groups.error}
        activeGroup={filters.group}
        imported={filters.imported}
        onGroup={(id) => setFilters({ group: id })}
        onImported={(on) => setFilters({ imported: on, group: on ? '' : filters.group })}
      />

      <section className="min-w-0 space-y-3">
        <div className="mb-2 flex flex-col gap-4 2xl:flex-row 2xl:items-end 2xl:justify-between">
          <div className="min-w-0">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('eyebrow', { workspace: session.org.name })}
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 2xl:shrink-0">
            {canMerge && (
              <Button
                variant="secondary"
                onClick={() => setDedupeOpen(true)}
                title={t('dedupeHint')}
              >
                <MergeIcon /> {t('dedupe')}
              </Button>
            )}
            {canExport && (
              <Button
                variant="secondary"
                onClick={() => void runExport({ kind: 'filter', filter: snapshot }, setExporting)}
                disabled={exporting}
                title={t('exportAllHint')}
              >
                {exporting ? <Spinner /> : <DownloadIcon />} {t('exportAll')}
              </Button>
            )}
            {canImport && (
              <Button variant="secondary" onClick={() => setImportOpen(true)}>
                <UploadIcon /> {t('bulkUpload')}
              </Button>
            )}
            {canCreateGroups && (
              <Button variant="secondary" onClick={() => setGroupOpen(true)}>
                <UsersPlusIcon /> {t('newGroup')}
              </Button>
            )}
            {canCreate && (
              <Button onClick={() => setFormFor('new')}>
                <PlusIcon /> {t('addContact')}
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label={t('stats.total')} value={num(s?.total)} hint={t('stats.inWorkspace')} />
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

        <div className="relative flex flex-wrap items-center gap-2 rounded-md border border-border bg-background p-2">
          <div role="tablist" aria-label={t('views')} className="flex items-center gap-1">
            <span
              role="tab"
              aria-selected="true"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
            >
              {t('tabAll')}{' '}
              <span className="text-xs tabular-nums opacity-80">{num(total ?? s?.total)}</span>
            </span>
            <Link
              role="tab"
              aria-selected="false"
              href="/contact-groups"
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
            >
              {t('tabGroups')}{' '}
              <span className="text-xs tabular-nums opacity-80">
                {num(s?.groups ?? groups.data?.length)}
              </span>
            </Link>
          </div>
          <div className="hidden flex-1 sm:block" />

          {selectedAny && (
            <BulkBar
              count={count}
              busy={busy}
              canUpdate={canUpdate}
              canDelete={canDelete}
              canExport={canExport}
              canCreateTags={canCreateTags}
              onExport={() => void runExport(target(), setBusy)}
              onDelete={() => setConfirmBulkDelete(true)}
              onGroup={onBulkGroup}
              onTag={onBulkTag}
              onClear={() => dispatch({ type: 'clear' })}
            />
          )}

          <div className="relative w-full sm:w-72">
            <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('searchPlaceholder')}
              aria-label={t('search')}
              className="h-9 ps-9"
            />
          </div>
          <Select
            aria-label={t('groupFilter')}
            className="h-9 w-auto"
            value={filters.group}
            onChange={(e) => setFilters({ group: e.target.value })}
          >
            <option value="">{t('allGroups')}</option>
            <option value="no_group">{t('noGroup')}</option>
            {(groups.data ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('tagFilter')}
            className="h-9 w-auto"
            value={filters.tag}
            onChange={(e) => setFilters({ tag: e.target.value })}
          >
            <option value="">{t('allTags')}</option>
            {(tags.data ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('stageFilter')}
            className="h-9 w-auto"
            value={filters.lifecycleStage}
            onChange={(e) => setFilters({ lifecycleStage: e.target.value })}
          >
            <option value="">{t('allStages')}</option>
            {stages.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('consentFilter')}
            className="h-9 w-auto"
            value={filters.consent}
            onChange={(e) => setFilters({ consent: e.target.value as ContactFilters['consent'] })}
          >
            <option value="">{t('allConsent')}</option>
            <option value="subscribed">{t('subscribedOnly')}</option>
            <option value="unsubscribed">{t('unsubscribedOnly')}</option>
          </Select>
          <Select
            aria-label={t('sort')}
            className="h-9 w-auto"
            value={filters.order}
            onChange={(e) => setFilters({ order: e.target.value === 'asc' ? 'asc' : 'desc' })}
          >
            <option value="desc">{t('newestFirst')}</option>
            <option value="asc">{t('oldestFirst')}</option>
          </Select>
          <Select
            aria-label={t('perPage')}
            className="h-9 w-auto"
            value={filters.limit}
            onChange={(e) =>
              setFilters({ limit: Number(e.target.value) as ContactFilters['limit'] })
            }
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {t('perPageOption', { count: n })}
              </option>
            ))}
          </Select>
          <div
            role="group"
            aria-label={t('viewToggle')}
            className="inline-flex overflow-hidden rounded-md border border-border"
          >
            {(['list', 'grid'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                title={t(v === 'list' ? 'listView' : 'gridView')}
                aria-label={t(v === 'list' ? 'listView' : 'gridView')}
                onClick={() => chooseView(v)}
                className={cn(
                  'inline-flex size-9 items-center justify-center',
                  view === v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                )}
              >
                {v === 'list' ? <ListIcon /> : <GridIcon />}
              </button>
            ))}
          </div>
        </div>

        {header === 'all' && list.hasNextPage && total !== undefined && (
          <div
            role="status"
            className="flex flex-wrap items-center justify-center gap-2 rounded-md border border-border bg-primary/5 px-3 py-2 text-sm"
          >
            {sel.allMatching ? (
              <>
                {t('banner.allSelected', { total })}
                <button
                  type="button"
                  className="font-semibold text-primary underline underline-offset-2"
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
                  className="font-semibold text-primary underline underline-offset-2"
                  onClick={() => dispatch({ type: 'selectAllMatching' })}
                >
                  {t('banner.selectAllMatching', { total })}
                </button>
              </>
            )}
          </div>
        )}

        <div className="overflow-hidden rounded-md border border-border bg-background">
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
                      <Button onClick={() => setFormFor('new')}>{t('addContact')}</Button>
                    )}
                  </>
                }
              />
            </div>
          ) : view === 'list' ? (
            <ContactsTable
              rows={views}
              headerState={header}
              onToggleAll={(checked) => dispatch({ type: 'setMany', ids: rowIds, checked })}
              {...handlers}
            />
          ) : (
            <ContactsGrid rows={views} {...handlers} />
          )}
        </div>

        {rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <span aria-live="polite">
              {total !== undefined
                ? t('showingOf', { count: rows.length, total })
                : t('showing', { count: rows.length })}
            </span>
            {list.hasNextPage && (
              <Button
                variant="secondary"
                onClick={() => void list.fetchNextPage()}
                disabled={list.isFetchingNextPage}
              >
                {list.isFetchingNextPage && <Spinner />}
                {t('loadMore')}
              </Button>
            )}
          </div>
        )}
        {list.isFetchNextPageError && (
          <ErrorLine error={list.error} onRetry={() => void list.fetchNextPage()} />
        )}

        <div className="grid gap-4 pt-2 lg:grid-cols-3">
          {(['one', 'two', 'three'] as const).map((k, i) => (
            <div key={k} className="rounded-md border border-border bg-background p-5">
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t('helpKicker', { n: i + 1 })}
              </div>
              <div className="mb-1 text-base font-semibold">{t(`help.${k}.title`)}</div>
              <p className="text-sm leading-relaxed text-muted-foreground">{t(`help.${k}.body`)}</p>
            </div>
          ))}
        </div>
      </section>

      <ContactFormModal
        open={formFor !== null}
        contact={formFor === 'new' || formFor === null ? undefined : formFor}
        onClose={() => setFormFor(null)}
      />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <GroupModal open={groupOpen} onClose={() => setGroupOpen(false)} />
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
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-4 px-4 py-3">
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
