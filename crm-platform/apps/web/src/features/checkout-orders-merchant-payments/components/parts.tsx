'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, type ComponentProps, type ReactNode } from 'react';
import { Alert, Button, EmptyState, Spinner, cn } from '@crm/ui';
import { useStoreOverview } from '@/features/storefront-builder';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { errorKind } from '../lib/errors';
import { TONE_CLASS, orderTone, paymentTone, type Tone } from '../lib/status';

/** The selected shop of the store area (`?shop=`), or undefined: the sidebar and every screen read the same address. */
export function useShopParam(): string | undefined {
  return useSearchParams().get('shop') ?? undefined;
}

/**
 * The shop the sidebar shows plus the shop list, from the store overview (the same cache entry as the sidebar's, so it costs no extra
 * request). Used for the shop pickers (gateway scope, coupon scope, orders shop filter) and the shop's currency.
 */
export function useStoreShops(shopParam: string | undefined) {
  return useStoreOverview(shopParam);
}

/** The caller's permissions on one resource of the store, by action: `can('manage')` is `store.<resource>.manage`. */
export function useStoreCan(resource: string) {
  const read = useCan(`store.${resource}.${resource === 'payments' ? 'view' : 'read'}`);
  const manage = useCan(`store.${resource}.manage`);
  const del = useCan(`store.${resource}.delete`);
  return { read, manage, delete: del };
}

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

/** Small caps label above a title or a field group (the store area's section eyebrow). */
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

/** The title block of a screen: eyebrow, h1, a line under it and the page's main actions on the end side. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A failed load: what happened in words chosen by error code, the request id for support, and a retry. */
export function ErrorPanel({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useTranslations('checkout-orders-merchant-payments.errors');
  const kind = errorKind(error);
  return (
    <Alert tone="danger" className="space-y-2">
      <div className="font-medium">{t(`${kind}.title`)}</div>
      <p className="text-sm">{t(`${kind}.message`)}</p>
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
  const t = useTranslations('checkout-orders-merchant-payments.errors');
  return (error: unknown) => t(`${errorKind(error)}.message`);
}

/** The caller may not open this screen. */
export function NoAccess() {
  const t = useTranslations('checkout-orders-merchant-payments.common');
  return <EmptyState title={t('noAccessTitle')} message={t('noAccessMessage')} />;
}

/** The status, source and payment pills: the same look on every screen. Labels are translated; an unknown value shows as it came. */
export function ToneBadge({
  tone,
  children,
  className,
  title,
  'data-testid': testId,
}: {
  tone: Tone;
  children: ReactNode;
  className?: string;
  title?: string;
  'data-testid'?: string;
}) {
  return (
    <span
      title={title}
      data-testid={testId}
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function OrderStatusBadge({ status }: { status: string }) {
  const t = useTranslations('checkout-orders-merchant-payments.status');
  return <ToneBadge tone={orderTone(status)}>{t.has(status) ? t(status) : status}</ToneBadge>;
}

export function PaymentStatusBadge({ status }: { status: string }) {
  const t = useTranslations('checkout-orders-merchant-payments.paymentStatus');
  return <ToneBadge tone={paymentTone(status)}>{t.has(status) ? t(status) : status}</ToneBadge>;
}

export function SourceBadge({ source }: { source: string }) {
  const t = useTranslations('checkout-orders-merchant-payments.source');
  return <ToneBadge tone="neutral">{t.has(source) ? t(source) : source}</ToneBadge>;
}

/** "Load more" under a cursor list; shows a spinner while the next page loads. */
export function LoadMore({
  hasMore,
  loading,
  onMore,
}: {
  hasMore: boolean;
  loading: boolean;
  onMore: () => void;
}) {
  const t = useTranslations('checkout-orders-merchant-payments.common');
  if (!hasMore) return null;
  return (
    <div className="flex justify-center pt-3">
      <Button variant="secondary" onClick={onMore} disabled={loading}>
        {loading && <Spinner />}
        {t('loadMore')}
      </Button>
    </div>
  );
}

/** Table header cell with the right alignment for the reading direction. */
export function Th({
  children,
  end,
  className,
}: {
  children?: ReactNode;
  end?: boolean;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider',
        end ? 'text-end' : 'text-start',
        className,
      )}
    >
      {children}
    </th>
  );
}

/** Rows of grey bars while a table loads. */
export function TableSkeleton({ rows = 6, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12" />
      ))}
    </div>
  );
}

/**
 * A panel that slides in from the end side (right in English, left in Arabic) over the page: details of one row. Built on the
 * native <dialog> so focus is trapped and restored and Escape closes it; the backdrop click closes it too.
 */
export function Drawer({
  open,
  onClose,
  title,
  eyebrow,
  closeLabel,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  closeLabel: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        'm-0 ms-auto h-dvh max-h-none w-[min(32rem,100vw)] max-w-none overflow-hidden border-s border-border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50',
      )}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            {eyebrow && <Eyebrow className="mb-1">{eyebrow}</Eyebrow>}
            <h2 id={titleId} className="truncate text-lg font-semibold">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="-me-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </dialog>
  );
}
