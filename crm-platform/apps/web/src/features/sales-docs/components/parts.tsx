'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Alert, Button, cn } from '@crm/ui';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { errorKind, isRetryable, requestIdOf } from '../lib/errors';
import { avatarColor, initials } from '../lib/format';
import { todayKey, type DocStatus } from '../lib/status';
import { ContactIcon } from './icons';

/** The workspace's time zone (dates are cut there), or the viewer's when the workspace has none. */
export function useWorkspaceZone(): string | undefined {
  return useSession().org.timezone ?? undefined;
}

/** The current time, refreshed every minute so "expired" turns on at midnight without a reload. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** Today's date in the workspace zone, `YYYY-MM-DD`. */
export function useToday(): string {
  const zone = useWorkspaceZone();
  const now = useNow();
  return todayKey(now, zone);
}

/**
 * What the signed-in person may do with sales documents, from the permission keys the API defines (`record.sales-docs.*`).
 * The server stays the authority and answers 403 where it must; the record scope (own, team, all) is applied there too.
 */
export function useSalesDocsCan() {
  const { permissions } = useSession();
  const has = (action: string) => `record.sales-docs.${action}` in permissions;
  return {
    read: has('read'),
    create: has('create'),
    update: has('update'),
    send: has('send'),
    convert: has('convert'),
    /** Making a sales order from an accepted offer needs the sales-orders create capability. */
    order: 'record.sales-orders.create' in permissions,
    remove: has('delete'),
    settings: has('settings'),
  };
}

/** Two-letter circle for a person; the colour follows the name so it is the same everywhere. */
export function Avatar({
  name,
  className,
}: {
  name: string | null | undefined;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: avatarColor(name) }}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

const STATUS_TONE: Record<DocStatus, string> = {
  draft: 'border-border bg-muted text-muted-foreground',
  sent: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  viewed: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  accepted: 'border-success/30 bg-success/10 text-success',
  declined: 'border-danger/30 bg-danger/10 text-danger',
  expired: 'border-warning/30 bg-warning/10 text-warning',
  converted: 'border-brand/30 bg-brand/10 text-brand dark:text-primary',
};
const STATUS_DOT: Record<DocStatus, string> = {
  draft: 'bg-muted-foreground',
  sent: 'bg-sky-500',
  viewed: 'bg-violet-500',
  accepted: 'bg-success',
  declined: 'bg-danger',
  expired: 'bg-warning',
  converted: 'bg-brand dark:bg-primary',
};

export function StatusChip({ status, className }: { status: DocStatus; className?: string }) {
  const t = useTranslations('sales-docs.status');
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

/** The linked contact: a small outlined pill that goes to the contact. */
export function ContactPill({
  id,
  name,
  className,
}: {
  id: string;
  name: string;
  className?: string;
}) {
  const t = useTranslations('sales-docs.link');
  const text = name || t('unnamedContact');
  return (
    <Link
      href={`/contacts/${id}`}
      title={text}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary',
        className,
      )}
    >
      <ContactIcon className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{text}</span>
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
  const t = useTranslations('sales-docs.errors');
  const kind = errorKind(error);
  const requestId = requestIdOf(error);
  return (
    <Alert tone={kind === 'unavailable' ? 'warning' : 'danger'} className={className}>
      <span>{t(kind)}</span>
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
  const t = useTranslations('sales-docs.errors');
  return (error: unknown) => t(errorKind(error));
}
