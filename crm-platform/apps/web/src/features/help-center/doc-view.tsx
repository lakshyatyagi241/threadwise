import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { DocBody } from './doc-body';
import { HashFocus } from './hash-focus';
import type { HelpArea, HelpBlock, HelpIndexEntry } from './types';

interface DocViewProps {
  id: string;
  area: HelpArea;
  title: string;
  summary: string;
  blocks: readonly HelpBlock[];
  /** English is shown because the person's language has no translation of this guide. */
  fallback: boolean;
  /** The guides this person may see: the sidebar lists the ones in this area; links to any other guide read as plain text. */
  entries: readonly HelpIndexEntry[];
  /** The screen this guide explains, when there is one the person can open. */
  screenHref?: string;
}

/**
 * One guide, laid out like a help desk article: the area's guides in a sidebar, the article in the middle with its summary and
 * body, and an "On this page" outline beside it on wide screens. The sidebar and outline collapse above the article on phones.
 */
export function DocView({
  id,
  area,
  title,
  summary,
  blocks,
  fallback,
  entries,
  screenHref,
}: DocViewProps) {
  const t = useTranslations('help');
  const visibleIds = new Set(entries.map((entry) => entry.id));
  const headings = blocks.flatMap((b) => (b.t === 'h' ? [b] : []));
  const inArea = entries.filter((e) => e.area === area);

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)_12rem]">
      <aside aria-label={t(`areas.${area}`)} className="lg:sticky lg:top-20 lg:self-start">
        <Link
          href="/help"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:underline"
        >
          ← {t('allHelp')}
        </Link>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {t(`areas.${area}`)}
        </p>
        <ul className="space-y-0.5">
          {inArea.map((entry) => (
            <li key={entry.id}>
              <Link
                href={`/help/${entry.id}`}
                aria-current={entry.id === id ? 'page' : undefined}
                className={cn(
                  'block rounded-lg px-3 py-1.5 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-primary',
                  entry.id === id
                    ? 'bg-primary/10 font-semibold text-primary'
                    : 'text-foreground hover:bg-muted',
                )}
              >
                {entry.title}
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <article className="min-w-0 space-y-8">
        <header className="space-y-3 border-b border-border pb-6">
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="text-base leading-7 text-muted-foreground">{summary}</p>
          {screenHref && (
            <Link
              href={screenHref}
              className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {t('openScreen')}
            </Link>
          )}
        </header>
        {fallback && (
          <div
            role="note"
            className="rounded-xl border border-border bg-muted px-4 py-3 text-sm text-muted-foreground"
          >
            {t('shownInEnglish')}
          </div>
        )}
        {headings.length >= 2 && (
          <nav
            aria-label={t('onThisPage')}
            className="rounded-xl border border-border px-5 py-4 xl:hidden"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {t('onThisPage')}
            </div>
            <ul className="mt-2 space-y-1 text-sm">
              {headings.map((h) => (
                <li key={h.id} className={cn(h.level === 3 && 'ps-4')}>
                  <a href={`#${h.id}`} className="text-primary underline-offset-2 hover:underline">
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <DocBody blocks={blocks} visibleIds={visibleIds} />
        <HashFocus />
      </article>

      {headings.length >= 2 && (
        <nav
          aria-label={t('onThisPage')}
          className="hidden xl:sticky xl:top-20 xl:block xl:self-start"
        >
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {t('onThisPage')}
          </div>
          <ul className="space-y-1 border-s border-border text-sm">
            {headings.map((h) => (
              <li key={h.id} className={cn(h.level === 3 && 'ps-3')}>
                <a
                  href={`#${h.id}`}
                  className="-ms-px block border-s-2 border-transparent ps-3 text-muted-foreground transition hover:border-primary hover:text-foreground"
                >
                  {h.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
