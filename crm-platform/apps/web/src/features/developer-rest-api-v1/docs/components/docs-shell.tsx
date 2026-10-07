'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@crm/ui';
import { filterReference, type ReferenceView } from '../lib/spec-model';
import { EndpointCard, verbText } from './endpoint-card';
import { CARD, EYEBROW } from './docs-parts';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

/**
 * The page body below the top bar (WD-API-149): the sidebar (endpoint filter, "Start here" links, the endpoint list by group) and the
 * main column. `intro` is the server-rendered introduction and `children` the unavailable/empty notice; with a `reference` the main
 * column ends with the endpoint cards. The filter narrows both the sidebar and the cards. Below `lg` the list is hidden, the filter stays.
 */
export function DocsShell({
  reference,
  intro,
  notice,
  footer,
}: {
  reference: ReferenceView | null;
  intro: ReactNode;
  notice: ReactNode;
  footer: ReactNode;
}) {
  const t = useTranslations('developer-rest-api-v1-docs');
  const [query, setQuery] = useState('');
  const shown = useMemo(
    () => (reference ? filterReference(reference, query) : null),
    [reference, query],
  );
  const [active, setActive] = useState<string | null>(null);

  // The sidebar link of the endpoint nearest the top of the screen is highlighted as the reader scrolls.
  useEffect(() => {
    if (!shown || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const en of entries) if (en.isIntersecting) setActive(en.target.id);
      },
      { rootMargin: '-70px 0px -70% 0px' },
    );
    document.querySelectorAll('[data-endpoint]').forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [shown]);

  const link = (href: string, label: string) => (
    <a
      href={href}
      className={cn('block rounded-lg px-2.5 py-1.5 text-[12.5px] hover:bg-muted', FOCUS)}
    >
      {label}
    </a>
  );

  return (
    <div className="flex flex-col lg:flex-row lg:items-start">
      <aside className="shrink-0 border-border px-4 pb-2 pt-4 lg:sticky lg:top-[61px] lg:h-[calc(100vh-61px)] lg:w-72 lg:overflow-y-auto lg:border-e lg:px-4 lg:pb-16 lg:pt-5">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t('sidebar.filterLabel')}
          placeholder={t('sidebar.filterPlaceholder')}
          autoComplete="off"
          className="mb-4 w-full rounded-[10px] border border-border bg-background px-3 py-2 text-[12.5px] focus-visible:border-brand focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/10"
        />
        <nav aria-label={t('sidebar.label')} className="hidden lg:block">
          <div className="mb-4">
            <div className={cn(EYEBROW, 'mb-2 ms-2')}>{t('sidebar.startHere')}</div>
            {link('#intro', t('sidebar.intro'))}
            {link('#auth', t('sidebar.auth'))}
            {link('#webhooks-info', t('sidebar.webhooks'))}
          </div>
          {shown?.groups.map((g) => (
            <div key={g.id} className="mb-4">
              <div className={cn(EYEBROW, 'mb-2 ms-2')}>{g.tag}</div>
              {g.endpoints.map((e) => (
                <a
                  key={e.id}
                  href={`#${e.id}`}
                  aria-current={active === e.id ? 'location' : undefined}
                  className={cn(
                    'mb-px flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] hover:bg-muted',
                    active === e.id && 'bg-muted font-semibold text-brand',
                    FOCUS,
                  )}
                >
                  <span
                    dir="ltr"
                    className={cn(
                      'w-11 shrink-0 text-end font-mono text-[9px] font-bold uppercase',
                      verbText[e.method],
                    )}
                  >
                    {e.method}
                  </span>
                  <span dir="ltr" className="truncate font-mono">
                    {e.prefix ? e.shortPath : e.path}
                  </span>
                </a>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 px-4 pb-24 pt-8 sm:px-8 lg:px-10">
        {intro}
        {reference === null ? (
          notice
        ) : (
          <section aria-labelledby="reference-title">
            <h2 id="reference-title" className="sr-only">
              {t('reference.title')}
            </h2>
            <p role="status" className="sr-only">
              {t('reference.count', { count: shown?.endpointCount ?? 0 })}
            </p>
            {shown && shown.groups.length === 0 ? (
              <div className={cn(CARD, 'text-center text-muted-foreground')}>
                <p>{t('reference.noMatch', { query: query.trim() })}</p>
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className={cn(
                    'mt-3 rounded-full border border-border px-3.5 py-2 text-xs font-semibold hover:border-brand',
                    FOCUS,
                  )}
                >
                  {t('reference.clearFilter')}
                </button>
              </div>
            ) : (
              shown?.groups.map((g) => (
                <div key={g.id} id={g.id} className="scroll-mt-20">
                  <div className="mb-3.5 mt-11">
                    <h2 className="m-0 text-2xl font-semibold">{g.tag}</h2>
                    {g.description && (
                      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                        {g.description}
                      </p>
                    )}
                  </div>
                  {g.endpoints.map((e) => (
                    <EndpointCard key={e.id} e={e} />
                  ))}
                </div>
              ))
            )}
          </section>
        )}
        {footer}
      </main>
    </div>
  );
}
