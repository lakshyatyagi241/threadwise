'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert, Modal, Spinner } from '@crm/ui';
import type { FbFeedItem } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useMyPosts } from '../api/facebook';
import { relativeTime, shorten } from '../lib/format';
import { ListIcon, PlusIcon } from './fb-icons';
import { PageSelect } from './page-select';

const linkBtn =
  'inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-background px-4 text-xs font-medium transition hover:bg-muted';

/** `/facebook/my-posts` (TW-FB-018): the Page's newest published posts as a tile grid, live from Facebook. Tap a tile to preview it. */
export function MyPostsScreen() {
  const t = useTranslations('facebook.grid');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const canManage = useCan('fb.posts.manage');
  const feed = useMyPosts(search.get('page') ?? undefined);
  const [open, setOpen] = useState<FbFeedItem | null>(null);
  const data = feed.data;
  const page = data?.page ?? null;
  const items = data?.items ?? [];

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-7">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('kicker')}
          </div>
          <h1 className="mt-0.5 text-[28px] leading-tight">
            {t('title')} <span className="not-italic text-brand">{t('titleAccent')}</span>
          </h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">{t('intro')}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link href="/facebook/posts" className={linkBtn}>
            <ListIcon className="size-3.5" />
            {t('posts')}
          </Link>
          {canManage && (
            <Link
              href="/facebook/posts/create"
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-brand px-4 text-xs font-semibold text-white"
            >
              <PlusIcon className="size-3.5" />
              {t('newPost')}
            </Link>
          )}
          {data && data.pages.length > 1 && page && (
            <PageSelect
              pages={data.pages}
              value={page.id}
              label={t('pagePicker')}
              onChange={(id) => router.replace(`${pathname}?page=${id}`)}
            />
          )}
        </div>
      </div>

      {feed.isError && <Alert tone="danger">{t('loadError')}</Alert>}

      {feed.isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : !page ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/40 p-10 text-center">
          <div className="text-sm font-semibold">{t('noPage')}</div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">{t('noPageHint')}</p>
          <Link
            href="/facebook"
            className="mt-3 inline-block rounded-full bg-brand px-4 py-2 text-[12.5px] font-semibold text-white"
          >
            {t('goHub')}
          </Link>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/40 p-14 text-center">
          <div className="text-sm font-semibold">{t('empty')}</div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">{t('emptyHint')}</p>
          <Link
            href="/facebook/posts"
            className="mt-3 inline-block rounded-full bg-brand px-4 py-2 text-[12.5px] font-semibold text-white"
          >
            {t('firstPost')}
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setOpen(m)}
              className="group relative block aspect-square overflow-hidden rounded-lg border border-border bg-muted"
            >
              {m.picture ? (
                <img
                  src={m.picture}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="size-full object-cover"
                />
              ) : (
                <span className="grid size-full place-items-center p-3 text-center">
                  <span className="line-clamp-4 text-[11.5px] text-muted-foreground">
                    {shorten(m.message || t('noCaption'), 90)}
                  </span>
                </span>
              )}
              <div className="absolute inset-0 flex items-end bg-black/0 p-3 text-white opacity-0 transition group-hover:bg-black/45 group-hover:opacity-100">
                <span className="line-clamp-3 text-[11.5px] leading-snug">
                  {shorten(m.message, 100) || t('view')}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      <Modal
        open={open !== null}
        onClose={() => setOpen(null)}
        size="lg"
        closeLabel={t('close')}
        title={page?.name || t('postTitle')}
      >
        {open && (
          <div className="flex flex-col gap-4 md:flex-row">
            <div className="flex min-h-48 flex-1 items-center justify-center overflow-hidden rounded-xl bg-black">
              {open.picture ? (
                <img
                  src={open.picture}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="max-h-[60vh] w-full object-contain"
                />
              ) : (
                <span className="p-6 text-center text-sm text-white/70">{t('noImage')}</span>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                {open.message || t('noCaption')}
              </p>
              <div className="font-mono text-[11px] text-muted-foreground">
                {relativeTime(open.createdTime, new Date())}
              </div>
              {open.permalinkUrl && (
                <a
                  href={open.permalinkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-fit rounded-full bg-brand px-4 py-2 text-[12.5px] font-semibold text-white"
                >
                  {t('viewOnFacebook')}
                </a>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
