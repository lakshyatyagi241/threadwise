'use client';

import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { FaqEntrySummary } from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Select,
  StatTile,
  Switch,
  cn,
  useToast,
} from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { refreshFaqs, useFaqList } from '../api/hooks';
import { faqApi } from '../api/service';
import { errorKey } from '../lib/errors';
import {
  EMPTY_FILTERS,
  bulkAllowed,
  flowMissing,
  hasFilters,
  indexingShares,
  pruneSelection,
  toggleAll,
  type BulkAction,
  type ListFilters,
} from '../lib/list-model';
import { EditIcon, FaqIcon, FlowIcon, PlusIcon, SearchIcon, TrashIcon, WarnIcon } from './icons';
import {
  CARD,
  LinkButton,
  LoadError,
  NoAccess,
  PageHeader,
  RelativeTime,
  SkeletonRows,
  focusAfterRemoval,
  useDebounced,
} from './parts';

const TH =
  'px-3 py-2.5 text-start text-xs font-medium uppercase tracking-wide text-muted-foreground';

/** `/faq`: every FAQ with its answer, how many of its phrasings are live, how often it answered, and bulk and row actions. */
export function FaqListScreen() {
  const t = useTranslations('faq.list');
  const te = useTranslations('faq.errors');
  const { toast } = useToast();
  const qc = useQueryClient();
  const canRead = useCan('faq.entries.read');
  const canCreate = useCan('faq.entries.create');
  const canUpdate = useCan('faq.entries.update');
  const canDelete = useCan('faq.entries.delete');

  const [filters, setFilters] = useState<ListFilters>(EMPTY_FILTERS);
  const [picked, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<
    { kind: 'bulk-delete' } | { kind: 'row-delete'; row: FaqEntrySummary } | null
  >(null);
  const search = useDebounced(filters.search);
  const list = useFaqList(filters, search, canRead);
  // A row that left the list (deleted, or filtered out) cannot stay selected.
  const selected = useMemo(() => pruneSelection(picked, list.items), [picked, list.items]);
  const stats = list.stats;
  const filtered = hasFilters(filters);
  const allowed = bulkAllowed({ update: canUpdate, delete: canDelete });
  const set = (patch: Partial<ListFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const done = (message: string) => {
    void refreshFaqs(qc);
    toast(message);
  };
  const fail = (e: unknown) => toast(te(errorKey(e)), 'danger');

  const bulk = useMutation({
    mutationFn: (action: BulkAction) => faqApi.bulk({ action, ids: [...selected] }),
    onSuccess: (r, action) => {
      setSelected(new Set());
      setConfirm(null);
      done(t(`bulk.done.${action}`, { count: r.affected }));
      if (action === 'delete') focusAfterRemoval();
    },
    onError: (e) => {
      setConfirm(null);
      fail(e);
    },
  });
  const setStatus = useMutation({
    // The list holds a preview of the answer only, so a status change goes through the bulk route, which needs no full entry.
    mutationFn: (v: { row: FaqEntrySummary; action: 'pause' | 'activate' }) =>
      faqApi.bulk({ action: v.action, ids: [v.row.id] }),
    onSuccess: (_r, v) => done(t(v.action === 'pause' ? 'paused' : 'activated')),
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (row: FaqEntrySummary) => faqApi.remove(row.id),
    onSuccess: () => {
      setConfirm(null);
      done(t('deleted'));
      focusAfterRemoval();
    },
    onError: (e) => {
      setConfirm(null);
      fail(e);
    },
  });

  if (!canRead) return <NoAccess permission="faq.entries.read" />;

  const pending = list.isPending;
  const noFaqsAtAll = !pending && stats?.total === 0 && !filtered;

  return (
    <section className="space-y-4">
      <PageHeader
        icon={<FaqIcon className="size-5" />}
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          canCreate && (
            <LinkButton href="/faq/new" variant="brand">
              <PlusIcon />
              {t('add')}
            </LinkButton>
          )
        }
      />

      {stats && (
        <div
          role="group"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
          aria-label={t('stats.label')}
        >
          <StatTile label={t('stats.total')} value={stats.total} />
          <StatTile label={t('stats.active')} value={stats.active} />
          <StatTile label={t('stats.paused')} value={stats.paused} />
          <StatTile label={t('stats.variations')} value={stats.variations} />
          <StatTile
            label={t('stats.pending')}
            value={stats.pending}
            hint={stats.pending > 0 ? t('stats.pendingHint') : undefined}
          />
          <StatTile
            label={t('stats.failed')}
            value={stats.failed}
            tone={stats.failed > 0 ? 'warning' : 'default'}
            hint={stats.failed > 0 ? t('stats.failedHint') : undefined}
          />
        </div>
      )}

      {stats && stats.failed > 0 && (
        <Alert tone="warning" className="flex flex-wrap items-center justify-between gap-3">
          <span>{t('failedBanner', { count: stats.failed })}</span>
          <Button size="sm" variant="secondary" onClick={() => set({ indexing: 'failed' })}>
            {t('showFailed')}
          </Button>
        </Alert>
      )}

      {!noFaqsAtAll && (
        <div className={cn(CARD, 'flex flex-wrap items-end gap-3 px-4 py-3')}>
          <div className="relative min-w-52 flex-1 sm:max-w-md">
            <label htmlFor="faq-search" className="sr-only">
              {t('search')}
            </label>
            <SearchIcon className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              id="faq-search"
              type="search"
              value={filters.search}
              maxLength={200}
              placeholder={t('searchPlaceholder')}
              onChange={(e) => set({ search: e.target.value })}
              className="h-10 w-full rounded-md border border-border bg-background ps-9 pe-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
          <FilterSelect
            id="faq-status"
            label={t('filter.status')}
            value={filters.status}
            onChange={(v) => set({ status: v as ListFilters['status'] })}
            options={[
              ['', t('filter.anyStatus')],
              ['active', t('status.active')],
              ['paused', t('status.paused')],
            ]}
          />
          <FilterSelect
            id="faq-category"
            label={t('filter.category')}
            value={filters.category}
            onChange={(v) => set({ category: v })}
            options={[
              ['', t('filter.anyCategory')],
              ...(stats?.categories ?? []).map((c): [string, string] => [c, c]),
            ]}
          />
          <FilterSelect
            id="faq-indexing"
            label={t('filter.indexing')}
            value={filters.indexing}
            onChange={(v) => set({ indexing: v as ListFilters['indexing'] })}
            options={[
              ['', t('filter.anyIndexing')],
              ['pending', t('filter.pending')],
              ['failed', t('filter.failed')],
            ]}
          />
          {filtered && (
            <Button variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>
              {t('clearFilters')}
            </Button>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div
          role="region"
          aria-label={t('bulk.label')}
          className={cn(CARD, 'flex flex-wrap items-center gap-3 border-primary/40 px-4 py-2.5')}
        >
          <span className="text-sm font-medium" aria-live="polite">
            {t('bulk.selected', { count: selected.size })}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={!allowed.pause || bulk.isPending}
            onClick={() => bulk.mutate('pause')}
          >
            {t('bulk.pause')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!allowed.activate || bulk.isPending}
            onClick={() => bulk.mutate('activate')}
          >
            {t('bulk.activate')}
          </Button>
          {allowed.delete && (
            <Button
              size="sm"
              variant="danger"
              disabled={bulk.isPending}
              onClick={() => setConfirm({ kind: 'bulk-delete' })}
            >
              <TrashIcon />
              {t('bulk.delete')}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            {t('bulk.clear')}
          </Button>
        </div>
      )}

      {list.isError ? (
        <LoadError
          errorKey={errorKey(list.error)}
          error={list.error}
          onRetry={() => void list.refetch()}
        />
      ) : noFaqsAtAll ? (
        <EmptyState
          className="py-14"
          title={
            <span className="flex flex-col items-center gap-3">
              <span
                aria-hidden="true"
                className="flex size-14 items-center justify-center rounded-2xl bg-brand/10 text-brand dark:text-primary"
              >
                <FaqIcon className="size-7" />
              </span>
              {t('empty.title')}
            </span>
          }
          message={
            <span className="block space-y-2">
              <span className="block">{t('empty.body')}</span>
              <span className="block">{t('empty.how')}</span>
            </span>
          }
          actions={
            canCreate ? (
              <LinkButton href="/faq/new" variant="brand">
                <PlusIcon />
                {t('empty.cta')}
              </LinkButton>
            ) : (
              <span className="text-sm text-muted-foreground">{t('empty.noRight')}</span>
            )
          }
        />
      ) : !pending && list.items.length === 0 ? (
        <EmptyState
          title={t('noMatch.title')}
          message={t('noMatch.body')}
          actions={
            <Button variant="secondary" onClick={() => setFilters(EMPTY_FILTERS)}>
              {t('clearFilters')}
            </Button>
          }
        />
      ) : (
        <div className={cn(CARD, 'overflow-hidden')}>
          {pending ? (
            <SkeletonRows rows={6} />
          ) : (
            <div
              className={cn(
                'overflow-x-auto',
                list.isPlaceholderData && 'opacity-60 transition-opacity',
              )}
            >
              <table className="w-full min-w-[56rem] text-sm">
                <caption className="sr-only">{t('title')}</caption>
                <thead className="border-b border-border bg-muted/40">
                  <tr>
                    <th scope="col" className="w-10 ps-4">
                      <input
                        type="checkbox"
                        aria-label={t('selectAll')}
                        className="size-4 accent-[var(--primary)]"
                        checked={
                          list.items.length > 0 && list.items.every((r) => selected.has(r.id))
                        }
                        disabled={!canUpdate}
                        onChange={() => setSelected(toggleAll(selected, list.items))}
                      />
                    </th>
                    <th scope="col" className={TH}>
                      {t('col.question')}
                    </th>
                    <th scope="col" className={TH}>
                      {t('col.answer')}
                    </th>
                    <th scope="col" className={TH}>
                      {t('col.indexing')}
                    </th>
                    <th scope="col" className={TH}>
                      {t('col.answered')}
                    </th>
                    <th scope="col" className={TH}>
                      {t('col.status')}
                    </th>
                    <th scope="col" className={cn(TH, 'text-end')}>
                      {t('col.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {list.items.map((row) => (
                    <FaqRow
                      key={row.id}
                      row={row}
                      selected={selected.has(row.id)}
                      onSelect={(on) =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (on) n.add(row.id);
                          else n.delete(row.id);
                          return n;
                        })
                      }
                      canUpdate={canUpdate}
                      canDelete={canDelete}
                      busy={setStatus.isPending && setStatus.variables?.row.id === row.id}
                      onToggle={() =>
                        setStatus.mutate({
                          row,
                          action: row.status === 'active' ? 'pause' : 'activate',
                        })
                      }
                      onDelete={() => setConfirm({ kind: 'row-delete', row })}
                      onShowFailed={() => set({ indexing: 'failed' })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {list.hasNextPage && (
            <div className="border-t border-border p-3 text-center">
              <Button
                variant="secondary"
                onClick={() => void list.fetchNextPage()}
                disabled={list.isFetchingNextPage}
              >
                {list.isFetchingNextPage ? t('loadingMore') : t('loadMore')}
              </Button>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        tone="danger"
        busy={bulk.isPending || remove.isPending}
        title={
          confirm?.kind === 'row-delete'
            ? t('confirm.rowTitle')
            : t('confirm.bulkTitle', { count: selected.size })
        }
        message={
          confirm?.kind === 'row-delete'
            ? t('confirm.rowBody', { question: confirm.row.question })
            : t('confirm.bulkBody', { count: selected.size })
        }
        confirmLabel={t('confirm.delete')}
        cancelLabel={t('confirm.cancel')}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === 'row-delete') remove.mutate(confirm.row);
          else bulk.mutate('delete');
        }}
      />
    </section>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <div className="w-full sm:w-44">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function FaqRow({
  row,
  selected,
  onSelect,
  canUpdate,
  canDelete,
  busy,
  onToggle,
  onDelete,
  onShowFailed,
}: {
  row: FaqEntrySummary;
  selected: boolean;
  onSelect: (on: boolean) => void;
  canUpdate: boolean;
  canDelete: boolean;
  busy?: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onShowFailed: () => void;
}) {
  const t = useTranslations('faq.list');
  const missing = flowMissing(row);
  return (
    <tr className={cn('align-top', selected && 'bg-primary/5')}>
      <td className="ps-4 pt-3.5">
        <input
          type="checkbox"
          aria-label={t('selectRow', { question: row.question })}
          className="size-4 accent-[var(--primary)]"
          checked={selected}
          disabled={!canUpdate}
          onChange={(e) => onSelect(e.target.checked)}
        />
      </td>
      <td className="max-w-xs px-3 py-3">
        <Link
          href={`/faq/${row.id}`}
          className="font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
        >
          {row.question}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {row.category && <Badge>{row.category}</Badge>}
          <span className="text-xs text-muted-foreground">
            {t('variationCount', { count: row.variationCount })}
          </span>
        </div>
      </td>
      <td className="max-w-xs px-3 py-3">
        {row.answerType === 'text' ? (
          <p className="line-clamp-2 text-muted-foreground">{row.answerPreview}</p>
        ) : missing ? (
          <Badge tone="danger" className="gap-1">
            <WarnIcon className="size-3" />
            {t('flowMissing')}
          </Badge>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <FlowIcon className="text-muted-foreground" />
            <span className="line-clamp-2">{row.flowName}</span>
          </span>
        )}
      </td>
      <td className="px-3 py-3">
        <IndexingBar row={row} onShowFailed={onShowFailed} />
      </td>
      <td className="whitespace-nowrap px-3 py-3">
        <div className="font-medium tabular-nums">{row.hitCount}</div>
        <div className="text-xs text-muted-foreground">
          {row.lastHitAt ? <RelativeTime iso={row.lastHitAt} /> : t('neverAnswered')}
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <Switch
            checked={row.status === 'active'}
            disabled={!canUpdate || busy}
            label={t('toggleLabel', { question: row.question })}
            onCheckedChange={onToggle}
          />
          <span className="text-xs text-muted-foreground">{t(`status.${row.status}`)}</span>
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center justify-end gap-1">
          <Link
            href={`/faq/${row.id}`}
            aria-label={t('edit', { question: row.question })}
            title={t('editShort')}
            className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            <EditIcon />
          </Link>
          {canDelete && (
            <button
              type="button"
              onClick={onDelete}
              aria-label={t('delete', { question: row.question })}
              title={t('deleteShort')}
              className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-danger/10 hover:text-danger focus-visible:ring-2 focus-visible:ring-primary"
            >
              <TrashIcon />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

/** Ready / pending / failed as a thin segmented bar with the numbers in words; a failed count opens the failed filter. */
export function IndexingBar({
  row,
  onShowFailed,
}: {
  row: Pick<FaqEntrySummary, 'readyCount' | 'pendingCount' | 'failedCount'>;
  onShowFailed?: () => void;
}) {
  const t = useTranslations('faq.list.indexing');
  const s = indexingShares(row);
  return (
    <div className="w-36 space-y-1.5">
      <div
        role="img"
        aria-label={t('summary', {
          ready: row.readyCount,
          pending: row.pendingCount,
          failed: row.failedCount,
        })}
        className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
      >
        <span className="bg-success" style={{ width: `${s.ready}%` }} />
        <span className="bg-warning/60" style={{ width: `${s.pending}%` }} />
        <span className="bg-danger" style={{ width: `${s.failed}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {t('ready', { count: row.readyCount })}
        {row.pendingCount > 0 && <> · {t('pending', { count: row.pendingCount })}</>}
        {row.failedCount > 0 && (
          <>
            {' · '}
            <button
              type="button"
              onClick={onShowFailed}
              className="font-medium text-danger underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('failed', { count: row.failedCount })}
            </button>
          </>
        )}
      </p>
    </div>
  );
}
