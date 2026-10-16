'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, ConfirmDialog, EmptyState, Spinner, StatTile, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { downloadBlob } from '@/features/contacts-attributes-tags/lib/download';
import { useStoredValue } from '@/lib/use-stored-value';
import {
  companiesApi,
  invalidateCompanies,
  useCompaniesList,
  useCompanyStats,
  useIndustries,
  useMembers,
} from '../api/companies';
import { useCompanyProperties } from '../api/properties';
import type { CompanyResponse } from '../api/schemas';
import {
  STORAGE_KEY as COLUMNS_KEY,
  allColumns,
  exportColumnIds,
  parseStoredColumns,
  serializeColumns,
  visibleColumns,
} from '../lib/columns';
import { errorKind } from '../lib/errors';
import {
  filtersToSearch,
  hasActiveFilter,
  listQuery,
  parseFilters,
  statsQuery,
  type CompanyFilters,
} from '../lib/filters';
import { formatTotals } from '../lib/money';
import { filterableFields, isSortableKind } from '../lib/property-filters';
import { isShownProperty } from '../lib/properties';
import { headerState, retain, setAll, toggle } from '../lib/selection';
import { useDebounced } from '../lib/use-debounced';
import { ColumnsMenu } from './columns-menu';
import { CompaniesTable } from './companies-table';
import { CompaniesToolbar } from './companies-toolbar';
import { CompanyFormModal } from './company-form-modal';
import { ErrorLine } from './error-line';
import { DownloadIcon, PlusIcon, UploadIcon } from './icons';
import { ImportModal } from './import-modal';
import { PropertyFilters } from './property-filters';

/**
 * `/companies` (TW-CTP-002): Reference's Companies page. The header with "New company", the three tiles (companies, with open deals,
 * won revenue), the search box and the list; here the tiles follow the filters, the list pages by cursor instead of stopping at 500
 * rows, and a row can be ticked for a bulk delete.
 */
