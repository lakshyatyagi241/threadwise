'use client';

import Link from 'next/link';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { LeadInboxItem, RetryLeadInboxResponse } from '@crm/contracts';
import { Alert, Badge, Button, Checkbox, EmptyState, Field, Input, Select, Spinner } from '@crm/ui';
import { fetchSources, leadKeys } from '../api';
import { fetchInbox, fetchInboxSummary, opsKeys, retryInboxMany } from '../api-ops';
import { leadError } from '../lib/errors';
import { isKnownReason } from '../lib/event-view';
import {
  ALL_INBOX_FILTERS,
  DEFAULT_INBOX_FILTERS,
  INBOX_CHIPS,
  RANGE_CHOICES,
  REASON_CHOICES,
  TEST_CHOICES,
  chipCount,
  filterKey,
  inboxQuery,
  isDefaultFilters,
  prune,
  rangeProblem,
  retrySummary,
  selectableIds,
  summaryQuery,
  toggleId,
  withinLimit,
  MAX_BULK,
  type InboxChip,
  type InboxFilters,
  type RetrySummary,
} from '../lib/inbox-view';
import type { LeadsCan } from '../lib/permissions';
import { sourceHref } from '../lib/source-view';
import { FirstReply } from './first-reply';
import { InboxDrawer } from './inbox-drawer';
import { PullPanel } from './pull-panel';
import { ErrorText, EventStatusChip, Loading, RegionError, When } from './ui';

/**
 * The lead inbox (BL-014, spec L-17): every source's deliveries in one list, newest received first. It opens on the leads that wait
 * (needs review or failed) with test leads hidden. Filters are server side; the counts above the list are the same window without the
 * status. A lead that can be retried has a checkbox and a Retry; an opened lead shows its payload with the personal data masked. The
 * pull panel (Sync now, Backfill) is under the list, only for sources that can be pulled.
 */
