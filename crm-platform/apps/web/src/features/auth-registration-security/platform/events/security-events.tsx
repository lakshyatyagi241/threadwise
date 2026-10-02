'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { securityEventListResponseSchema } from '@crm/contracts';
import { Badge, Button, Card, Field, Input, Select, Spinner } from '@crm/ui';
import { eventActor, eventOrg, shortId } from '../lib/event-view';
import { csvFilename, eventsToCsv } from '../lib/events-csv';
import {
  EVENT_STATUSES,
  KNOWN_EVENTS,
  eventsHref,
  filtersFromParams,
  hasFilters,
  parseStatus,
  prettyPayload,
  statusTone,
  type EventFilters,
} from '../lib/events';
import { operatorFetch } from '../operator-fetch';
import { CopyId } from '../ui/copy-id';
import { PageHeader } from '../ui/page-header';
import { ErrorBlock, LoadingBlock } from '../ui/state';

const NS = 'auth-registration-security.platform.events';
const PAGE_SIZE = 50;

/** The security event stream: filter by event name and status, load more by cursor, open a row for its payload. */
export function SecurityEvents() {
  const t = useTranslations(NS);
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const filters = filtersFromParams(params);
  const { event, q: search, status } = filters;
  const listId = useId();
  // `typed` is what the person has typed since the last apply; null means the box simply shows the URL filter.
  const [typedEvent, setTypedEvent] = useState<string | null>(null);
  const [typedSearch, setTypedSearch] = useState<string | null>(null);
  const draftEvent = typedEvent ?? event ?? '';
  const draftSearch = typedSearch ?? search ?? '';
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [exported, setExported] = useState<number | null>(null);

  const q = useInfiniteQuery({
    queryKey: ['operator', 'security-events', { event, q: search, status }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      operatorFetch('/security/events', {
        query: { limit: PAGE_SIZE, event, q: search, status, cursor: pageParam },
        schema: securityEventListResponseSchema,
        signal,
      }),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
  });

  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.data) ?? [], [q.data]);
  const when = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }),
    [locale],
  );

  const apply = (next: EventFilters) => {
    setOpen(new Set());
    setTypedEvent(null);
    setTypedSearch(null);
    setExported(null);
    router.replace(eventsHref(next));
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    apply({ event: draftEvent, q: draftSearch, status });
  };
  const exportCsv = () => {
    // Built in the browser from the rows already loaded: nothing more is asked of the server.
    const blob = new Blob([eventsToCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = csvFilename(new Date());
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setExported(rows.length);
  };
  const toggle = (key: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const filtered = hasFilters(filters);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv} disabled={rows.length === 0}>
              {t('export')}
            </Button>
            <Button variant="secondary" onClick={() => void q.refetch()} disabled={q.isFetching}>
              {q.isFetching && !q.isFetchingNextPage && <Spinner label={t('refreshing')} />}
              {t('refresh')}
            </Button>
          </>
        }
      />

      {exported !== null && (
        <p role="status" className="text-xs text-muted-foreground">
          {t('exported', { count: exported })}
        </p>
      )}

      <Card>
        <form
          onSubmit={onSubmit}
          className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_12rem_auto]"
          role="search"
          aria-label={t('filters.label')}
        >
          <Field label={t('filters.event')} htmlFor="events-event" hint={t('filters.eventHint')}>
            <Input
              id="events-event"
              value={draftEvent}
              onChange={(e) => setTypedEvent(e.target.value)}
              list={listId}
              autoComplete="off"
              spellCheck={false}
              placeholder="auth.failed"
              dir="ltr"
              className="font-mono"
            />
            <datalist id={listId}>
              {KNOWN_EVENTS.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </Field>
          <Field label={t('filters.q')} htmlFor="events-q" hint={t('filters.qHint')}>
            <Input
              id="events-q"
              type="search"
              value={draftSearch}
              onChange={(e) => setTypedSearch(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="platform.security"
              dir="ltr"
              className="font-mono"
            />
          </Field>
          <Field label={t('filters.status')} htmlFor="events-status">
            <Select
              id="events-status"
              value={status ?? ''}
              onChange={(e) =>
                apply({ event: draftEvent, q: draftSearch, status: parseStatus(e.target.value) })
              }
            >
              <option value="">{t('filters.anyStatus')}</option>
              {EVENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button type="submit">{t('filters.apply')}</Button>
            {filtered && (
              <Button variant="ghost" onClick={() => apply({})}>
                {t('filters.clear')}
              </Button>
            )}
          </div>
        </form>
      </Card>

      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <Card className="py-10 text-center text-sm text-muted-foreground">
          {filtered ? t('emptyFiltered') : t('empty')}
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-border" aria-label={t('listLabel')}>
            {rows.map((row, index) => {
              const key = row.id;
              const payload = prettyPayload(row.payload);
              const expanded = open.has(key);
              const panelId = `event-payload-${index}`;
              const actor = eventActor(row);
              const org = eventOrg(row);
              const typeLabel = t.has(`actorTypes.${actor.type}`)
                ? t(`actorTypes.${actor.type}`)
                : actor.type;
              return (
                <li key={key} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <Badge tone={statusTone(row.status)}>{t(`status.${row.status}`)}</Badge>
                    <span className="min-w-0 break-all font-mono text-sm font-medium" dir="ltr">
                      {row.event}
                    </span>
                    <time dateTime={row.at} className="text-xs text-muted-foreground sm:ms-auto">
                      {when.format(new Date(row.at))}
                    </time>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-start gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <dl className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
                      <div className="flex flex-wrap items-center gap-x-1.5">
                        <dt>{t('actorLabel')}</dt>
                        <dd className="flex flex-wrap items-center gap-x-1.5">
                          {actor.label ? (
                            <>
                              <span className="text-foreground">{actor.label}</span>
                              {actor.email && (
                                <span dir="ltr" className="font-mono">
                                  {actor.email}
                                </span>
                              )}
                              <span>({typeLabel})</span>
                            </>
                          ) : (
                            <span className="text-foreground">{typeLabel}</span>
                          )}
                          {actor.id && (
                            <CopyId
                              value={actor.id}
                              shown={shortId(actor.id)}
                              what={t('copyNames.actorId')}
                            />
                          )}
                        </dd>
                      </div>
                      {org && (
                        <div className="flex flex-wrap items-center gap-x-1.5">
                          <dt>{t('workspaceLabel')}</dt>
                          <dd className="flex flex-wrap items-center gap-x-1.5">
                            <span className="text-foreground">{org.label}</span>
                            {org.slug && (
                              <span dir="ltr" className="font-mono">
                                {org.slug}
                              </span>
                            )}
                            <CopyId value={org.id} shown={null} what={t('copyNames.orgId')} />
                          </dd>
                        </div>
                      )}
                      {row.ip && (
                        <div className="flex items-center gap-x-1.5">
                          <dt>{t('ip')}</dt>
                          <dd className="font-mono" dir="ltr">
                            {row.ip}
                          </dd>
                        </div>
                      )}
                      {row.requestId && (
                        <div className="flex flex-wrap items-center gap-x-1.5">
                          <dt>{t('requestIdLabel')}</dt>
                          <dd>
                            <CopyId
                              value={row.requestId}
                              shown={shortId(row.requestId)}
                              what={t('copyNames.requestId')}
                            />
                          </dd>
                        </div>
                      )}
                    </dl>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={panelId}
                      onClick={() => toggle(key)}
                      className="ms-auto rounded px-1 text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {expanded ? t('hidePayload') : t('showPayload')}
                    </button>
                  </div>
                  {row.userAgent && (
                    <p
                      className="mt-1 truncate text-xs text-muted-foreground"
                      title={row.userAgent}
                      dir="ltr"
                    >
                      <span className="me-1.5" dir="auto">
                        {t('userAgentLabel')}
                      </span>
                      {row.userAgent}
                    </p>
                  )}
                  {expanded && (
                    <div id={panelId} className="mt-2">
                      {payload ? (
                        <pre
                          dir="ltr"
                          tabIndex={0}
                          aria-label={t('payloadLabel', { event: row.event })}
                          className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed"
                        >
                          {payload}
                        </pre>
                      ) : (
                        <p className="text-xs text-muted-foreground">{t('noPayload')}</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <footer className="flex items-center justify-center border-t border-border px-4 py-3">
            {q.hasNextPage ? (
              <Button
                variant="secondary"
                onClick={() => void q.fetchNextPage()}
                disabled={q.isFetchingNextPage}
              >
                {q.isFetchingNextPage && <Spinner label={t('loading')} />}
                {q.isFetchingNextPage ? t('loading') : t('loadMore')}
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">
                {t('end', { count: rows.length })}
              </span>
            )}
          </footer>
        </Card>
      )}
    </div>
  );
}
