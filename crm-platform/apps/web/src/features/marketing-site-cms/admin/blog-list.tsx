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
import { Button, ConfirmDialog, Input, Select, StatTile } from '@crm/ui';
import {
  ActionError,
  ErrorBlock,
  LoadingBlock,
  NS,
  PageHeader,
  operatorFetch,
  PILL_BTN,
  PILL_DANGER,
} from './shared';

const KEY = ['operator', 'cms', 'blog'];

/**
 * The admin post list (TW-CMS-029, 031, 032): four tiles, search and status filter with Filter / Clear, then the table
 * (thumbnail, post, category, status, views, date, actions). Pages are cursor-based, so the footer says "Load more".
 */
export function BlogList() {
  const t = useTranslations(`${NS}.blog`);
  const tc = useTranslations(`${NS}.common`);
  const locale = useLocale();
  const qc = useQueryClient();
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  const [statusDraft, setStatusDraft] = useState<'' | 'draft' | 'published'>('');
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
  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale]);

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
    setStatus(statusDraft);
  };
  const clear = () => {
    setTerm('');
    setQ('');
    setStatusDraft('');
    setStatus('');
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('heading')}
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
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={t('stats')}>
          <StatTile
            label={t('totalPosts')}
            value={nf.format(summary.total)}
            hint={t('inCatalog')}
          />
          <StatTile
            label={t('statusPublished')}
            value={nf.format(summary.published)}
            hint={t('liveOnSite')}
            tone="accent"
          />
          <StatTile
            label={t('drafts')}
            value={nf.format(summary.drafts)}
            hint={t('notPublished')}
          />
          <StatTile
            label={t('totalViews')}
            value={nf.format(summary.views)}
            hint={t('allTimeReads')}
          />
        </section>
      )}
      <form
        onSubmit={submit}
        className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2"
        role="search"
      >
        <Input
          className="w-full sm:w-80"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
        />
        <Select
          className="w-full sm:w-44"
          value={statusDraft}
          aria-label={t('statusAll')}
          onChange={(e) => setStatusDraft(e.target.value as typeof statusDraft)}
        >
          <option value="">{t('statusAll')}</option>
          <option value="published">{t('statusPublished')}</option>
          <option value="draft">{t('statusDraft')}</option>
        </Select>
        <Button type="submit" variant="secondary">
          {t('filter')}
        </Button>
        {(q || status) && (
          <button type="button" className="text-sm underline" onClick={clear}>
            {t('clear')}
          </button>
        )}
      </form>

      <ActionError error={toggle.error ?? remove.error} />
      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <div className="rounded-md border border-border">
          <div className="border-b border-border px-4 py-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('allPosts')}
            </p>
            <h2 className="text-lg font-semibold">{t('detailedList')}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th className="w-14 px-4 py-2" />
                  <th className="px-4 py-2 text-start font-medium">{t('colPost')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('colCategory')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('colStatus')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('colViews')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('colDate')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('colActions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center">
                      <p className="text-lg font-semibold">{t('empty')}</p>
                      <p className="text-sm text-muted-foreground">
                        {t('emptyHint')}{' '}
                        <Link href="/admin/blog/new" className="underline">
                          {t('emptyCta')}
                        </Link>
                      </p>
                    </td>
                  </tr>
                )}
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3">
                      {p.featuredImage ? (
                        <img
                          src={p.featuredImage}
                          alt=""
                          className="size-10 rounded object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="block size-10 rounded bg-muted" aria-hidden />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/admin/blog/${p.id}`} className="font-medium hover:underline">
                        {p.title}
                      </Link>
                      <p className="font-mono text-xs text-muted-foreground" dir="ltr">
                        /blog/{p.slug}
                      </p>
                    </td>
                    <td className="px-4 py-3">{p.category?.name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${p.status === 'published' ? 'bg-wa-bubble text-wa-deep' : 'bg-muted text-muted-foreground'}`}
                      >
                        {p.status === 'published' ? t('statusPublished') : t('statusDraft')}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{nf.format(p.views)}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {when.format(new Date(p.publishedAt ?? p.createdAt))}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/admin/blog/${p.id}`} className={PILL_BTN}>
                          {tc('edit')}
                        </Link>
                        <button
                          type="button"
                          className={PILL_BTN}
                          disabled={toggle.isPending}
                          onClick={() => toggle.mutate(p)}
                        >
                          {p.status === 'published' ? t('unpublish') : t('publish')}
                        </button>
                        <button type="button" className={PILL_DANGER} onClick={() => setDoomed(p)}>
                          {tc('delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
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
