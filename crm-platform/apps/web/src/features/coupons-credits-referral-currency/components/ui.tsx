'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Alert, Button, Spinner, Switch, cn } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { pageWindow } from '../lib/format';

const NS = 'coupons-credits-referral-currency.common';

export interface Crumb {
  label: string;
  href?: string;
}

/** The "Admin > Coupons > New" trail Reference shows above every admin page. */
export function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <nav
      aria-label={items.map((i) => i.label).join(' / ')}
      className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground"
    >
      {items.map((c, i) => (
        <span key={`${c.label}-${i}`} className="flex items-center gap-2">
          {i > 0 && (
            <svg
              viewBox="0 0 12 12"
              className="size-2.5 rtl:-scale-x-100"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="M4 3l3 3-3 3" />
            </svg>
          )}
          {c.href ? (
            <Link
              href={c.href}
              className={
                i === 0
                  ? 'uppercase tracking-[0.16em] hover:text-foreground'
                  : 'hover:text-foreground'
              }
            >
              {c.label}
            </Link>
          ) : (
            <span className="text-foreground">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

/** The italic, accented word in a serif page title ("Discount *coupons*"). */
export function Accent({ children }: { children: ReactNode }) {
  return <span className="italic text-primary">{children}</span>;
}

/** Breadcrumb, eyebrow, serif title, one line of explanation and the page's actions; stacks on narrow screens. */
export function PageHead({
  crumbs,
  eyebrow,
  title,
  description,
  actions,
  mono,
}: {
  crumbs?: Crumb[];
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** The edit page's title is the coupon code itself, in monospace. */
  mono?: boolean;
}) {
  return (
    <header className="space-y-5">
      {crumbs && <Crumbs items={crumbs} />}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          {eyebrow && (
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {eyebrow}
            </p>
          )}
          <h1
            className={cn(
              'font-serif text-[28px] font-normal leading-none tracking-[-0.01em] sm:text-[40px]',
              mono && 'break-all font-mono sm:text-[36px]',
            )}
          >
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-2xl text-[13px] text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 pb-1">{actions}</div>
        )}
      </div>
    </header>
  );
}

/** The pill link Reference uses for "New coupon", "New package". */
export function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground hover:opacity-90"
    >
      <svg
        viewBox="0 0 16 16"
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M8 3v10M3 8h10" />
      </svg>
      {children}
    </Link>
  );
}

export function LoadingBlock() {
  const t = useTranslations(NS);
  return (
    <div className="flex min-h-40 items-center justify-center text-muted-foreground">
      <Spinner label={t('loading')} />
      <span className="ms-2 text-sm">{t('loading')}</span>
    </div>
  );
}

/** An API failure: a friendly sentence, the request id for support, and a retry. */
export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useTranslations(NS);
  const api = error instanceof ApiError ? error : null;
  const message =
    api?.status === 403
      ? t('errors.forbidden')
      : api && api.status < 500
        ? t('errors.request')
        : t('errors.unexpected');
  return (
    <Alert tone="danger" className="space-y-2">
      <p>{message}</p>
      {api?.requestId && (
        <p className="text-xs opacity-80">
          {t('requestId')}: <span className="font-mono">{api.requestId}</span>
        </p>
      )}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
    </Alert>
  );
}

/** A numbered form card ("01 Identity"), as Reference's four-section forms. */
export function Section({
  n,
  title,
  children,
  className,
}: {
  n: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn('rounded-[14px] border border-border bg-background p-5 shadow-sm', className)}
    >
      <div className="mb-4 flex items-center gap-2.5">
        <span className="inline-flex size-[23px] shrink-0 items-center justify-center rounded-[7px] bg-muted font-mono text-[10px] font-semibold text-primary">
          {n}
        </span>
        <h2 className="font-serif text-lg leading-none">{title}</h2>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** A bordered row with a title, a hint and a switch (the Active / Featured / First purchase toggles). */
export function SwitchRow({
  title,
  hint,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
      <span>
        <span className="block text-[12.5px] font-semibold">{title}</span>
        <span className="block text-[10.5px] text-muted-foreground">{hint}</span>
      </span>
      <Switch label={title} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

export const LABEL = 'mb-1.5 block text-[11.5px] font-semibold';
export const HINT = 'mt-1 text-[10.5px] text-muted-foreground';
export const INPUT = 'h-auto py-2 text-[12.5px]';

/** The coral "Please fix the following" box. */
export function Problems({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Alert tone="danger">
      <p className="mb-1 font-semibold">{title}</p>
      <ul className="list-disc ps-5">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </Alert>
  );
}

/** A pill like Reference's Active / Disabled marker. */
export function StatusPill({ active, on, off }: { active: boolean; on: string; off: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-medium',
        active
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border bg-muted text-muted-foreground',
      )}
    >
      {active && <span className="size-1.5 rounded-full bg-primary" />}
      {active ? on : off}
    </span>
  );
}

function PagerButton({
  children,
  label,
  onClick,
  disabled,
  current,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  current?: boolean;
}) {
  return (
    <Button
      size="sm"
      variant={current ? 'primary' : 'secondary'}
      aria-label={label}
      aria-current={current ? 'page' : undefined}
      disabled={disabled}
      onClick={onClick}
      className="min-w-8 rounded-lg px-2 font-mono text-xs"
    >
      {children}
    </Button>
  );
}

/** Previous, the page numbers around the current one (one either side, as Reference's paginator) and Next. Flips in RTL. */
export function Pager({
  page,
  pageCount,
  onGo,
  labels,
}: {
  page: number;
  pageCount: number;
  onGo: (page: number) => void;
  labels: { nav: string; previous: string; next: string; page: (n: number) => string };
}) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label={labels.nav} className="flex items-center gap-1">
      <PagerButton disabled={page <= 1} onClick={() => onGo(page - 1)} label={labels.previous}>
        <span aria-hidden="true" className="rtl:hidden">
          ‹
        </span>
        <span aria-hidden="true" className="hidden rtl:inline">
          ›
        </span>
      </PagerButton>
      {pageWindow(page, pageCount).map((n, i) =>
        n === null ? (
          <span key={`gap-${i}`} className="px-1 text-muted-foreground">
            …
          </span>
        ) : (
          <PagerButton key={n} current={n === page} onClick={() => onGo(n)} label={labels.page(n)}>
            {n}
          </PagerButton>
        ),
      )}
      <PagerButton disabled={page >= pageCount} onClick={() => onGo(page + 1)} label={labels.next}>
        <span aria-hidden="true" className="rtl:hidden">
          ›
        </span>
        <span aria-hidden="true" className="hidden rtl:inline">
          ‹
        </span>
      </PagerButton>
    </nav>
  );
}
