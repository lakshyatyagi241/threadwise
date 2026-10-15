'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TemplateGalleryCategory, TemplateGalleryItem } from '@crm/contracts';
import { Button, EmptyState, Spinner, cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useDebounced, useTemplateGallery } from '../api/hooks';
import { galleryToState } from '../lib/gallery-state';
import { previewOf } from '../lib/form-model';
import { SearchIcon } from './icons';
import { MessageBubble } from './wa-bubble';

const CHIP =
  'whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

/** One default template: its name, the WhatsApp mock-up, and "Use this template" (on hover, and as a button on a small screen). */
function GalleryCard({ item, mayUse }: { item: TemplateGalleryItem; mayUse: boolean }) {
  const t = useTranslations('message-templates.gallery');
  const model = useMemo(() => previewOf(galleryToState(item)), [item]);
  const href = `/templates/new?gallery=${encodeURIComponent(item.id)}`;
  return (
    <article
      data-testid="gallery-card"
      data-template={item.id}
      className="group relative flex shrink-0 flex-col overflow-hidden rounded-[14px] border border-border bg-background shadow-sm transition hover:border-brand hover:shadow-md"
    >
      <h3 className="truncate bg-brand px-3.5 py-2.5 text-[12.5px] font-semibold text-brand-foreground">
        {item.name}
      </h3>
      <div className="flex flex-1 flex-col gap-1 bg-muted p-3">
        <MessageBubble model={model} />
      </div>
      {mayUse && (
        <>
          <Link
            href={href}
            aria-label={t('useNamed', { name: item.name })}
            className="m-3 rounded-full border border-brand py-2 text-center text-xs font-semibold text-brand hover:bg-brand hover:text-brand-foreground lg:hidden"
          >
            {t('use')}
          </Link>
          <Link
            href={href}
            aria-label={t('useNamed', { name: item.name })}
            className="absolute inset-0 hidden items-center justify-center bg-brand/15 opacity-0 backdrop-blur-[1px] transition focus-visible:opacity-100 group-hover:opacity-100 lg:flex"
          >
            <span className="rounded-full bg-brand px-5 py-2.5 text-xs font-semibold text-brand-foreground shadow-md">
              {t('use')}
            </span>
          </Link>
        </>
      )}
    </article>
  );
}

/**
 * The Template gallery tab: the default templates the backend offers (`GET /v2/templates/gallery`), in a column per use laid side by side in
 * one row that scrolls sideways (each column scrolls down on its own), with a category filter and search. They are not part of All, Marketing, Utility or
 * Authentication. "Use this template" opens the new-template form filled in from one.
 */
export function TemplateGalleryView() {
  const t = useTranslations('message-templates.gallery');
  const mayUse = useCan('tpl.templates.create');
  const [category, setCategory] = useState<'all' | TemplateGalleryCategory>('all');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 250);
  const gallery = useTemplateGallery({ category: category === 'all' ? undefined : category, q });

  const columns = useMemo(() => {
    const data = gallery.data;
    if (!data) return [];
    return data.categorieList
      .map((c) => ({ ...c, items: data.templateList.filter((x) => x.category === c.id) }))
      .filter((c) => c.items.length > 0);
  }, [gallery.data]);
  const categoryName = (id: string, fallback: string) =>
    t.has(`categories.${id}`) ? t(`categories.${id}`) : fallback;

  return (
    <section className="pb-4 pt-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label={t('categoryFilter')} className="flex flex-wrap gap-2">
          {[{ id: 'all' as const, name: t('all') }, ...(gallery.data?.categorieList ?? [])].map(
            (c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={category === c.id}
                onClick={() => setCategory(c.id)}
                className={cn(
                  CHIP,
                  category === c.id
                    ? 'border-brand bg-brand text-brand-foreground'
                    : 'border-border hover:bg-muted',
                )}
              >
                {c.id === 'all' ? c.name : categoryName(c.id, c.name)}
              </button>
            ),
          )}
        </div>
        <div className="relative shrink-0">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            className="h-10 w-64 rounded-full border border-border bg-background ps-9 pe-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
      </div>
      <p className="mb-4 max-w-2xl text-[13px] text-muted-foreground">{t('intro')}</p>

      {gallery.isPending ? (
        <div className="flex justify-center py-16">
          <Spinner label={t('loading')} />
        </div>
      ) : gallery.isError ? (
        <EmptyState
          title={t('loadError')}
          actions={
            <Button variant="secondary" onClick={() => void gallery.refetch()}>
              {t('retry')}
            </Button>
          }
        />
      ) : columns.length === 0 ? (
        <EmptyState title={t('empty')} message={t('emptyHint')} />
      ) : (
        <div
          data-testid="gallery-columns"
          role="region"
          tabIndex={0}
          aria-label={t('title')}
          className="flex items-start gap-5 overflow-x-scroll pb-4 [scrollbar-width:auto]"
        >
          {columns.map((c) => (
            <section
              key={c.id}
              aria-label={categoryName(c.id, c.name)}
              className="w-[19.5rem] shrink-0 rounded-2xl border border-border bg-muted/40"
            >
              <h3 className="flex items-center justify-between rounded-t-2xl border-b border-brand/20 bg-brand/10 px-4 py-3 text-[13px] font-semibold text-brand">
                {categoryName(c.id, c.name)}
                <span className="font-mono text-[11px] font-normal text-muted-foreground">
                  {t('count', { count: c.items.length })}
                </span>
              </h3>
              <div className="flex max-h-[62vh] flex-col gap-4 overflow-y-auto p-4">
                {c.items.map((item) => (
                  <GalleryCard key={item.id} item={item} mayUse={mayUse} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