export function CompaniesScreen() {
  const t = useTranslations('companies.list');
  const tToast = useTranslations('companies.toast');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canCreate = useCan('record.companies.create');
  const canDelete = useCan('record.companies.delete');
  const canExport = useCan('record.companies.export');
  const canImport = useCan('record.companies.import') && canCreate;

  const filters = useMemo(() => parseFilters(search), [search]);
  // The box keeps what is typed; the address (and so the requests) follow after a pause. It starts from the address and is not
  // overwritten by it, or a letter typed during the pause would be lost.
  const [q, setQ] = useState(filters.q);
  const debouncedQ = useDebounced(q);
  const apply = useCallback(
    (patch: Partial<CompanyFilters>) =>
      router.replace(`${pathname}${filtersToSearch({ ...filters, ...patch })}`, { scroll: false }),
    [router, pathname, filters],
  );
  useEffect(() => {
    if (debouncedQ.trim() !== filters.q.trim()) apply({ q: debouncedQ });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a pause in typing moves the address
  }, [debouncedQ]);

  const list = useCompaniesList(listQuery(filters));
  const stats = useCompanyStats(statsQuery(filters));
  const members = useMembers();
  const industries = useIndustries();
  const rows = list.items;
  const ids = useMemo(() => rows.map((r) => r.id), [rows]);

  // Company properties (BL-196): columns, conditions and orders. Nothing is offered to someone who cannot read the definitions.
  const properties = useCompanyProperties();
  const filterable = useMemo(() => filterableFields(properties.fields), [properties.fields]);
  const sortProperties = useMemo(
    () =>
      filterable
        .filter((f) => isSortableKind(f.kind))
        .map((f) => ({ key: f.id, label: 'text' in f.label ? f.label.text : f.id })),
    [filterable],
  );
  const propertyColumns = useMemo(
    () =>
      properties.fields
        .filter(isShownProperty)
        .filter((f) => f.fieldType !== 'formula')
        .map((f) => ({ key: f.key, label: f.label })),
    [properties.fields],
  );
  const [storedColumns, setStoredColumns] = useStoredValue(COLUMNS_KEY);
  const columns = useMemo(
    () => visibleColumns(parseStoredColumns(storedColumns), propertyColumns),
    [storedColumns, propertyColumns],
  );
  const [importing, setImporting] = useState(false);
  const exportCsv = useMutation({
    mutationFn: () => companiesApi.exportCsv(listQuery(filters), exportColumnIds(columns)),
    onSuccess: (blob) => downloadBlob('companies-export.csv', blob),
    onError: () => toast(tToast('exportFailed'), 'danger'),
  });

  // Ticks of rows that are gone (deleted, or filtered out) are dropped when read, so a bulk action never names a row nobody sees.
  const [ticked, setSelected] = useState<ReadonlySet<string>>(new Set());
  const selected = useMemo(() => retain(ticked, ids), [ticked, ids]);

  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CompanyResponse | 'selected' | null>(null);

  const remove = useMutation({
    mutationFn: async (target: CompanyResponse | 'selected') => {
      if (target === 'selected') return companiesApi.bulkDelete([...selected]);
      await companiesApi.remove(target.id);
      return { changed: 1, failed: 0 };
    },
    onSuccess: async (outcome) => {
      setDeleting(null);
      setSelected(new Set());
      await invalidateCompanies(qc);
      toast(
        outcome.failed > 0
          ? tToast('deletedSome', { count: outcome.changed, failed: outcome.failed })
          : tToast('deleted', { count: outcome.changed }),
        outcome.failed > 0 ? 'info' : 'success',
      );
    },
    onError: () => {
      setDeleting(null);
      toast(tToast('deleteFailed'), 'danger');
    },
  });

  const filtered = hasActiveFilter({ ...filters, q });
  const won = stats.data?.wonValue ? formatTotals(stats.data.wonValue, locale) : null;
  const dash = '—';
  const fmt = (n: number | null | undefined) =>
    n === null || n === undefined ? dash : new Intl.NumberFormat(locale).format(n);

  return (
    <section>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('eyebrow')}
          </div>
          <h1 className="text-2xl font-semibold leading-tight">{t('title')}</h1>
          <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start">
          {canExport && (
            <Button
              variant="secondary"
              disabled={exportCsv.isPending}
              onClick={() => exportCsv.mutate()}
            >
              {exportCsv.isPending ? <Spinner /> : <DownloadIcon />} {t('export')}
            </Button>
          )}
          {canImport && (
            <Button variant="secondary" onClick={() => setImporting(true)}>
              <UploadIcon /> {t('import')}
            </Button>
          )}
          {canCreate && (
            <Button variant="brand" onClick={() => setCreating(true)}>
              <PlusIcon /> {t('newCompany')}
            </Button>
          )}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3 sm:gap-4">
        <StatTile label={t('tiles.companies')} value={fmt(stats.data?.total)} />
        <StatTile label={t('tiles.withDeals')} value={fmt(stats.data?.withOpenDeals)} />
        <StatTile
          label={t('tiles.wonRevenue')}
          value={
            won === null ? (
              dash
            ) : won.length === 0 ? (
              <span className="text-muted-foreground">{dash}</span>
            ) : (
              <span className="block space-y-0.5 text-xl leading-tight">
                {won.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </span>
            )
          }
        />
      </div>

      <div className="mb-4">
        <CompaniesToolbar
          filters={filters}
          q={q}
          onQ={setQ}
          onChange={(patch) => {
            if ('q' in patch) setQ(patch.q ?? '');
            apply(patch);
          }}
          members={members.data ?? []}
          industries={industries.data ?? []}
          sortProperties={sortProperties}
          extra={
            <>
              {filterable.length > 0 && (
                <PropertyFilters
                  fields={filterable}
                  value={filters.props}
                  onApply={(props) => apply({ props })}
                />
              )}
              <ColumnsMenu
                allColumns={allColumns(propertyColumns)}
                current={columns.map((c) => c.id)}
                onChange={(ids) => setStoredColumns(serializeColumns(ids))}
                onReset={() => setStoredColumns(null)}
              />
            </>
          }
          onRefresh={() => void invalidateCompanies(qc)}
          refreshing={list.isFetching && !list.isPending}
        />
      </div>

      {canDelete && selected.size > 0 && (
        <div
          role="region"
          aria-label={t('bulk.label')}
          className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-brand/30 bg-brand/5 px-3 py-2 text-sm"
        >
          <span className="font-medium" aria-live="polite">
            {t('bulk.selected', { count: selected.size })}
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="border-danger text-danger hover:bg-danger/10"
            disabled={remove.isPending}
            onClick={() => setDeleting('selected')}
          >
            {t('bulk.delete')}
          </Button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ms-auto text-brand underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-primary"
          >
            {t('bulk.clear')}
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-border bg-background">
        {list.isPending ? (
          <div role="status" className="flex items-center gap-2 px-4 py-10 text-muted-foreground">
            <Spinner /> {t('loading')}
          </div>
        ) : list.isError ? (
          <div className="p-4">
            {errorKind(list.error, 'list') === 'unavailable' ? (
              <EmptyState title={t('unavailableTitle')} message={t('unavailable')} />
            ) : (
              <ErrorLine error={list.error} context="list" onRetry={() => void list.refetch()} />
            )}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4">
            {filtered ? (
              <EmptyState
                title={t('emptyFilteredTitle')}
                message={t('emptyFiltered')}
                actions={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQ('');
                      apply({ q: '', owner: '', industry: '', openDeals: false, props: [] });
                    }}
                  >
                    {t('clearFilters')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title={t('emptyTitle')}
                message={t('empty')}
                actions={
                  canCreate && (
                    <Button variant="brand" onClick={() => setCreating(true)}>
                      <PlusIcon /> {t('newCompany')}
                    </Button>
                  )
                }
              />
            )}
          </div>
        ) : (
          <CompaniesTable
            rows={rows}
            columns={columns}
            fields={properties.fields}
            selected={selected}
            headerState={headerState(ids, selected)}
            canDelete={canDelete}
            onToggle={(id) => setSelected((s) => toggle(s, id))}
            onToggleAll={(on) => setSelected((s) => setAll(ids, s, on))}
            onDelete={(c) => setDeleting(c)}
            onOpen={(id) => router.push(`/companies/${id}`)}
          />
        )}
      </div>

      {rows.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span>{t('showing', { count: rows.length })}</span>
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
            <span>{t('allLoaded')}</span>
          )}
        </div>
      )}

      {importing && <ImportModal onClose={() => setImporting(false)} />}
      {creating && (
        <CompanyFormModal
          onClose={() => setCreating(false)}
          // Reference opens the new company's page after creating it.
          onSaved={(c) => router.push(`/companies/${c.id}`)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        busy={remove.isPending}
        title={deleting === 'selected' ? t('deleteManyTitle') : t('deleteTitle')}
        message={
          deleting === 'selected'
            ? t('deleteManyMessage', { count: selected.size })
            : t('deleteMessage')
        }
        confirmLabel={t('delete')}
        cancelLabel={t('keep')}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </section>
  );
}
