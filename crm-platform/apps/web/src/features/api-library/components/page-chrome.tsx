import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@crm/ui';
import { ArrowLeftIcon } from './icons';

/**
 * The frame shared by every API Library screen: a header that stays under the top bar while the page scrolls (it reaches the
 * shell's padding on both sides, so nothing shows through the gap), then the content at the full width of the shell.
 */
export function PageHeader({
  icon,
  title,
  subtitle,
  back,
  status,
  actions,
}: {
  icon: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** An arrow button before the icon and title: where "back" goes, and its name (also its tooltip), e.g. "Back to API Library". */
  back?: { href: string; label: string };
  /** Small live state next to the title (unsaved changes). */
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="sticky top-14 z-30 -mx-4 -mt-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:-mx-6 md:-mt-6 md:px-6">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          {back && (
            <Link
              href={back.href}
              aria-label={back.label}
              title={back.label}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <ArrowLeftIcon className="size-4 rtl:rotate-180" />
            </Link>
          )}
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground"
          >
            {icon}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="min-w-0 truncate text-xl font-bold tracking-tight">{title}</h1>
              {status}
            </div>
            {subtitle && (
              <p className="mt-0.5 hidden max-w-3xl text-sm text-muted-foreground sm:block">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
    </div>
  );
}

/** The bordered surface of a toolbar or a table. */
export const CARD = 'rounded-xl border border-border bg-background';

/** A link that looks like the UI kit's buttons (a navigation, so an anchor). */
export function LinkButton({
  href,
  variant = 'secondary',
  children,
  className,
}: {
  href: string;
  variant?: 'secondary' | 'brand';
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium outline-none transition',
        'focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        variant === 'brand'
          ? 'bg-brand text-brand-foreground hover:opacity-90'
          : 'border border-border bg-background text-foreground hover:bg-muted',
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** A titled card of the form: a header strip with the title, its help line and an optional control, then the body. */
export function SectionCard({
  title,
  hint,
  aside,
  children,
  id,
}: {
  title: ReactNode;
  hint?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn(CARD, 'overflow-hidden')}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border bg-muted/40 px-4 py-3">
        <div className="min-w-0">
          <h2 id={id} className="text-sm font-semibold">
            {title}
          </h2>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {aside}
      </div>
      <div className="space-y-4 p-4">{children}</div>
    </section>
  );
}
