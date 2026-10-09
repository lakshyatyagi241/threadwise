'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useDeferredValue, useState } from 'react';
import { API_LIBRARY_METHODS, type ApiLibraryItem, type ApiLibraryMethod } from '@crm/contracts';
import { Alert, Button, EmptyState, Menu, MenuItem, MenuSeparator, Select, cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useApiList } from '../api/hooks';
import { errorKey } from '../lib/errors';
import { rowActions } from '../lib/row-actions';
import { ApiLogsDrawer } from './api-logs-drawer';
import { CurlImportModal } from './curl-import-modal';
import { DeleteApiDialog } from './delete-api-dialog';
import {
  ApiIcon,
  EditIcon,
  ImportIcon,
  LogsIcon,
  MoreIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from './icons';
import { CARD, LinkButton, PageHeader } from './page-chrome';
import { Pagination } from './pagination';
import { CopyButton, LoadError, MethodBadge, RelativeTime, SkeletonRows } from './parts';
import { useFallBackToLastPage, useUrlPaging } from './use-paging';

const TH =
  'px-4 py-2.5 text-start text-xs font-medium uppercase tracking-wide text-muted-foreground';

/** `/api-library`: the saved API calls (name, method, URL, dates), with search, a method filter, logs, edit and delete. */
export function ApiListScreen() {
  const t = useTranslations('api-library.list');
  const te = useTranslations('api-library.errors');
  const canRead = useCan('integ.apilibrary.read');
  const canCreate = useCan('integ.apilibrary.create');
  const canUpdate = useCan('integ.apilibrary.update');
  const canDelete = useCan('integ.apilibrary.delete');

  const [search, setSearch] = useState('');
  const [method, setMethod] = useState<'' | ApiLibraryMethod>('');
  const [logsOf, setLogsOf] = useState<ApiLibraryItem | null>(null);
  const [deleting, setDeleting] = useState<ApiLibraryItem | null>(null);
  const [importing, setImporting] = useState(false);

  // A request per keystroke would be wasteful; the list follows the box a moment later.
  const deferred = useDeferredValue(search.trim());
  const paging = useUrlPaging();
  const q = useApiList(
    { search: deferred === '' ? undefined : deferred, method: method === '' ? undefined : method },
    { page: paging.page, limit: paging.limit },
    canRead,
  );
  useFallBackToLastPage(paging, q.data, q.isSuccess && !q.isPlaceholderData);
  const items = q.data?.data ?? [];
  const filtered = deferred !== '' || method !== '';
  // A new search or method is a different list: start at its first page.
  const toFirstPage = () => {
    if (paging.page > 1) paging.setPage(1, { replace: true });
  };

  if (!canRead) {
    return (
      <section className="max-w-none">
        <Alert tone="warning">{t('noAccess')}</Alert>
      </section>
    );
  }

  return (
    <section className="max-w-none space-y-4">
      <PageHeader
        icon={<ApiIcon className="size-5" />}
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <>
            <LinkButton href="/api-library/logs">
              <LogsIcon />
              {t('allLogs')}
            </LinkButton>
            {canCreate && (
              <>
                <Button variant="secondary" className="h-10" onClick={() => setImporting(true)}>
                  <ImportIcon />
                  {t('import')}
                </Button>
                <LinkButton href="/api-library/new" variant="brand">
                  <PlusIcon />
                  {t('create')}
                </LinkButton>
              </>
            )}
          </>
        }
      />

      <div className={cn(CARD, 'flex flex-wrap items-center gap-3 px-4 py-3')}>
        <div className="relative min-w-52 flex-1 sm:max-w-md">
          <label htmlFor="alib-search" className="sr-only">
            {t('search')}
          </label>
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            id="alib-search"
            type="search"
            value={search}
            maxLength={200}
            placeholder={t('searchPlaceholder')}
            onChange={(e) => {
              setSearch(e.target.value);
              toFirstPage();
            }}
            className="h-10 w-full rounded-md border border-border bg-background ps-9 pe-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
        <div className="w-full sm:w-48">
          <label htmlFor="alib-method" className="sr-only">
            {t('filterMethod')}
          </label>
          <Select
            id="alib-method"
            value={method}
            onChange={(e) => {
              setMethod(e.target.value as '' | ApiLibraryMethod);
              toFirstPage();
            }}
          >
            <option value="">{t('allMethods')}</option>
            {API_LIBRARY_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </div>
        {filtered && (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch('');
              setMethod('');
              toFirstPage();
            }}
          >
            {t('clearFilters')}
          </Button>
        )}
        <p role="status" className="ms-auto text-sm text-muted-foreground" aria-live="polite">
          {q.data ? t('total', { count: q.data.total }) : ''}
        </p>
      </div>

      {q.isError ? (
        <LoadError message={te(errorKey(q.error))} onRetry={() => void q.refetch()} />
      ) : q.data && q.data.total === 0 ? (
        <EmptyState
          className="py-16"
          title={
            <span className="flex flex-col items-center gap-3">
              <span
                aria-hidden="true"
                className="flex size-14 items-center justify-center rounded-2xl bg-brand/10 text-brand dark:text-primary"
              >
                <ApiIcon className="size-7" />
              </span>
              {filtered ? t('noMatchTitle') : t('emptyTitle')}
            </span>
          }
          message={filtered ? t('noMatch') : t('empty')}
          actions={
            !filtered && canCreate ? (
              <>
                <LinkButton href="/api-library/new" variant="brand">
                  <PlusIcon />
                  {t('createApi')}
                </LinkButton>
                <Button variant="secondary" className="h-10" onClick={() => setImporting(true)}>
                  <ImportIcon />
                  {t('import')}
                </Button>
              </>
            ) : undefined
          }
        />
      ) : (
        <div className={cn(CARD, 'overflow-hidden')}>
          <div className={cn(q.isPlaceholderData && 'opacity-60 transition-opacity')}>
            <ApiTable
              rows={items}
              loading={q.isPending}
              canUpdate={canUpdate}
              canDelete={canDelete}
              onLogs={setLogsOf}
              onDelete={setDeleting}
            />
          </div>
          {q.data && (
            <Pagination
              page={paging.page}
              totalPages={q.data.totalPages}
              total={q.data.total}
              pageSize={paging.limit}
              rows={items.length}
              fetching={q.isFetching}
              onPage={(n) => paging.setPage(n)}
              onPageSize={paging.setLimit}
            />
          )}
        </div>
      )}

      <ApiLogsDrawer api={logsOf} onClose={() => setLogsOf(null)} />
      <DeleteApiDialog api={deleting} onClose={() => setDeleting(null)} />
      <CurlImportModal open={importing} onClose={() => setImporting(false)} />
    </section>
  );
}

