'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, ConfirmDialog, Spinner, cn, useToast } from '@crm/ui';
import { FB_POST_RANGES, type FbPost, type ListFbPostsQuery } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { KEYS, deletePost, publishPost, usePosts } from '../api/facebook';
import { formatCount, relativeTime, shorten } from '../lib/format';
import {
  FB_BLUE,
  FacebookGlyph,
  GridIcon,
  ImageIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  TrashIcon,
} from './fb-icons';
import { PageSelect } from './page-select';

type Status = ListFbPostsQuery['status'];
type Range = ListFbPostsQuery['range'];
const STATUSES: readonly Status[] = ['all', 'scheduled', 'published', 'failed'];
const RANGES: readonly Range[] = ['all', ...FB_POST_RANGES];

const PILL: Record<string, string> = {
  scheduled: 'bg-warning/15 text-warning',
  published: 'bg-success/10 text-success',
  failed: 'bg-danger/10 text-danger',
  draft: 'bg-muted text-muted-foreground',
};
const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const linkBtn =
  'inline-flex h-9 items-center gap-2 rounded-full border border-border bg-background px-4 text-xs font-medium hover:bg-muted';

/** `/facebook/posts` (TW-FB-017): every post made from here, with KPI cards, status, range, search and Page filters, retry and delete. */
export function PostsScreen() {
  const t = useTranslations('facebook.posts');
  const qc = useQueryClient();
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const canManage = useCan('fb.posts.manage');

  const status = (STATUSES.find((s) => s === search.get('status')) ?? 'all') as Status;
  const range = (RANGES.find((r) => r === search.get('range')) ?? 'all') as Range;
  const account = search.get('account') ?? '';
  const q = search.get('q') ?? '';
  const page = Math.max(1, Number(search.get('page')) || 1);
  const [draft, setDraft] = useState(q);
  const [deleting, setDeleting] = useState<FbPost | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const posts = usePosts({ status, range, q: q || undefined, account: account || undefined, page });
  const data = posts.data;

  /** Changes one filter and keeps the others; any change goes back to the first page. */
  const go = (patch: Record<string, string>) => {
    const next = new URLSearchParams(search.toString());
    next.delete('page');
    for (const [k, v] of Object.entries(patch)) {
      if (v === '' || v === 'all') next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  const refresh = () => qc.invalidateQueries({ queryKey: KEYS.all });
  const publish = async (p: FbPost) => {
    setBusy(p.id);
    try {
      const res = await publishPost(p.id);
      toast(
        res.status === 'failed' ? t('rejected', { error: res.error ?? '' }) : t('published'),
        res.status === 'failed' ? 'danger' : 'success',
      );
      await refresh();
    } catch (e) {
      toast(message(e, t('failed')), 'danger');
    } finally {
      setBusy(null);
    }
  };
  const remove = async (p: FbPost) => {
    setBusy(p.id);
    try {
      await deletePost(p.id);
      toast(t('removed'), 'success');
      await refresh();
    } catch (e) {
      toast(message(e, t('failed')), 'danger');
    } finally {
      setBusy(null);
    }
  };

  const pages = data?.pages ?? [];
  const total = data?.typeCounts.all ?? 0;
  const counts = data?.counts ?? { scheduled: 0, published: 0, failed: 0 };
  const tabCount: Record<Status, number> = { all: total, ...counts };
  const kpi = [
    { label: t('kpi.total'), n: total, tone: 'border-border' },
    { label: t('kpi.scheduled'), n: counts.scheduled, tone: 'border-warning/40' },
    { label: t('kpi.published'), n: counts.published, tone: 'border-success/40' },
    { label: t('kpi.failed'), n: counts.failed, tone: 'border-danger/40', bad: counts.failed > 0 },
  ];

  return (
    <main className="mx-auto max-w-none space-y-6 px-4 py-7 sm:px-6 lg:px-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('kicker')}
          </div>
          <h1 className="text-3xl font-normal leading-none tracking-tight sm:text-[40px]">
            {t('title')} <span className="italic text-brand">{t('titleAccent')}</span>
          </h1>
          <p className="mt-2 max-w-xl text-[13px] text-muted-foreground">{t('intro')}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {pages.length > 1 && (
            <PageSelect
              pages={pages}
              value={account}
              allLabel={t('allPages')}
              label={t('pagePicker')}
              onChange={(id) => go({ account: id })}
            />
          )}
          <Link href="/facebook/my-posts" className={linkBtn}>
            <GridIcon className="size-3.5" />
            {t('myPosts')}
          </Link>
          <Link href="/facebook/insights" className={linkBtn}>
            {t('insights')}
          </Link>
          {canManage && (
            <Link
              href="/facebook/posts/create"
              className="inline-flex h-9 items-center gap-2 rounded-full bg-brand px-4 text-xs font-semibold text-white"
            >
              <PlusIcon className="size-3.5" />
              {t('create')}
            </Link>
          )}
        </div>
      </div>

      {posts.isError && <Alert tone="danger">{t('loadError')}</Alert>}

      {posts.isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : pages.length === 0 ? (
        <div className="rounded-2xl border border-border bg-background p-10 text-center shadow-sm">
          <span
            className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl text-white"
            style={{ background: FB_BLUE }}
          >
            <FacebookGlyph className="size-6" />
          </span>
          <div className="text-sm font-semibold">{t('noPage')}</div>
          <p className="mb-4 mt-1 text-[12.5px] text-muted-foreground">{t('noPageHint')}</p>
          <Link
            href="/facebook"
            className="inline-flex rounded-full bg-brand px-4 py-2 text-[12.5px] font-semibold text-white"
          >
            {t('connect')}
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {kpi.map((k) => (
              <div
                key={k.label}
                className={cn('rounded-2xl border bg-background p-4 shadow-sm', k.tone)}
              >
                <div className="text-[11px] font-medium text-muted-foreground">{k.label}</div>
                <div className={cn('mt-1 text-[34px] leading-none', k.bad && 'text-danger')}>
                  {formatCount(k.n)}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-border bg-background p-2 shadow-sm">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => go({ status: s })}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-4 py-[7px] text-[13px] transition',
                  status === s ? 'bg-brand text-white' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {t(`tabs.${s}`)}
                <span
                  className={cn(
                    'font-mono text-[11px]',
                    status === s ? 'opacity-90' : 'text-muted-foreground/70',
                  )}
                >
                  {formatCount(tabCount[s])}
                </span>
              </button>
            ))}
            <div className="flex-1" />
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => go({ range: r })}
                className={cn(
                  'inline-flex items-center rounded-full px-3 py-[7px] text-xs transition',
                  range === r
                    ? 'bg-brand/10 font-semibold text-brand'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {t(`ranges.${r}`)}
              </button>
            ))}
            <form
              className="relative ml-1"
              onSubmit={(e) => {
                e.preventDefault();
                go({ q: draft.trim() });
              }}
            >
              <SearchIcon className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t('search')}
                aria-label={t('search')}
                className="w-full rounded-full border border-border bg-background py-1.5 pl-9 pr-3 text-xs outline-none focus:border-brand lg:w-60"
              />
            </form>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    {(['post', 'page', 'type', 'status', 'when'] as const).map((c) => (
                      <th key={c} className="px-4 py-3 font-medium">
                        {t(`cols.${c}`)}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-right font-medium">{t('cols.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(data?.data ?? []).map((p) => {
                    const when =
                      p.status === 'scheduled' && p.scheduledPublishTime
                        ? p.scheduledPublishTime
                        : (p.publishedAt ?? p.createdAt);
                    const text = p.message || p.link || `[${p.type.replace('_', ' ')}]`;
                    return (
                      <tr key={p.id} className="hover:bg-muted/40">
                        <td className="px-4 py-3">
                          <div className="flex max-w-[420px] min-w-0 items-center gap-3">
                            {p.photos[0] ? (
                              <img
                                src={p.photos[0]}
                                alt=""
                                referrerPolicy="no-referrer"
                                className="size-10 shrink-0 rounded-lg border border-border bg-muted object-cover"
                              />
                            ) : (
                              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                                <ImageIcon className="size-4" />
                              </span>
                            )}
                            <span className="min-w-0">
                              <span className="line-clamp-1 block">{text}</span>
                              {p.error && (
                                <span
                                  className="line-clamp-1 block text-[10.5px] text-danger"
                                  title={p.error}
                                >
                                  {shorten(p.error, 80)}
                                </span>
                              )}
                            </span>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                          {p.pageName || '—'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 capitalize text-muted-foreground">
                          {p.type.replace('_', ' ')}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              'inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10.5px]',
                              PILL[p.status],
                            )}
                          >
                            {t(`status.${p.status}`)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                          {relativeTime(when, new Date())}
                        </td>
                        <td className="px-4 py-3">
                          {canManage && (
                            <div className="flex items-center justify-end gap-1">
                              {(p.status === 'failed' || p.status === 'draft') && (
                                <button
                                  type="button"
                                  title={t('publishNow')}
                                  aria-label={t('publishNow')}
                                  disabled={busy === p.id}
                                  onClick={() => void publish(p)}
                                  className="grid size-8 place-items-center rounded-lg text-brand transition hover:bg-brand/10 disabled:opacity-50"
                                >
                                  <SendIcon className="size-4" />
                                </button>
                              )}
                              <button
                                type="button"
                                title={t('delete')}
                                aria-label={t('delete')}
                                disabled={busy === p.id}
                                onClick={() => setDeleting(p)}
                                className="grid size-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                              >
                                <TrashIcon className="size-4" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {(data?.data.length ?? 0) === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-16 text-center">
                        <div className="text-[13px] font-semibold">
                          {total > 0 ? t('noMatch') : t('none')}
                        </div>
                        <p className="mb-3 mt-1 text-xs text-muted-foreground">{t('noneHint')}</p>
                        {canManage && (
                          <Link
                            href="/facebook/posts/create"
                            className="inline-flex rounded-full bg-brand px-4 py-2 text-[12.5px] font-semibold text-white"
                          >
                            {t('create')}
                          </Link>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {data && data.meta.lastPage > 1 && (
              <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground">
                <span>{t('pageOf', { page: data.meta.page, last: data.meta.lastPage })}</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={data.meta.page <= 1}
                    onClick={() =>
                      router.replace(
                        `${pathname}?${new URLSearchParams({ ...Object.fromEntries(search), page: String(data.meta.page - 1) })}`,
                      )
                    }
                    className="rounded-full border border-border px-3 py-1 hover:bg-muted disabled:opacity-40"
                  >
                    {t('prev')}
                  </button>
                  <button
                    type="button"
                    disabled={data.meta.page >= data.meta.lastPage}
                    onClick={() =>
                      router.replace(
                        `${pathname}?${new URLSearchParams({ ...Object.fromEntries(search), page: String(data.meta.page + 1) })}`,
                      )
                    }
                    className="rounded-full border border-border px-3 py-1 hover:bg-muted disabled:opacity-40"
                  >
                    {t('next')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        title={t('deleteTitle')}
        message={deleting?.status === 'published' ? t('deleteLive') : t('deleteLocal')}
        confirmLabel={t('deleteYes')}
        cancelLabel={t('cancel')}
        busy={busy !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          const p = deleting;
          setDeleting(null);
          if (p) void remove(p);
        }}
      />
    </main>
  );
}
