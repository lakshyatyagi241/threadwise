'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ComponentProps, ReactNode } from 'react';
import { Alert, Button, cn } from '@crm/ui';
import { errorKind, requestIdOf } from '../lib/errors';

/** A link that looks like a `@crm/ui` button. */
export function LinkButton({
  variant = 'brand',
  className,
  ...rest
}: ComponentProps<typeof Link> & { variant?: 'brand' | 'secondary' | 'ghost' }) {
  const styles = {
    brand: 'bg-brand text-brand-foreground hover:opacity-90',
    secondary: 'border border-border bg-background text-foreground hover:bg-muted',
    ghost: 'text-foreground hover:bg-muted',
  } as const;
  return (
    <Link
      className={cn(
        'inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        styles[variant],
        className,
      )}
      {...rest}
    />
  );
}

/** Small mono caps label above a title or a field group (Reference's section eyebrow). */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'text-[11px] font-medium uppercase tracking-wider text-muted-foreground',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-muted', className)} />;
}

/** A failed load: what happened in words chosen by error code, the request id for support, and a retry. */
export function ErrorPanel({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useTranslations('storefront-builder.admin.errors');
  const kind = errorKind(error);
  const requestId = requestIdOf(error);
  return (
    <Alert tone="danger" className="space-y-2">
      <div className="font-medium">{t(`${kind}.title`)}</div>
      <p className="text-sm">{t(`${kind}.message`)}</p>
      {requestId && (
        <p className="text-xs opacity-80">
          {t('requestId')} <span className="font-mono">{requestId}</span>
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

/** One line for a failed save: the error kind's short message. */
export function useErrorLine() {
  const t = useTranslations('storefront-builder.admin.errors');
  return (error: unknown) => t(`${errorKind(error)}.message`);
}
