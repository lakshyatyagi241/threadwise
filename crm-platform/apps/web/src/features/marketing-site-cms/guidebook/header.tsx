import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

/** The sub-header of the help centre: back button, breadcrumb, title and the "ask support" button (Reference's guidebook header). */
export async function GuidebookHeader({
  backHref,
  crumbs,
  title,
  accent,
  rest,
}: {
  backHref: string;
  crumbs: string;
  /** The title is the accent word in italics followed by `rest`. */
  title?: string;
  accent: string;
  rest?: string;
}) {
  const t = await getTranslations('marketing-site-cms.guidebook');
  void title;
  return (
    <div className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-none items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={backHref}
            title={t('back')}
            aria-label={t('back')}
            className="flex size-8 items-center justify-center rounded-full border border-border bg-background hover:bg-muted"
          >
            <svg
              viewBox="0 0 16 16"
              className="size-3.5"
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
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3.5 py-1.5 text-[12px] font-medium hover:bg-muted"
        >
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
          {t('askSupport')}
        </Link>
      </div>
    </div>
  );
}
