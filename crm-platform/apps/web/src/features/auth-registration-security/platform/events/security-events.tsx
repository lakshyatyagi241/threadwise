'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { securityEventListResponseSchema } from '@crm/contracts';
import { Badge, Button, Card, Field, Input, Select, Spinner } from '@crm/ui';
import {
  EVENT_STATUSES,
  KNOWN_EVENTS,
  eventsHref,
  parseStatus,
  prettyPayload,
  statusTone,
  type EventStatus,
} from '../lib/events';
import { operatorFetch } from '../operator-fetch';
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
  const event = params.get('event')?.trim() || undefined;
  const status = parseStatus(params.get('status'));
  const listId = useId();
  // `typed` is what the person has typed since the last apply; null means the box simply shows the URL filter.
  const [typed, setTyped] = useState<string | null>(null);
  const draftEvent = typed ?? event ?? '';
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const q = useInfiniteQuery({
    queryKey: ['operator', 'security-events', { event, status }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      operatorFetch('/security/events', {
        query: { limit: PAGE_SIZE, event, status, cursor: pageParam },
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

  const apply = (next: { event?: string; status?: EventStatus }) => {
    setOpen(new Set());
    setTyped(null);
    router.replace(eventsHref(next));
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    apply({ event: draftEvent, status });
  };
  const toggle = (key: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const filtered = Boolean(event || status);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          <Button variant="secondary" onClick={() => void q.refetch()} disabled={q.isFetching}>
            {q.isFetching && !q.isFetchingNextPage && <Spinner label={t('refreshing')} />}
            {t('refresh')}
          </Button>
        }
      />

      <Card>
        <form
          onSubmit={onSubmit}
          className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]"
          role="search"
          aria-label={t('filters.label')}
        >
          <Field label={t('filters.event')} htmlFor="events-event" hint={t('filters.eventHint')}>
            <Input
              id="events-event"
              value={draftEvent}
              onChange={(e) => setTyped(e.target.value)}
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
          <Field label={t('filters.status')} htmlFor="events-status">
            <Select
              id="events-status"
              value={status ?? ''}
              onChange={(e) => apply({ event: draftEvent, status: parseStatus(e.target.value) })}
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
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{t('actor', { actor: row.actorType })}</span>
                    {row.ip && (
                      <span>
                        {t('ip')}{' '}
                        <span className="font-mono" dir="ltr">
                          {row.ip}
                        </span>
                      </span>
                    )}
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
