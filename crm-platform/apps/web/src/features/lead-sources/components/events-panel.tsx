'use client';

import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  PLAN_UPGRADE_PATH,
  type LeadEventResponse,
  type LeadEventStatus,
  type LeadSourceResponse,
} from '@crm/contracts';
import { Alert, Badge, Button, EmptyState, Select, Spinner, useToast } from '@crm/ui';
import { fetchEvents, leadKeys } from '../api';
import {
  DEFAULT_EVENT_FILTERS,
  EVENT_FILTERS,
  TEST_FILTERS,
  attentionGroups,
  guidanceFor,
  isRetryable,
  isTestParam,
  mergeEvents,
  reasonView,
  statusesFor,
  type EventFilter,
  type EventFilters,
  type TestFilter,
} from '../lib/event-view';
import type { LeadsCan } from '../lib/permissions';
import { contactHref } from '../lib/source-view';
import { EventDrawer } from './event-drawer';
import { useRetry } from './use-retry';
import { ErrorText, EventStatusChip, Loading, RegionError, When } from './ui';

function useEventPages(
  sourceId: string,
  status: LeadEventStatus | undefined,
  tests: TestFilter,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: leadKeys.events(sourceId, status ?? 'all', tests),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      fetchEvents(sourceId, { status, isTest: isTestParam(tests), cursor: pageParam }, signal),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    retry: false,
    enabled,
  });
}

/**
 * The recent events of a source: what each lead became and what to do about the ones that wait. Filters (status, tests) are server
 * side; "needs attention" asks for the two statuses that wait and merges them. The stored payload is fetched only when an event is
 * opened (the drawer), never with the list.
 */
