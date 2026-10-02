'use client';

import { Alert, Button, ToastProvider, cn } from '@crm/ui';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { WSP_INVITE_TTL_DAYS } from '@crm/contracts';
import { errorKind, planLimitOf, requestIdOf } from '../lib/errors';
import { initials } from '../lib/roles';
import { CloseIcon } from './icons';

/** Toast host of the members and teams screens (one region, translated dismiss label). */
export function WspProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('workspaces-teams-tenancy.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}

/** The sentence for a failed call, chosen by the problem's `code`. */
export function useErrorText() {
  const t = useTranslations('workspaces-teams-tenancy.errors');
  return (error: unknown): string => {
    const kind = errorKind(error);
    if (kind === 'planLimit') {
      const limit = planLimitOf(error);
      return limit === undefined ? t('planLimitUnknown') : t('planLimit', { limit });
    }
    return t(kind);
  };
}

/** A failed call as a form-level message: the sentence, an upgrade link when the plan is the reason, the request id. */
export function ErrorNote({ error }: { error: unknown }) {
  const t = useTranslations('workspaces-teams-tenancy');
  const text = useErrorText();
  const kind = errorKind(error);
  const requestId = requestIdOf(error);
  return (
    <Alert tone="danger" className="space-y-1.5">
      <p>{text(error)}</p>
      {kind === 'planLimit' && (
        <p>
          <Link href="/account/plans" className="font-semibold underline underline-offset-2">
            {t('invite.upgrade')}
          </Link>
        </p>
      )}
      {kind === 'unexpected' && requestId && (
        <p className="text-xs opacity-80">
          {t('common.requestId')}: <span className="font-mono">{requestId}</span>
        </p>
      )}
    </Alert>
  );
}

/** Round avatar with the person's initials (WaDesk shows no photo here). */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-full bg-primary text-[11.5px] font-semibold text-primary-foreground',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/** A value to hand over (an invite or reset link) with a Copy button that confirms for two seconds. */
export function CopyField({ label, value }: { label: string; value: string }) {
  const t = useTranslations('workspaces-teams-tenancy.common');
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // No clipboard permission: the value stays selectable in the box for a manual copy.
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex items-stretch gap-2">
      <input
        readOnly
        aria-label={label}
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[11.5px] text-foreground"
      />
      <Button size="sm" variant="secondary" onClick={() => void copy()} className="shrink-0">
        {copied ? t('copied') : t('copy')}
      </Button>
    </div>
  );
}

/** A dismissible success panel above the table: the one-time link of a reset or a re-sent invite. */
export function LinkBanner({
  title,
  body,
  link,
  email,
  onDismiss,
}: {
  title: string;
  body: string;
  link: string;
  email: string;
  onDismiss: () => void;
}) {
  const t = useTranslations('workspaces-teams-tenancy');
  return (
    <Alert tone="success" className="space-y-2 !text-foreground">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold">{title}</div>
          <p className="text-xs">{body}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('common.dismiss')}
          className="shrink-0 rounded text-muted-foreground hover:text-foreground"
        >
          <CloseIcon />
        </button>
      </div>
      <p className="text-xs">
        {t('members.linkEmail')}: <span className="font-mono">{email}</span>
      </p>
      <CopyField label={t('members.linkLabel')} value={link} />
    </Alert>
  );
}

export const INVITE_DAYS = WSP_INVITE_TTL_DAYS;

/** `value`, but only once it has stopped changing for `ms` (WaDesk debounces the member search by 150 ms). */
export function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return out;
}