export function ApiTable({
  rows,
  loading,
  canUpdate,
  canDelete,
  onLogs,
  onDelete,
}: {
  rows: ApiLibraryItem[];
  loading?: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onLogs: (api: ApiLibraryItem) => void;
  onDelete: (api: ApiLibraryItem) => void;
}) {
  const t = useTranslations('api-library.list');
  const router = useRouter();
  return (
    <div className="thin-scrollbar overflow-x-auto">
      <table className="w-full min-w-[56rem] table-fixed border-separate border-spacing-0 text-sm">
        <caption className="sr-only">{t('caption')}</caption>
        <colgroup>
          <col className="w-[22%]" />
          <col className="w-24" />
          <col />
          <col className="w-36" />
          <col className="w-36" />
          <col className="w-24" />
          <col className="w-16" />
        </colgroup>
        <thead className="bg-muted/40">
          <tr>
            {(['name', 'method', 'url', 'created', 'modified', 'logs'] as const).map((c) => (
              <th key={c} scope="col" className={cn(TH, 'border-b border-border')}>
                {t(`col.${c}`)}
              </th>
            ))}
            <th scope="col" className={cn(TH, 'border-b border-border text-end')}>
              <span className="sr-only">{t('col.action')}</span>
            </th>
          </tr>
        </thead>
        {loading ? (
          <SkeletonRows rows={6} cols={7} />
        ) : (
          <tbody>
            {rows.map((api) => (
              <tr key={api.id} className="group hover:bg-muted/40 focus-within:bg-muted/40">
                <td className="border-b border-border px-4 py-3">
                  <Link
                    href={`/api-library/${api.id}`}
                    className="block truncate rounded font-medium outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary"
                    title={api.name}
                  >
                    {api.name}
                  </Link>
                  {api.hasFunction && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {t('hasFunction')}
                    </span>
                  )}
                </td>
                <td className="border-b border-border px-4 py-3">
                  <MethodBadge method={api.method} />
                </td>
                <td className="border-b border-border px-4 py-3">
                  <div className="flex min-w-0 items-center gap-1">
                    <span
                      className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
                      dir="ltr"
                      title={api.url}
                    >
                      {api.url}
                    </span>
                    <CopyButton
                      iconOnly
                      text={api.url}
                      label={t('copyUrl', { name: api.name })}
                      className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
                    />
                  </div>
                </td>
                <td className="border-b border-border px-4 py-3 text-muted-foreground">
                  <RelativeTime iso={api.createdAt} />
                </td>
                <td className="border-b border-border px-4 py-3 text-muted-foreground">
                  <RelativeTime iso={api.updatedAt} />
                </td>
                <td className="border-b border-border px-4 py-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onLogs(api)}
                    aria-label={t('logsOf', { name: api.name })}
                  >
                    <LogsIcon className="size-3.5" />
                    {t('logs')}
                  </Button>
                </td>
                <td className="border-b border-border px-4 py-3 text-end">
                  <Menu
                    label={t('actionsOf', { name: api.name })}
                    placement="fixed"
                    align="end"
                    trigger={<MoreIcon />}
                    triggerClassName="size-8 px-0"
                    triggerProps={{ 'aria-label': t('actionsOf', { name: api.name }) }}
                  >
                    {rowActions({ update: canUpdate, delete: canDelete }).map((a) =>
                      a === 'delete' ? (
                        <div key={a}>
                          <MenuSeparator />
                          <MenuItem danger onSelect={() => onDelete(api)}>
                            <TrashIcon />
                            {t('delete')}
                          </MenuItem>
                        </div>
                      ) : a === 'logs' ? (
                        <MenuItem key={a} onSelect={() => onLogs(api)}>
                          <LogsIcon />
                          {t('logs')}
                        </MenuItem>
                      ) : (
                        <MenuItem key={a} onSelect={() => router.push(`/api-library/${api.id}`)}>
                          <EditIcon />
                          {a === 'edit' ? t('edit') : t('view')}
                        </MenuItem>
                      ),
                    )}
                  </Menu>
                </td>
              </tr>
            ))}
          </tbody>
        )}
      </table>
    </div>
  );
}
