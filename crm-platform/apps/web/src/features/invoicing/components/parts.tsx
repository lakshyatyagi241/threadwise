'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, cn } from '@crm/ui';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import type { PaymentMethod } from '@crm/contracts';
import { todayKey } from '../lib/dates';
import { errorCode, errorKind, isRetryable, requestIdOf } from '../lib/errors';
import { formatMoney } from '../lib/money';
import { invoicingCan } from '../lib/permissions';
import type { DisplayStatus } from '../lib/status';
import { ContactIcon } from './icons';

/** The workspace's time zone (dates are cut there), or the viewer's when the workspace has none. */
export function useWorkspaceZone(): string | undefined {
  return useSession().org.timezone ?? undefined;
}

/** Today in the workspace's zone, refreshed every minute so "overdue" turns red at midnight without a reload. */
export function useToday(): string {
  const zone = useWorkspaceZone();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return todayKey(now, zone);
}

/** The workspace's currency (new invoices start in it), or USD when it has none. */
export function useDefaultCurrency(): string {
  return useSession().org.currency ?? 'USD';
}

/** What the signed-in person may do; the server stays the authority and answers 403 where it must. */
export function useInvoicingCan() {
  const { permissions } = useSession();
  return useMemo(() => invoicingCan(permissions), [permissions]);
}

/** An amount in its own currency, for the viewer's locale. */
export function Money({ minor, currency, className }: { minor: number; currency: string; className?: string }) {
  const locale = useLocale();
  return (
    <span dir="ltr" className={cn('tabular-nums', className)}>
      {formatMoney(minor, currency, locale)}
    </span>
  );
}

const STATUS_TONE: Record<DisplayStatus, string> = {
  draft: 'border-border bg-muted text-muted-foreground',
  issued: 'border-primary/30 bg-primary/10 text-primary',
  partially_paid: 'border-warning/30 bg-warning/10 text-warning',
  overdue: 'border-danger/30 bg-danger/10 text-danger',
  paid: 'border-success/30 bg-success/10 text-success',
  void: 'border-border bg-muted text-muted-foreground line-through decoration-muted-foreground/60',
};
const STATUS_DOT: Record<DisplayStatus, string> = {
  draft: 'bg-muted-foreground',
  issued: 'bg-primary',
  partially_paid: 'bg-warning',
  overdue: 'bg-danger',
  paid: 'bg-success',
  void: 'bg-muted-foreground',
};

/** The status chip: colour and wording of one of the six states. */
export function StatusChip({ status, className }: { status: DisplayStatus; className?: string }) {
  const t = useTranslations('invoicing.status');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        STATUS_TONE[status],
        className,
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', STATUS_DOT[status])} />
      {t(status)}
    </span>
  );
}

const METHOD_TONE: Record<PaymentMethod, string> = {
  bank: 'border-primary/30 bg-primary/10 text-primary',
  manual: 'border-border bg-muted text-foreground',
  wa_pay: 'border-success/30 bg-success/10 text-success',
  storefront: 'border-brand/30 bg-brand/10 text-brand dark:text-primary',
  cash: 'border-success/30 bg-success/10 text-success',
  card: 'border-warning/30 bg-warning/10 text-warning',
  upi: 'border-brand/30 bg-brand/10 text-brand dark:text-primary',
  cheque: 'border-border bg-muted text-foreground',
  gateway: 'border-primary/30 bg-primary/10 text-primary',
  other: 'border-border bg-muted text-muted-foreground',
};

export function MethodChip({ method, className }: { method: PaymentMethod; className?: string }) {
  const t = useTranslations('invoicing.method');
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        METHOD_TONE[method],
        className,
      )}
    >
      {t(method)}
    </span>
  );
}

/** A linked contact: a small outlined pill that goes to the contact. */
export function ContactPill({
  contact,
  className,
}: {
  contact: { id: string; name: string | null } | null;
  className?: string;
}) {
  const t = useTranslations('invoicing.common');
  if (!contact) return <span className="text-muted-foreground">-</span>;
  const text = contact.name || t('unnamedContact');
  return (
    <Link
      href={`/contacts/${contact.id}`}
      title={text}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary',
        className,
      )}
    >
      <ContactIcon className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate" dir="auto">
        {text}
      </span>
    </Link>
  );
}

/** A failed call, in our words (chosen by error code) plus the request id for support. */
export function ErrorLine({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const t = useTranslations('invoicing.errors');
  const text = useErrorText();
  const kind = errorKind(error);
  const requestId = requestIdOf(error);
  return (
    <Alert tone={kind === 'unavailable' ? 'warning' : 'danger'} className={className}>
      <span>{text(error)}</span>
      {requestId && (
        <span className="mt-1 block text-xs opacity-80">
          {t('requestId')}: <span className="font-mono">{requestId}</span>
        </span>
      )}
      {onRetry && isRetryable(kind) && (
        <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
    </Alert>
  );
}

/** The sentence for a failed call, chosen by its error code (for toasts and inline lines). */
export function useErrorText() {
  const t = useTranslations('invoicing.errors');
  return (error: unknown) => {
    const code = errorCode(error);
    // The domain's own codes (INV_HAS_PAYMENTS, PAY_OVERPAYMENT ...) get their own sentence when we have one.
    if (code && t.has(`codes.${code}`)) return t(`codes.${code}`);
    return t(errorKind(error));
  };
}

/** Reading-order wrapper for text a person typed (names, notes): follows its own script, not the page's. */
export function UserText({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span dir="auto" className={className}>
      {children}
    </span>
  );
}
