'use client';

import Link from 'next/link';
import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { WIZARD_CONTACTS_MAX, type SegmentGroup, type WizardAudience } from '@crm/contracts';
import { Alert, Button, Input, Select, cn } from '@crm/ui';
import { PER_PAGE_CHOICES, useWizardContacts } from '../api/wizard';
import {
  clearContacts,
  contactSelected,
  coversView,
  pageAllSelected,
  selectAllMatching,
  setContacts,
  type TableView,
} from '../lib/contacts-selection';
import { pageCount, pageWindow } from '../lib/paging';
import { FilterDrawer, activeFilters } from './filter-drawer';
import { Chip, ErrorBlock } from './parts';
import { useSettled } from './use-settled';

const nf = (n: number) => n.toLocaleString();

function FilterIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 5h18l-7 8v6l-4 2v-8L3 5z" />
    </svg>
  );
}

/**
 * "Broadcast to contacts": the workspace's contacts as a table to tick rows in. Search, conditions, page and page size are asked of
 * the SERVER (the same rule engine the segments use); the footer shows the total. Ticked rows are the audience; "select all N
 * matching" freezes the search and conditions as the selection (see lib/contacts-selection.ts).
 */
export function ContactsTable({
  audience,
  onAudience,
  onTotal,
  disabled,
}: {
  audience: WizardAudience;
  onAudience: (patch: Partial<WizardAudience>) => void;
  /** The size of "all matching" when the person chose it (the summary shows it while the page is open). */
  onTotal?: (total: number | null) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('campaigns.wizard.audience');
  const uid = useId();
  const rules = (audience.rules as SegmentGroup | null) ?? null;
  const [input, setInput] = useState('');
  const typed = useSettled(input, 350);
  const search = typed.value.trim();
  const [perPage, setPerPage] = useState<number>(PER_PAGE_CHOICES[0]);
  // A new search, filter or page size starts again from the first page: the page number belongs to the view it was chosen in.
  const viewKey = JSON.stringify([search, audience.rules, perPage]);
  const [pageState, setPageState] = useState({ key: viewKey, page: 1 });
  const page = pageState.key === viewKey ? pageState.page : 1;
  const setPage = (next: number) => setPageState({ key: viewKey, page: next });
  const [filterOpen, setFilterOpen] = useState(false);
  const [limited, setLimited] = useState(false);

  const view: TableView = useMemo(() => ({ search, rules }), [search, rules]);
  const q = useWizardContacts({ search, rules, page, perPage });
  const data = q.data;
  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const pages = pageCount(total, perPage);
  const sendable = rows.filter((r) => r.sendable).map((r) => r.id);
  const covers = coversView(audience, view);
  const allOnPage = pageAllSelected(audience, sendable, view);
  const filters = activeFilters(rules);
  const ticked = audience.contactIds.length;

  useEffect(() => {
    if (covers && data && !q.isPlaceholderData) onTotal?.(data.total);
  }, [covers, data, q.isPlaceholderData, onTotal]);

  const apply = (patch: Partial<WizardAudience>) => {
    setLimited(false);
    onAudience(patch);
  };
  const togglePage = (select: boolean) => {
    const out = setContacts(audience, sendable, select, view);
    setLimited(out.limited);
    onAudience(out.patch);
  };
  const toggleOne = (id: string, select: boolean) => {
    const out = setContacts(audience, [id], select, view);
    setLimited(out.limited);
    onAudience(out.patch);
  };

  const stale = audience.allMatching !== null && !covers;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="contacts-table">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
        <Input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label={t('contactsSearch')}
          placeholder={t('contactsSearchPlaceholder')}
          className="h-9 w-full max-w-xs"
          disabled={disabled}
        />
        <button
          type="button"
          onClick={() => setFilterOpen(true)}
          aria-label={t('filterOpen')}
          aria-haspopup="dialog"
          title={t('filterOpen')}
          className={cn(
            'relative inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            filters > 0 && 'border-brand text-brand',
          )}
        >
          <FilterIcon className="size-4" />
          <span className="hidden sm:inline">{t('filterButton')}</span>
          {filters > 0 && (
            <span
              data-testid="filter-badge"
              aria-label={t('filterActive', { count: filters })}
              className="inline-flex min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-semibold text-brand-foreground"
            >
              {filters}
            </span>
          )}
        </button>
        <div className="ms-auto flex items-center gap-2 text-sm">
          {(ticked > 0 || audience.allMatching) && (
            <>
              <span aria-live="polite" className="text-muted-foreground">
                {audience.allMatching && !stale
                  ? t('selectedAll')
                  : t('selectedCount', { count: ticked })}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => apply(clearContacts())}
                disabled={disabled}
              >
                {t('clearSelection')}
              </Button>
            </>
          )}
        </div>
      </div>

      {sendable.length > 0 && allOnPage && !covers && total > rows.length && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-brand/5 px-3 py-2 text-sm">
          <span>{t('pageSelected', { count: sendable.length })}</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => apply(selectAllMatching(view))}
            disabled={disabled}
          >
            {t('selectAllMatching', { count: total })}
          </Button>
        </div>
      )}
      {covers && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-brand/5 px-3 py-2 text-sm">
          <span>{t('allSelected', { count: total })}</span>
          <Button size="sm" variant="secondary" onClick={() => apply(clearContacts())}>
            {t('clearSelection')}
          </Button>
        </div>
      )}
      {stale && (
        <div className="border-b border-border bg-warning/10 px-3 py-2 text-sm">
          {t('staleSelection')}
        </div>
      )}
      {limited && (
        <Alert tone="warning" className="m-3">
          {t('contactsLimit', { max: nf(WIZARD_CONTACTS_MAX) })}
        </Alert>
      )}

      <div className="min-h-0 flex-1 overflow-auto" aria-busy={q.isFetching}>
        {q.isError && !data ? (
          <ErrorBlock className="m-3" error={q.error} onRetry={() => void q.refetch()} />
        ) : q.isPending ? (
          <div
            role="status"
            aria-label={t('contactsLoading')}
            className="animate-pulse space-y-2 p-3"
          >
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="h-8 rounded bg-muted" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {search || filters > 0 ? (
              t('contactsNoMatch')
            ) : (
              <>
                <p>{t('contactsNone')}</p>
                <Link href="/contacts" className="mt-2 inline-block text-brand underline">
                  {t('contactsAdd')}
                </Link>
              </>
            )}
          </div>
        ) : (
          <table className={cn('w-full text-sm', q.isFetching && 'opacity-70 transition-opacity')}>
            <caption className="sr-only">{t('contactsCaption')}</caption>
            <thead className="sticky top-0 z-10 bg-muted text-start text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="w-10 px-3 py-2 text-start">
                  <input
                    type="checkbox"
                    aria-label={t('selectPage')}
                    checked={allOnPage}
                    disabled={disabled || sendable.length === 0}
                    onChange={(e) => togglePage(e.target.checked)}
                    className="size-4 accent-[var(--primary)]"
                  />
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('colFirstName')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('colLastName')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('colEmail')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('colMobile')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const on = contactSelected(audience, r.id, view);
                const label =
                  r.name || [r.firstName, r.lastName].filter(Boolean).join(' ') || r.phone || r.id;
                return (
                  <tr
                    key={r.id}
                    className={cn(on && 'bg-brand/5', !r.sendable && 'text-muted-foreground')}
                  >
                    <td className="px-3 py-1.5">
                      <input
                        id={`${uid}-${r.id}`}
                        type="checkbox"
                        aria-label={t('selectRow', { name: label })}
                        checked={on}
                        disabled={disabled || !r.sendable}
                        onChange={(e) => toggleOne(r.id, e.target.checked)}
                        className="size-4 accent-[var(--primary)]"
                      />
                    </td>
                    <td className="max-w-[12rem] truncate px-3 py-1.5">
                      {r.firstName ?? r.name ?? <span aria-hidden="true">-</span>}
                    </td>
                    <td className="max-w-[12rem] truncate px-3 py-1.5">
                      {r.lastName ?? <span aria-hidden="true">-</span>}
                    </td>
                    <td className="max-w-[16rem] truncate px-3 py-1.5">
                      {r.email ?? <span aria-hidden="true">-</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      <span dir="ltr">{r.phone ?? '-'}</span>
                      {!r.sendable && (
                        <Chip tone="warning" className="ms-2">
                          {r.optedOut ? t('rowOptedOut') : t('rowNoNumber')}
                        </Chip>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2 text-sm">
        <span data-testid="contacts-total" className="font-medium">
          {data
            ? data.approximate
              ? t('totalAbout', { count: total })
              : t('totalContacts', { count: total })
            : ' '}
        </span>
        <nav aria-label={t('pagination')} className="flex items-center gap-1">
          <Button
            size="sm"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage(Math.max(1, page - 1))}
            aria-label={t('prevPage')}
          >
            {'<'}
          </Button>
          {pageWindow(page, pages).map((p, i) =>
            p === null ? (
              <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-muted-foreground">
                ...
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => setPage(p)}
                aria-label={t('goToPage', { page: p })}
                aria-current={p === page ? 'page' : undefined}
                className={cn(
                  'h-8 min-w-8 rounded-md px-2 text-sm tabular-nums hover:bg-muted',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  p === page && 'bg-brand font-semibold text-brand-foreground hover:bg-brand',
                )}
              >
                {p}
              </button>
            ),
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= pages}
            onClick={() => setPage(Math.min(pages, page + 1))}
            aria-label={t('nextPage')}
          >
            {'>'}
          </Button>
        </nav>
        <label className="flex items-center gap-2 text-muted-foreground">
          <span>{t('perPage')}</span>
          <Select
            value={String(perPage)}
            onChange={(e) => setPerPage(Number(e.target.value))}
            aria-label={t('perPage')}
            className="h-8 w-20"
          >
            {PER_PAGE_CHOICES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <FilterDrawer
        open={filterOpen}
        rules={rules}
        search={search}
        onApply={(next) => onAudience({ rules: next })}
        onClose={() => setFilterOpen(false)}
      />
    </div>
  );
}