export function LeadInboxTab({ can }: { can: LeadsCan }) {
  const t = useTranslations('lead-sources.inbox');
  const tr = useTranslations('lead-sources.reasons');
  const qc = useQueryClient();
  const [filters, setFilters] = useState<InboxFilters>(DEFAULT_INBOX_FILTERS);
  const [draftText, setDraftText] = useState('');
  const [picked, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState<LeadInboxItem | null>(null);
  const [summary, setSummary] = useState<RetrySummary | null>(null);

  const key = filterKey(filters);
  const problem = rangeProblem(filters);
  const query = useMemo(() => inboxQuery(filters, new Date()), [filters]);
  const countsQuery = useMemo(() => summaryQuery(filters, new Date()), [filters]);

  const sources = useQuery({
    queryKey: leadKeys.list,
    queryFn: ({ signal }) => fetchSources(signal),
    retry: false,
  });
  const counts = useQuery({
    queryKey: opsKeys.summary(key),
    queryFn: ({ signal }) => fetchInboxSummary(countsQuery, signal),
    enabled: problem === null,
    retry: false,
  });
  const list = useInfiniteQuery({
    queryKey: opsKeys.list(key),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => fetchInbox(query, pageParam, signal),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    enabled: problem === null,
    retry: false,
  });
  const items = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.data), [list.data]);

  // What is selected never outlives what is shown.
  const selected = useMemo(() => prune(picked, items), [picked, items]);

  const retry = useMutation({
    mutationFn: (ids: string[]) => retryInboxMany(ids),
    onSuccess: (res: RetryLeadInboxResponse) => {
      setSummary(retrySummary(res));
      setSelected([]);
      void qc.invalidateQueries({ queryKey: opsKeys.all });
      void qc.invalidateQueries({ queryKey: leadKeys.list });
    },
  });

  const apply = (patch: Partial<InboxFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setSelected([]);
    setSummary(null);
  };
  const searching = filters.q !== draftText.trim();
  const canSelect = can.manage;
  const ids = selectableIds(items);
  const allSelected = ids.length > 0 && ids.every((id) => selected.includes(id));

  return (
    <div className="space-y-5" data-testid="lead-inbox">
      <p className="max-w-3xl text-sm text-muted-foreground">{t('intro')}</p>

      <div className="flex flex-wrap gap-2" role="group" aria-label={t('chipsLabel')}>
        {INBOX_CHIPS.map((chip: InboxChip) => (
          <button
            key={chip}
            type="button"
            aria-pressed={filters.status === chip}
            data-testid={`chip-${chip}`}
            onClick={() => apply({ status: chip })}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition focus-visible:ring-2 focus-visible:ring-primary ${
              filters.status === chip
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-foreground hover:bg-muted'
            }`}
          >
            {t(`chips.${chip}`)}
            {counts.data && (
              <span className="tabular-nums text-xs text-muted-foreground">
                {chipCount(chip, counts.data)}
              </span>
            )}
          </button>
        ))}
      </div>

      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ q: draftText.trim() });
        }}
      >
        <Field label={t('filters.source')} htmlFor="li-source">
          <Select
            id="li-source"
            value={filters.sourceId}
            onChange={(e) => apply({ sourceId: e.target.value })}
          >
            <option value="">{t('filters.allSources')}</option>
            {(sources.data?.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('filters.reason')} htmlFor="li-reason">
          <Select
            id="li-reason"
            value={filters.reason}
            onChange={(e) => apply({ reason: e.target.value })}
          >
            <option value="">{t('filters.anyReason')}</option>
            {REASON_CHOICES.map((r) => (
              <option key={r} value={r}>
                {isKnownReason(r) ? tr(r) : r}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('filters.range')} htmlFor="li-range">
          <Select
            id="li-range"
            value={filters.range}
            onChange={(e) => apply({ range: e.target.value as InboxFilters['range'] })}
          >
            {RANGE_CHOICES.map((r) => (
              <option key={r} value={r}>
                {t(`filters.ranges.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('filters.tests')} htmlFor="li-tests">
          <Select
            id="li-tests"
            value={filters.tests}
            onChange={(e) => apply({ tests: e.target.value as InboxFilters['tests'] })}
          >
            {TEST_CHOICES.map((c) => (
              <option key={c} value={c}>
                {t(`filters.testChoices.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
        {filters.range === 'custom' && (
          <>
            <Field label={t('filters.from')} htmlFor="li-from">
              <Input
                id="li-from"
                type="date"
                dir="ltr"
                value={filters.from}
                onChange={(e) => apply({ from: e.target.value })}
              />
            </Field>
            <Field
              label={t('filters.to')}
              htmlFor="li-to"
              error={problem === 'order' ? t('filters.rangeOrder') : undefined}
            >
              <Input
                id="li-to"
                type="date"
                dir="ltr"
                value={filters.to}
                invalid={problem === 'order'}
                onChange={(e) => apply({ to: e.target.value })}
              />
            </Field>
          </>
        )}
        <Field label={t('filters.search')} htmlFor="li-q" hint={t('filters.searchHint')}>
          <div className="flex gap-2">
            <Input
              id="li-q"
              dir="ltr"
              value={draftText}
              maxLength={100}
              placeholder={t('filters.searchPlaceholder')}
              onChange={(e) => setDraftText(e.target.value)}
            />
            <Button type="submit" variant="secondary" disabled={!searching}>
              {t('filters.apply')}
            </Button>
          </div>
        </Field>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-1">
          <Button
            type="button"
            variant="secondary"
            disabled={isDefaultFilters(filters)}
            onClick={() => {
              setFilters(DEFAULT_INBOX_FILTERS);
              setDraftText('');
              setSelected([]);
            }}
          >
            {t('filters.reset')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setFilters(ALL_INBOX_FILTERS);
              setDraftText('');
              setSelected([]);
            }}
          >
            {t('filters.showAll')}
          </Button>
        </div>
      </form>

      {canSelect && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2"
          data-testid="bulk-bar"
        >
          <Checkbox
            id="li-select-all"
            checked={allSelected}
            disabled={ids.length === 0}
            onChange={() => setSelected(allSelected ? [] : withinLimit(ids))}
            label={t('bulk.selectPage')}
          />
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {t('bulk.selected', { count: selected.length })}
          </span>
          <Button
            type="button"
            disabled={selected.length === 0 || retry.isPending}
            onClick={() => {
              setSummary(null);
              retry.mutate(selected);
            }}
          >
            {retry.isPending && <Spinner />}
            {t('bulk.retry')}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t('bulk.limit', { max: MAX_BULK })}
          </span>
        </div>
      )}

      {retry.isError && <ErrorText mapped={leadError(retry.error)} />}
      {summary && <RetryResult summary={summary} />}

      {problem === 'order' ? (
        <Alert tone="warning">{t('filters.rangeOrder')}</Alert>
      ) : list.isPending ? (
        <Loading label={t('loading')} />
      ) : list.isError ? (
        <RegionError error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title={isDefaultFilters(filters) ? t('empty.attentionTitle') : t('empty.filteredTitle')}
          message={isDefaultFilters(filters) ? t('empty.attention') : t('empty.filtered')}
          actions={
            isDefaultFilters(filters) ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => apply({ status: 'all', tests: 'all' })}
              >
                {t('filters.showAll')}
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setFilters(ALL_INBOX_FILTERS)}
              >
                {t('filters.reset')}
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[56rem] border-collapse text-sm">
              <caption className="sr-only">{t('table.caption')}</caption>
              <thead>
                <tr className="border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                  {canSelect && <th scope="col" className="w-10 px-3 py-2" />}
                  {(
                    [
                      'received',
                      'source',
                      'lead',
                      'status',
                      'reason',
                      'firstMessage',
                      'actions',
                    ] as const
                  ).map((c) => (
                    <th key={c} scope="col" className="px-3 py-2 text-start font-semibold">
                      {t(`table.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((i) => (
                  <tr
                    key={i.id}
                    data-testid="inbox-row"
                    data-status={i.status}
                    className="align-middle"
                  >
                    {canSelect && (
                      <td className="px-3 py-2">
                        {i.retryable && (
                          <input
                            type="checkbox"
                            aria-label={t('table.select', { id: i.externalId })}
                            checked={selected.includes(i.id)}
                            onChange={() =>
                              setSelected((s) =>
                                s.includes(i.id) || s.length < MAX_BULK ? toggleId(s, i.id) : s,
                              )
                            }
                            className="size-4 accent-[var(--primary)]"
                          />
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2 text-xs">
                      <When value={i.receivedAt} empty="-" />
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={sourceHref(i.sourceId)}
                        dir="auto"
                        className="text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {i.sourceName}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <code dir="ltr" className="break-all text-xs">
                        {i.externalId}
                      </code>
                      {i.isTest && (
                        <Badge className="ms-2" tone="neutral">
                          {t('table.test')}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <EventStatusChip status={i.status} />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {i.reason ? (isKnownReason(i.reason) ? tr(i.reason) : i.reason) : '-'}
                    </td>
                    <td className="px-3 py-2">
                      {i.firstReply ? (
                        <FirstReply reply={i.firstReply} />
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        {can.manage && (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => setOpen(i)}
                          >
                            {t('table.view')}
                          </Button>
                        )}
                        {can.manage && i.retryable && (
                          <Button
                            type="button"
                            size="sm"
                            disabled={retry.isPending}
                            onClick={() => {
                              setSummary(null);
                              retry.mutate([i.id]);
                            }}
                          >
                            {t('table.retry')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.hasNextPage && (
            <Button
              type="button"
              variant="secondary"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage && <Spinner />}
              {t('more')}
            </Button>
          )}
        </div>
      )}

      <PullPanel can={can} />

      <InboxDrawer
        item={open}
        canManage={can.manage}
        onClose={() => setOpen(null)}
        onRetried={(summary) => {
          setSummary(summary);
          setOpen(null);
        }}
      />
    </div>
  );
}

/** What a retry did: how many became contacts, how many still wait, and what was not retried and why. */
export function RetryResult({ summary }: { summary: RetrySummary }) {
  const t = useTranslations('lead-sources.inbox.result');
  const skipped = Object.entries(summary.skipped);
  return (
    <Alert
      tone={summary.stillWaiting > 0 || skipped.length > 0 ? 'warning' : 'success'}
      className="space-y-1"
      data-testid="retry-summary"
    >
      <p>{t('retried', { count: summary.retried })}</p>
      {summary.fixed > 0 && <p>{t('fixed', { count: summary.fixed })}</p>}
      {summary.stillWaiting > 0 && <p>{t('stillWaiting', { count: summary.stillWaiting })}</p>}
      {skipped.length > 0 && (
        <ul className="list-disc ps-5 text-xs">
          {skipped.map(([outcome, count]) => (
            <li key={outcome}>{t(`skipped.${outcome}`, { count })}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}
