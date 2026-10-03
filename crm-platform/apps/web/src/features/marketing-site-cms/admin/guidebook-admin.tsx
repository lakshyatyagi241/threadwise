'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  guidebookAdminListResponseSchema,
  guidebookArticleAdminSchema,
  type GuidebookArticleAdmin,
} from '@crm/contracts';
import { Button, ConfirmDialog, Input, Select, StatTile } from '@crm/ui';
import { ActionError, ErrorBlock, LoadingBlock, NS, PageHeader, operatorFetch } from './shared';

export const GUIDEBOOK_KEY = ['operator', 'cms', 'guidebook'];

/**
 * The help-centre article list (TW-CMS-044, 046): four tiles, category filter, search, a Live/Draft button per row, edit
 * and delete. The Helpful column is the share of helpful votes, "—" before the first vote, as Reference shows it.
 */
export function GuidebookAdmin() {
  const t = useTranslations(`${NS}.guidebookAdmin`);
  const tc = useTranslations(`${NS}.common`);
  const locale = useLocale();
  const qc = useQueryClient();
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState('');
  const [doomed, setDoomed] = useState<GuidebookArticleAdmin | null>(null);
  const q = term.trim();

  const list = useInfiniteQuery({
    queryKey: [...GUIDEBOOK_KEY, { q, category }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      operatorFetch('/cms/guidebook', {
        query: { q, category, cursor: pageParam },
        schema: guidebookAdminListResponseSchema,
        signal,
      }),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
  });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);
  const first = list.data?.pages[0];
  const summary = first?.summary;
  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale]);

  const toggle = useMutation({
    mutationFn: (a: GuidebookArticleAdmin) =>
      operatorFetch(`/cms/guidebook/${a.id}/toggle`, {
        method: 'POST',
        body: { rowVersion: a.rowVersion },
        schema: guidebookArticleAdminSchema,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: GUIDEBOOK_KEY }),
  });
  const remove = useMutation({
    mutationFn: (a: GuidebookArticleAdmin) =>
      operatorFetch(`/cms/guidebook/${a.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDoomed(null);
      return qc.invalidateQueries({ queryKey: GUIDEBOOK_KEY });
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={
          <Link
            href="/admin/guidebook/new"
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
          >
            {t('new')}
          </Link>
        }
      />
      {summary && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={t('stats')}>
          <StatTile label={t('total')} value={nf.format(summary.total)} />
          <StatTile label={t('published')} value={nf.format(summary.published)} tone="accent" />
          <StatTile label={t('drafts')} value={nf.format(summary.drafts)} />
          <StatTile
            label={t('views')}
            value={nf.format(summary.views)}
            hint={t('votes', {
              helpful: nf.format(summary.helpful),
              notHelpful: nf.format(summary.notHelpful),
            })}
          />
        </section>
      )}
      <div
        role="search"
        className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2"
      >
        <Select
          className="w-full sm:w-56"
          value={category}
          aria-label={t('allCategories')}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">{t('allCategories')}</option>
          {first?.categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Input
          type="search"
          className="w-full sm:w-80"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
        />
        {(q || category) && (
          <button
            type="button"
            className="text-sm underline"
            onClick={() => {
              setTerm('');
              setCategory('');
            }}
          >
            {t('clear')}
          </button>
        )}
      </div>

      <ActionError error={toggle.error ?? remove.error} />
      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-start font-medium">#</th>
                <th className="px-4 py-2 text-start font-medium">{t('colTitle')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('colCategory')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('colViews')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('colHelpful')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('colStatus')}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm">
                    {t('empty')}{' '}
                    <Link href="/admin/guidebook/new" className="underline">
                      {t('emptyCta')}
                    </Link>
                  </td>
                </tr>
              )}
              {rows.map((a) => {
                const votes = a.helpful + a.notHelpful;
                return (
                  <tr key={a.id}>
                    <td className="px-4 py-3 tabular-nums">{a.sortOrder}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{a.title}</p>
                      <p className="font-mono text-xs text-muted-foreground" dir="ltr">
                        /guidebook/{a.slug}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs">
                        {a.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{nf.format(a.views)}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {votes > 0 ? `${Math.round((a.helpful / votes) * 100)}%` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        size="sm"
                        variant={a.isPublished ? 'primary' : 'secondary'}
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate(a)}
                      >
                        {a.isPublished ? t('live') : t('draft')}
                      </Button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Link
                          href={`/admin/guidebook/${a.id}`}
                          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm"
                        >
                          {tc('edit')}
                        </Link>
                        <Button size="sm" variant="danger" onClick={() => setDoomed(a)}>
                          {tc('delete')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
        title={t('deleteTitle')}
        message={doomed ? t('deleteMessage', { title: doomed.title }) : ''}
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
