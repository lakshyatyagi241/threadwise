'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import {
  PLAN_UPGRADE_PATH,
  type LeadEventStatus,
  type LeadSourceKind,
  type LeadSourceStatus,
} from '@crm/contracts';
import { Alert, Badge, Button, Card, ToastProvider } from '@crm/ui';
import { leadError, type LeadError } from '../lib/errors';
import { EVENT_STATUS_TONE } from '../lib/event-view';
import type { LeadsCan } from '../lib/permissions';
import { STATUS_TONE } from '../lib/source-view';
import { relativeTime } from '../lib/time';

/** Small shared pieces of the Social leads screens: toast host, gates, error panel, chips, time, copy button. */

export function LeadProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('lead-sources.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}

/** The person's role lacks a key: say which one, so they can ask an admin for it. */
export function NoAccess({ permission }: { permission: string }) {
  const t = useTranslations('lead-sources.states');
  return (
    <Card role="region" aria-labelledby="ls-noaccess" className="mx-auto max-w-xl space-y-2 p-6">
      <h1 id="ls-noaccess" className="text-lg font-semibold">
        {t('noAccessTitle')}
      </h1>
      <p className="text-sm text-muted-foreground">{t('noAccessBody', { permission })}</p>
      <p className="text-xs text-muted-foreground">
        <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5">
          {permission}
        </code>
      </p>
    </Card>
  );
}

/** The plan has no Social leads (422 PLAN_FEATURE_LOCKED): explained, with the way to upgrade. */
export function LockedState({ upgradeUrl }: { upgradeUrl?: string }) {
  const t = useTranslations('lead-sources.states');
  return (
    <Card role="region" aria-labelledby="ls-locked" className="mx-auto max-w-xl space-y-3 p-6">
      <h1 id="ls-locked" className="text-lg font-semibold">
        {t('lockedTitle')}
      </h1>
      <p className="text-sm text-muted-foreground">{t('lockedBody')}</p>
      <Link
        href={upgradeUrl ?? PLAN_UPGRADE_PATH}
        className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {t('upgrade')}
      </Link>
    </Card>
  );
}

/** The inline line under an input or beside a button: the failure in words, with the reference to quote to support. */
export function ErrorText({
  error,
  mapped,
  onRetry,
}: {
  /** The thrown error. */
  error?: unknown;
  /** Or an error that was already mapped (kept in a screen's state). */
  mapped?: LeadError | null;
  onRetry?: () => void;
}) {
  const t = useTranslations('lead-sources');
  const e = mapped ?? leadError(error);
  return (
    <Alert tone="danger" className="space-y-1">
      <p>{t(`errors.${e.key}`, e.values)}</p>
      {e.issues.length > 0 && (
        <ul className="list-disc ps-5 text-xs">
          {e.issues.map((i) => (
            <li key={i.path + i.key}>
              <code dir="ltr">{i.path}</code>: {t(`errors.${i.key}`, i.values)}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {e.requestId && (
          <span dir="ltr" className="text-muted-foreground">
            {t('common.requestId', { id: e.requestId })}
          </span>
        )}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="font-medium underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('common.retry')}
          </button>
        )}
      </div>
    </Alert>
  );
}

/** A failed load of a whole region: a locked plan and a missing permission get their own explanation, anything else the error line. */
export function RegionError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e: LeadError = leadError(error);
  if (e.kind === 'locked') return <LockedState upgradeUrl={e.upgradeUrl} />;
  if (e.kind === 'noAccess') return <NoAccess permission="leads.sources.read" />;
  return <ErrorText error={error} onRetry={onRetry} />;
}

export function Loading({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-2">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((i) => (
        <div key={i} aria-hidden="true" className="h-14 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}

export function SourceStatusChip({ status }: { status: LeadSourceStatus }) {
  const t = useTranslations('lead-sources.sourceStatus');
  return (
    <Badge tone={STATUS_TONE[status]} data-status={status}>
      {t(status)}
    </Badge>
  );
}

export function KindBadge({ kind }: { kind: LeadSourceKind }) {
  const t = useTranslations('lead-sources.kinds');
  return <Badge>{t(kind)}</Badge>;
}

export function EventStatusChip({ status }: { status: LeadEventStatus }) {
  const t = useTranslations('lead-sources.eventStatus');
  return (
    <Badge tone={EVENT_STATUS_TONE[status]} data-status={status}>
      {t(status)}
    </Badge>
  );
}

/** A moment as "3 days ago", with the exact time on hover and for assistive technology. */
export function When({ value, empty }: { value: string | null; empty: string }) {
  const locale = useLocale();
  if (!value) return <span className="text-muted-foreground">{empty}</span>;
  const exact = new Date(value);
  const title = Number.isNaN(exact.getTime())
    ? undefined
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(exact);
  return (
    <time dateTime={value} title={title}>
      {relativeTime(value, new Date(), locale)}
    </time>
  );
}

/** Copies a text to the clipboard and says so; where the clipboard is blocked it says that instead, and the text stays selectable. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const t = useTranslations('lead-sources.common');
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  };
  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" size="sm" variant="secondary" onClick={() => void copy()}>
        {label}
      </Button>
      <span aria-live="polite" className="text-xs text-muted-foreground">
        {state === 'copied' ? t('copied') : state === 'failed' ? t('copyFailed') : ''}
      </span>
    </span>
  );
}

/** A heading with the permission-aware hint used above write controls that are disabled instead of hidden. */
export function ManageNote({ can }: { can: LeadsCan }) {
  const t = useTranslations('lead-sources.states');
  if (can.manage) return null;
  return (
    <Alert tone="info" className="text-xs">
      {t('manageNeeded', { permission: 'leads.sources.manage' })}
    </Alert>
  );
}
