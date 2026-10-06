import Link from 'next/link';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import type { HelpArea } from './types';

/** One row of the category rail: an area that has guides for this person, and how many. */
export interface RailArea {
  area: HelpArea;
  count: number;
}

/** The address of the list limited to one area (the whole list when there is none). */
export const areaHref = (area?: HelpArea): string => (area ? `/help?area=${area}` : '/help');

const CIRCLE_QUESTION = (
  <svg
    viewBox="0 0 16 16"
    className="size-3.5"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden
  >
    <circle cx="8" cy="8" r="5.5" />
    <path d="M5.5 6.5a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M8 12.5h.01" />
  </svg>
);

/**
 * The band above the help center: round back button, a small crumb line, the title (its first words in the accent italic) and the
 * "ask support" button. The title is the page's one `h1`.
 */
export function HelpHeader({
  backHref,
  crumbs,
  accent,
  rest,
}: {
  backHref: string;
  crumbs: string;
  accent: string;
  rest?: string;
}) {
  const t = useTranslations('help');
  return (
    <div className="border-b border-border bg-background">
      <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={backHref}
            title={t('back')}
            aria-label={t('back')}
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-background outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
          >
            <svg
              viewBox="0 0 16 16"
              className="size-3.5 rtl:-scale-x-100"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden
            >
              <path d="M10 4l-4 4 4 4" />
            </svg>
          </Link>
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {crumbs}
            </div>
            <h1 className="truncate text-[20px] font-semibold leading-tight">
              <span className="italic text-primary">{accent}</span>
              {rest ? ` ${rest}` : ''}
            </h1>
          </div>
        </div>
        <Link
          href="/support"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-3.5 py-1.5 text-[12px] font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
        >
          {CIRCLE_QUESTION}
          <span className="hidden sm:inline">{t('askSupport')}</span>
          <span className="sm:hidden">{t('askSupportShort')}</span>
        </Link>
      </div>
    </div>
  );
}

/**
 * The category rail: "All guides" and one row per area with its count, then "Need a human?" with the support button. On a page
 * of one guide the area that guide belongs to is the current row.
 */
export function HelpRail({
  areas,
  total,
  active,
}: {
  areas: readonly RailArea[];
  total: number;
  active?: HelpArea;
}) {
  const t = useTranslations('help');
  const row = (href: string, label: string, count: number, on: boolean) => (
    <li key={href}>
      <Link
        href={href}
        aria-current={on ? 'page' : undefined}
        className={cn(
          'flex w-full items-center justify-between px-4 py-2.5 text-start outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
          on ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/60',
        )}
      >
        <span className={cn('truncate text-[13px]', on ? 'font-semibold' : 'font-medium')}>
          {label}
        </span>
        <span
          className={cn(
            'ms-2 font-mono text-[10.5px]',
            on ? 'rounded-full bg-primary-foreground/15 px-2 py-0.5' : 'text-muted-foreground',
          )}
        >
          {count}
        </span>
      </Link>
    </li>
  );
  return (
    <aside
      aria-label={t('categories')}
      className="overflow-hidden rounded-[14px] border border-border bg-background shadow-sm xl:sticky xl:top-5"
    >
      <div className="border-b border-border px-4 py-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {t('categories')}
        </div>
      </div>
      <ul className="divide-y divide-border">
        {row(areaHref(), t('allGuides'), total, !active)}
        {areas.map((a) => row(areaHref(a.area), t(`areas.${a.area}`), a.count, active === a.area))}
      </ul>
      <div className="border-t border-border bg-muted/40 p-4">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {t('needHuman')}
        </div>
        <Link
          href="/support"
          className="inline-flex items-center gap-2 rounded-full bg-primary px-3.5 py-2 text-[12px] font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <svg
            viewBox="0 0 16 16"
            className="size-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden
          >
            <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3h5A2.5 2.5 0 0 1 13 5.5v3A2.5 2.5 0 0 1 10.5 11H8l-3.5 2v-2A2.5 2.5 0 0 1 3 8.5v-3Z" />
          </svg>
          {t('contactSupport')}
        </Link>
      </div>
    </aside>
  );
}

/** The two-column frame of every help page: the rail, then the page's own content. */
export function HelpFrame({ rail, children }: { rail: ReactNode; children: ReactNode }) {
  return (
    <main className="px-4 py-6 sm:px-6 lg:px-7">
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
        {rail}
        <div className="min-w-0">{children}</div>
      </div>
    </main>
  );
}