export function EventsPanel({
  source,
  can,
  filters,
  onFilters,
}: {
  source: LeadSourceResponse;
  can: LeadsCan;
  filters: EventFilters;
  onFilters: (next: EventFilters) => void;
}) {
  const t = useTranslations('lead-sources.events');
  const tg = useTranslations('lead-sources.guidance');
  const te = useTranslations('lead-sources.eventFilters');
  const tt = useTranslations('lead-sources.testFilters');
  const ts = useTranslations('lead-sources.eventStatus');
  const { toast } = useToast();
  const [open, setOpen] = useState<LeadEventResponse | null>(null);

  const statuses = statusesFor(filters.status);
  const a = useEventPages(source.id, statuses[0], filters.tests, true);
  const b = useEventPages(source.id, statuses[1], filters.tests, statuses.length > 1);
  const queries = statuses.length > 1 ? [a, b] : [a];

  const events = useMemo(
    () => mergeEvents(queries.map((q) => q.data?.pages.flatMap((p) => p.data) ?? [])),
    // `queries` is rebuilt every render; its data arrays are what matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [a.data, b.data, statuses.length],
  );
  const pending = queries.some((q) => q.isPending);
  const error = queries.find((q) => q.isError)?.error;
  const hasNext = queries.some((q) => q.hasNextPage);
  const loadingMore = queries.some((q) => q.isFetchingNextPage);
  const refetchAll = () => queries.forEach((q) => void q.refetch());

  const retry = useRetry(source.id, (e) => toast(t('retriedToast', { status: ts(e.status) })));
  const groups = attentionGroups(events);
  const filtered =
    filters.status !== DEFAULT_EVENT_FILTERS.status ||
    filters.tests !== DEFAULT_EVENT_FILTERS.tests;

  return (
    <section id="events" aria-labelledby="ls-events-title" className="space-y-4 scroll-mt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="ls-events-title" className="text-lg font-semibold">
            {t('title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('help')}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="ls-ev-status" className="block text-xs font-medium">
              {t('filterStatus')}
            </label>
            <Select
              id="ls-ev-status"
              value={filters.status}
              onChange={(e) => onFilters({ ...filters, status: e.target.value as EventFilter })}
              className="h-9 w-auto min-w-40"
            >
              {EVENT_FILTERS.map((f) => (
                <option key={f} value={f}>
                  {te(f)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <label htmlFor="ls-ev-tests" className="block text-xs font-medium">
              {t('filterTests')}
            </label>
            <Select
              id="ls-ev-tests"
              value={filters.tests}
              onChange={(e) => onFilters({ ...filters, tests: e.target.value as TestFilter })}
              className="h-9 w-auto min-w-40"
            >
              {TEST_FILTERS.map((f) => (
                <option key={f} value={f}>
                  {tt(f)}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      {source.needsAttention > 0 && (
        <Alert tone="warning" className="space-y-2" data-testid="needs-attention">
          <p className="font-medium">{t('attentionTitle', { count: source.needsAttention })}</p>
          {groups.length > 0 && (
            <ul className="space-y-1 text-xs">
              {groups.map((g) => (
                <li key={g.key}>
                  <span className="font-medium">{t('attentionGroup', { count: g.count })}</span>{' '}
                  {tg(g.key)}
                  {g.upgrade && (
                    <>
                      {' '}
                      <Link
                        href={PLAN_UPGRADE_PATH}
                        className="font-medium underline underline-offset-2"
                      >
                        {tg('upgrade')}
                      </Link>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {filters.status !== 'attention' && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onFilters({ status: 'attention', tests: 'hide' })}
            >
              {t('showAttention')}
            </Button>
          )}
        </Alert>
      )}

      {pending ? (
        <Loading label={t('loading')} />
      ) : error ? (
        <RegionError error={error} onRetry={refetchAll} />
      ) : events.length === 0 ? (
        <EmptyState
          title={filtered ? t('emptyFilteredTitle') : t('emptyTitle')}
          message={filtered ? t('emptyFiltered') : t('empty')}
          actions={
            filtered ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => onFilters(DEFAULT_EVENT_FILTERS)}
              >
                {t('clearFilters')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[56rem] border-collapse text-sm">
            <caption className="sr-only">{t('title')}</caption>
            <thead>
              <tr className="border-b border-border bg-muted text-start text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-3 py-2 text-start font-semibold">
                  {t('col.status')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-semibold">
                  {t('col.lead')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-semibold">
                  {t('col.result')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-semibold">
                  {t('col.links')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-semibold">
                  {t('col.received')}
                </th>
                <th scope="col" className="px-3 py-2 text-end font-semibold">
                  <span className="sr-only">{t('col.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {events.map((e) => (
                <EventRow
                  key={e.id}
                  event={e}
                  can={can}
                  busy={retry.pending}
                  onOpen={() => {
                    retry.reset();
                    setOpen(e);
                  }}
                  onRetry={() => void retry.run(e.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {retry.error && !open ? <ErrorText error={retry.error} /> : null}

      {hasNext && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="secondary"
            disabled={loadingMore}
            onClick={() => queries.forEach((q) => q.hasNextPage && void q.fetchNextPage())}
          >
            {loadingMore && <Spinner />}
            {t('loadMore')}
          </Button>
        </div>
      )}

      <EventDrawer
        sourceId={source.id}
        event={open}
        retentionDays={source.rawRetentionDays}
        canManage={can.manage}
        retry={retry}
        onClose={() => setOpen(null)}
      />
    </section>
  );
}

function EventRow({
  event: e,
  can,
  busy,
  onOpen,
  onRetry,
}: {
  event: LeadEventResponse;
  can: LeadsCan;
  busy: boolean;
  onOpen: () => void;
  onRetry: () => void;
}) {
  const t = useTranslations('lead-sources.events');
  const tr = useTranslations('lead-sources.reasons');
  const tg = useTranslations('lead-sources.guidance');
  const reason = reasonView(e.reason);
  const guidance = guidanceFor(e.status, e.reason);
  return (
    <tr data-testid="event-row" data-status={e.status} className="align-top">
      <td className="px-3 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <EventStatusChip status={e.status} />
          {e.isTest && <Badge>{t('test')}</Badge>}
        </div>
      </td>
      <td className="px-3 py-3">
        <code dir="ltr" className="block max-w-[14rem] truncate text-xs" title={e.externalId}>
          {e.externalId}
        </code>
        {e.attempts > 1 && (
          <span className="text-xs text-muted-foreground">
            {t('attempts', { count: e.attempts })}
          </span>
        )}
      </td>
      <td className="max-w-sm px-3 py-3">
        {reason && <div>{reason.known ? tr(reason.code) : reason.raw}</div>}
        {e.error && (
          <div dir="auto" className="break-words text-xs text-danger">
            {e.error}
          </div>
        )}
        {guidance && <div className="mt-1 text-xs text-muted-foreground">{tg(guidance.key)}</div>}
        {e.duplicateCount > 0 && (
          <div className="text-xs text-muted-foreground">
            {t('deliveredAgain', { count: e.duplicateCount })}
          </div>
        )}
        {!reason && !e.error && !guidance && e.duplicateCount === 0 && (
          <span className="text-muted-foreground">-</span>
        )}
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-col gap-1 text-xs">
          {e.contactId ? (
            <Link
              href={contactHref(e.contactId)}
              className="text-primary underline underline-offset-2"
            >
              {t('contact')}
            </Link>
          ) : null}
          {e.dealId ? (
            <Link href={`/deals/${e.dealId}`} className="text-primary underline underline-offset-2">
              {t('deal')}
            </Link>
          ) : null}
          {!e.contactId && !e.dealId && <span className="text-muted-foreground">-</span>}
        </div>
      </td>
      <td className="px-3 py-3 text-xs">
        <When value={e.receivedAt} empty="-" />
      </td>
      <td className="px-3 py-3 text-end">
        {can.manage && (
          <div className="flex flex-wrap justify-end gap-2">
            {isRetryable(e) && (
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onRetry}>
                {t('retry')}
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={onOpen}>
              {t('open')}
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}
