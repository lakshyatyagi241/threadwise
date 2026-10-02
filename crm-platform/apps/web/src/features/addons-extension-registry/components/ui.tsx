'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Alert, Button, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';

const NS = 'addons-extension-registry.common';

export interface Crumb {
  label: string;
  href?: string;
}

/** The "Admin > Settings > Add-ons" trail Reference shows above every admin page. */
export function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <nav
      aria-label={items.map((i) => i.label).join(' / ')}
      className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground"
    >
      {items.map((c, i) => (
        <span key={c.label} className="flex items-center gap-2">
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

/** The italic, accented word in a serif page title ("Install an *add-on*."). */
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
}: {
  crumbs?: Crumb[];
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
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
          <h1 className="font-serif text-[28px] font-normal leading-none tracking-[-0.01em] sm:text-[40px]">
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
