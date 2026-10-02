'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  cmsContactListResponseSchema,
  cmsContactMessageSchema,
  type CmsContactMessage,
} from '@crm/contracts';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Input, Select } from '@crm/ui';
import { ActionError, ErrorBlock, LoadingBlock, NS, PageHeader, operatorFetch } from './shared';

const KEY = ['operator', 'cms', 'contact'];

/** The contact inbox: filter by read state, search, mark read or unread, delete (TW-CMS-042, 043). */
export function ContactInbox() {
  const t = useTranslations(`${NS}.contact`);
  const tc = useTranslations(`${NS}.common`);
  const locale = useLocale();
  const qc = useQueryClient();
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | 'unread' | 'read'>('');
  const [doomed, setDoomed] = useState<CmsContactMessage | null>(null);

  const list = useInfiniteQuery({
    queryKey: [...KEY, { q, status }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      operatorFetch('/cms/contact-messages', {
        query: { q, status, cursor: pageParam },
        schema: cmsContactListResponseSchema,
        signal,
      }),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
  });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);
  const summary = list.data?.pages[0]?.summary;
  const when = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
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

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} description={t('description')} />
      {summary && (
        <p className="text-sm text-muted-foreground">
          {t('summary', { total: summary.total, unread: summary.unread })}
        </p>
      )}
      <Card>
        <form
          onSubmit={submit}
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto]"
          role="search"
        >
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
          />
          <Select
            value={status}
            aria-label={t('all')}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <option value="">{t('all')}</option>
            <option value="unread">{t('unread')}</option>
            <option value="read">{t('read')}</option>
          </Select>
          <Button type="submit" variant="secondary">
            {t('search')}
          </Button>
        </form>
      </Card>
      <ActionError error={setRead.error ?? remove.error} />
      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('empty')} message={t('emptyHint')} />
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((m) => (
            <li key={m.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <p className={m.isRead ? 'font-medium' : 'font-semibold'}>{m.name}</p>
                <span className="text-sm text-muted-foreground" dir="ltr">
                  {m.email}
                </span>
                {m.topic && <Badge>{m.topic}</Badge>}
                {!m.isRead && <Badge tone="warning">{t('unread')}</Badge>}
                <span className="ms-auto text-xs text-muted-foreground">
                  {when.format(new Date(m.createdAt))}
                </span>
              </div>
              {m.company && <p className="text-xs text-muted-foreground">{m.company}</p>}
              <p className="whitespace-pre-wrap text-sm">{m.message}</p>
              <div className="flex gap-2">
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
