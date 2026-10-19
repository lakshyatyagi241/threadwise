'use client';

import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CMS_CONTACT_TOPICS,
  cmsContactListResponseSchema,
  cmsContactMessageSchema,
  markAllCmsContactReadResponseSchema,
  type CmsContactMessage,
} from '@crm/contracts';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Input } from '@crm/ui';
import { ActionError, ErrorBlock, LoadingBlock, NS, operatorFetch } from './shared';

const KEY = ['operator', 'cms', 'contact'];

/** The contact inbox: filter by read state, search, mark read or unread, delete (TW-CMS-042, 043). */
export function ContactInbox() {
  const t = useTranslations(`${NS}.contact`);
  const tc = useTranslations(`${NS}.common`);
  const locale = useLocale();
  const timeZone = useTimeZone();
  const qc = useQueryClient();
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'' | 'unread' | (typeof CMS_CONTACT_TOPICS)[number]>('');
  const status = filter === 'unread' ? 'unread' : '';
  const topic = filter === 'unread' ? '' : filter;
  const [doomed, setDoomed] = useState<CmsContactMessage | null>(null);

  const list = useInfiniteQuery({
    queryKey: [...KEY, { q, status, topic }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      operatorFetch('/cms/contact-messages', {
        query: { q, status, topic, cursor: pageParam },
        schema: cmsContactListResponseSchema,
        signal,
      }),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
  });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);
  const summary = list.data?.pages[0]?.summary;
  const when = useMemo(
    () => new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  );

  const setRead = useMutation({
    mutationFn: (m: CmsContactMessage) =>
      operatorFetch(`/cms/contact-messages/${m.id}/read`, {
        method: 'PATCH',
        body: { isRead: !m.isRead },
        schema: cmsContactMessageSchema,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  const readAll = useMutation({
    mutationFn: () =>
      operatorFetch('/cms/contact-messages/read-all', {
        method: 'POST',
        schema: markAllCmsContactReadResponseSchema,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  const remove = useMutation({
    mutationFn: (m: CmsContactMessage) =>
      operatorFetch(`/cms/contact-messages/${m.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDoomed(null);
      return qc.invalidateQueries({ queryKey: KEY });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQ(term.trim());
  };

  const CHIPS = ['', 'unread', ...CMS_CONTACT_TOPICS] as const;
  const chipLabel = (c: (typeof CHIPS)[number]) =>
    c === ''
      ? t('all')
      : c === 'unread'
        ? t('unread')
        : t(`topic${c[0]!.toUpperCase()}${c.slice(1)}` as 'topicSales');

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('eyebrow')}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('title')}</h1>
          {summary && (
            <p className="text-sm text-muted-foreground">
              {t('totalCount', { total: summary.total })} ·{' '}
              <span className={summary.unread > 0 ? 'text-danger' : undefined}>
                {t('unreadCount', { unread: summary.unread })}
              </span>
            </p>
          )}
        </div>
        {summary && summary.unread > 0 && (
          <Button
            size="sm"
            variant="secondary"
            disabled={readAll.isPending}
            onClick={() => readAll.mutate()}
          >
            {t('markAllRead')}
          </Button>
        )}
      </Card>
      <form onSubmit={submit} role="search" className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          className="min-w-0 flex-1 basis-64"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
        />
        <div role="group" aria-label={t('filters')} className="flex flex-wrap gap-2">
          {CHIPS.map((c) => (
            <button
              key={c || 'all'}
              type="button"
              aria-pressed={filter === c}
              onClick={() => setFilter(c)}
              className={
                filter === c
                  ? 'rounded-full bg-foreground px-4 py-1.5 text-sm text-background'
                  : 'rounded-full border border-border px-4 py-1.5 text-sm hover:bg-muted'
              }
            >
              {chipLabel(c)}
            </button>
          ))}
        </div>
      </form>
      <ActionError error={setRead.error ?? readAll.error ?? remove.error} />
      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('empty')} message={t('emptyHint')} />
      ) : (
        <ul className="space-y-3">
          {rows.map((m) => (
            <li key={m.id}>
              <Card className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {!m.isRead && (
                      <span
                        className="size-2 rounded-full bg-primary"
                        role="img"
                        aria-label={t('unread')}
                      />
                    )}
                    <span className={m.isRead ? 'font-medium' : 'font-semibold'}>{m.name}</span>
                    <a
                      href={`mailto:${m.email}`}
                      className="text-sm text-primary underline"
                      dir="ltr"
                    >
                      {m.email}
                    </a>
                    {m.topic && <Badge>{m.topic}</Badge>}
                    {m.company && (
                      <span className="text-xs text-muted-foreground">· {m.company}</span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap text-sm">{m.message}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {when.format(new Date(m.createdAt))}
                    {m.ip ? ` · ${m.ip}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <a
                    href={`mailto:${m.email}?subject=${encodeURIComponent(t('replySubject'))}`}
                    className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm"
                  >
                    {t('reply')}
                  </a>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={setRead.isPending}
                    onClick={() => setRead.mutate(m)}
                  >
                    {m.isRead ? t('markUnread') : t('markRead')}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setDoomed(m)}>
                    {tc('delete')}
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <Button
          variant="secondary"
          onClick={() => void list.fetchNextPage()}
          disabled={list.isFetchingNextPage}
        >
          {tc('loadMore')}
        </Button>
      )}
      <ConfirmDialog
        open={doomed !== null}
        title={t('deleteConfirmTitle')}
        message={t('deleteConfirmMessage')}
        confirmLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => doomed && remove.mutate(doomed)}
        onClose={() => setDoomed(null)}
      />
    </div>
  );
}
