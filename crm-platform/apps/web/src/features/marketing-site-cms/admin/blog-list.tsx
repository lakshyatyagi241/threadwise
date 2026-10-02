'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  blogAdminListResponseSchema,
  blogPostAdminSchema,
  type BlogPostAdmin,
} from '@crm/contracts';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Input, Select } from '@crm/ui';
import { ActionError, ErrorBlock, LoadingBlock, NS, PageHeader, operatorFetch } from './shared';

const KEY = ['operator', 'cms', 'blog'];

/** The admin post list: search, status filter, publish toggle and delete (WD-CMS-029, 031, 032). */
export function BlogList() {
  const t = useTranslations(`${NS}.blog`);
  const tc = useTranslations(`${NS}.common`);
  const locale = useLocale();
  const qc = useQueryClient();
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | 'draft' | 'published'>('');
  const [doomed, setDoomed] = useState<BlogPostAdmin | null>(null);

  const list = useInfiniteQuery({
    queryKey: [...KEY, { q, status }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      operatorFetch('/cms/blog', {
        query: { q, status, cursor: pageParam },
        schema: blogAdminListResponseSchema,
        signal,
      }),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
  });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);
  const summary = list.data?.pages[0]?.summary;
  const when = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }), [locale]);

  const toggle = useMutation({
    mutationFn: (p: BlogPostAdmin) =>
      operatorFetch(`/cms/blog/${p.id}/toggle`, {
        method: 'POST',
        body: { rowVersion: p.rowVersion },
        schema: blogPostAdminSchema,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  const remove = useMutation({
    mutationFn: (p: BlogPostAdmin) => operatorFetch(`/cms/blog/${p.id}`, { method: 'DELETE' }),
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
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Link
            href="/admin/blog/new"
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
          >
            {t('new')}
          </Link>
        }
      />
      {summary && (
        <p className="text-sm text-muted-foreground">
          {t('summary', {
            total: summary.total,
            published: summary.published,
            drafts: summary.drafts,
            views: summary.views,
          })}
        </p>
      )}
      <Card>
        <form
          onSubmit={submit}
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]"
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
            aria-label={t('statusAll')}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <option value="">{t('statusAll')}</option>
            <option value="draft">{t('statusDraft')}</option>
            <option value="published">{t('statusPublished')}</option>
          </Select>
          <Button type="submit" variant="secondary">
            {t('search')}
          </Button>
        </form>
      </Card>

      <ActionError error={toggle.error ?? remove.error} />
      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('empty')} message={t('emptyHint')} />
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <Link href={`/admin/blog/${p.id}`} className="font-medium hover:underline">
                  {p.title}
                </Link>
                <p className="truncate font-mono text-xs text-muted-foreground" dir="ltr">
                  /blog/{p.slug}
                </p>
              </div>
              <Badge tone={p.live ? 'success' : p.status === 'published' ? 'warning' : 'neutral'}>
                {p.live ? t('live') : p.status === 'published' ? t('scheduled') : t('statusDraft')}
              </Badge>
              {p.publishedAt && (
                <span className="text-xs text-muted-foreground">
                  {when.format(new Date(p.publishedAt))}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {t('views', { count: p.views })}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate(p)}
              >
                {p.status === 'published' ? t('unpublish') : t('publish')}
              </Button>
              <Button size="sm" variant="danger" onClick={() => setDoomed(p)}>
                {tc('delete')}
              </Button>
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
