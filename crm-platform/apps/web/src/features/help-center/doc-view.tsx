import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { DocBody } from './doc-body';
import { HashFocus } from './hash-focus';
import { HelpFrame, HelpHeader, HelpRail, areaHref } from './help-frame';
import { HELP_AREAS, type HelpArea, type HelpBlock, type HelpIndexEntry } from './types';

interface DocViewProps {
  id: string;
  area: HelpArea;
  title: string;
  summary: string;
  blocks: readonly HelpBlock[];
  /** English is shown because the person's language has no translation of this guide. */
  fallback: boolean;
  /** The guides this person may see: the rail counts them, "More in this area" lists the area's others; links to any other guide read as plain text. */
  entries: readonly HelpIndexEntry[];
  /** The screen this guide explains, when there is one the person can open. */
  screenHref?: string;
}

const MORE = 4;

/**
 * One guide, laid out like the list: the header, the category rail with this guide's area marked, and the guide as a card with
 * its read time, summary, an "On this page" outline and the body, then the area's other guides.
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
  const rail = HELP_AREAS.map((a) => ({
    area: a,
    count: entries.filter((e) => e.area === a).length,
  })).filter((r) => r.count > 0);
  const minutes = entries.find((e) => e.id === id)?.readMinutes ?? 1;
  const more = entries.filter((e) => e.area === area && e.id !== id).slice(0, MORE);

  return (
    <>
      <HelpHeader
        backHref={areaHref(area)}
        crumbs={`${t('crumb')} / ${t(`areas.${area}`)}`}
        accent={title}
      />
      <HelpFrame rail={<HelpRail areas={rail} total={entries.length} active={area} />}>
        <article className="min-w-0 rounded-[14px] border border-border bg-background shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-4 py-5 sm:px-7">
            <Link
              href={areaHref(area)}
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary outline-none hover:underline focus-visible:underline"
            >
              <svg
                viewBox="0 0 16 16"
                className="size-3.5 rtl:-scale-x-100"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden
              >
                <path d="M10 4l-4 4 4 4" />
              </svg>
              {t('allHelp')}
            </Link>
            <span className="font-mono text-[11px] text-muted-foreground">
              {t('readMinutes', { count: minutes })}
            </span>
          </div>
          <div className="space-y-8 px-4 py-6 sm:px-7">
            <header className="space-y-3 border-b border-border pb-6">
              <Link
                href={areaHref(area)}
                className="inline-block rounded-full bg-wa-mint px-2 py-0.5 font-mono text-[10.5px] text-wa-deep"
              >
                {t(`areas.${area}`)}
              </Link>
              <h2 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
                {title}
              </h2>
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
                className="rounded-xl border border-border px-5 py-4"
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {t('onThisPage')}
                </div>
                <ul className="mt-2 space-y-1 text-sm">
                  {headings.map((h) => (
                    <li key={h.id} className={cn(h.level === 3 && 'ps-4')}>
                      <a
                        href={`#${h.id}`}
                        className="text-primary underline-offset-2 hover:underline focus-visible:underline"
                      >
                        {h.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
            <DocBody blocks={blocks} visibleIds={visibleIds} />
            <HashFocus />
          </div>
        </article>

        {more.length > 0 && (
          <section aria-labelledby="help-more" className="mt-6 space-y-3">
            <h2
              id="help-more"
              className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
            >
              {t('moreInArea', { area: t(`areas.${area}`) })}
            </h2>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {more.map((entry) => (
                <li key={entry.id}>
                  <Link
                    href={`/help/${entry.id}`}
                    className="group block h-full rounded-[14px] border border-border bg-background p-4 shadow-sm outline-none transition hover:border-primary hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="block text-[15px] font-semibold leading-tight group-hover:text-primary">
                      {entry.title}
                    </span>
                    <span className="mt-1 block text-[12.5px] leading-snug text-muted-foreground">
                      {entry.summary}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </HelpFrame>
    </>
  );
}
