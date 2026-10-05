'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { MarketScopeRisk } from '@crm/contracts';
import { Alert, Badge, Button, Card, EmptyState, Spinner, cn } from '@crm/ui';
import { isPlanGate, isRetryable, mktError, retryAfterSeconds, type MktError } from '../lib/errors';
import type { Chip, LockView } from '../lib/install-state';
import { isHttpsLink, initialsOf } from '../lib/text';
import { CheckIcon, CopyIcon, ExternalIcon, LockIcon } from './icons';

/** Pieces every Marketplace screen shares. Text comes from `marketplace.common` and its siblings; no screen writes its own wording for these. */

export const PAGE = 'mx-auto w-full max-w-6xl space-y-5';
export const TEXT_LINK =
  'font-medium text-primary underline-offset-2 hover:underline focus-visible:underline';
export const LINK_BUTTON =
  'inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';
export const LINK_BUTTON_PRIMARY =
  'inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background';
export const LINK_BUTTON_SM =
  'inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

export function LoadingBlock({ label }: { label?: string }) {
  const t = useTranslations('marketplace.common');
  return (
    <div className="flex justify-center p-12">
      <Spinner label={label ?? t('loading')} />
    </div>
  );
}

/** A titled card. */
export function Section({
  title,
  description,
  actions,
  children,
  tone,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  tone?: 'danger';
  id?: string;
}) {
  return (
    <Card id={id} className={cn('space-y-4', tone === 'danger' && 'border-danger/40')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </Card>
  );
}

// --- errors ----------------------------------------------------------------------------------------------------------------------

/** The sentence for a failed call, from its problem `code`. Plan kinds point at the upgrade page; the request id is always available. */
export function ErrorText({ error }: { error: unknown }) {
  const t = useTranslations('marketplace.errors');
  return <>{errorMessage(t, mktError(error), error)}</>;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

export function errorMessage(t: Translate, e: MktError, raw?: unknown): string {
  const wait = retryAfterSeconds(raw);
  switch (e.kind) {
    case 'scopeExceeds':
      return t('scopeExceeds', { permissions: e.missingPermissions.join(', ') });
    case 'rateLimited':
      return wait ? t('rateLimitedWait', { seconds: wait }) : t('rateLimited');
    case 'planLimitInstalled':
    case 'planLimit':
    case 'planLimitLeadSources':
      return e.limit && e.limit.cap !== null && e.limit.used !== null
        ? t(`${e.kind}Counts`, { used: e.limit.used, cap: e.limit.cap })
        : t(e.kind);
    default:
      return t(e.kind);
  }
}

/** A failed region: the sentence, the request id, a retry when trying again can help, an upgrade link when a plan is the cause. */
export function ErrorPanel({
  error,
  onRetry,
  title,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: ReactNode;
}) {
  const t = useTranslations('marketplace.common');
  const te = useTranslations('marketplace.errors');
  const e = mktError(error);
  return (
    <EmptyState
      title={title ?? t('errorTitle')}
      message={
        <>
          {errorMessage(te, e, error)}
          {e.requestId && (
            <span className="mt-1 block font-mono text-[11px]">
              {t('requestId')}: {e.requestId}
            </span>
          )}
        </>
      }
      actions={
        <>
          {isPlanGate(e) && e.upgradeHref && (
            <Link href={e.upgradeHref} className={LINK_BUTTON_PRIMARY}>
              {t('upgrade')}
            </Link>
          )}
          {onRetry && isRetryable(e) && (
            <Button variant="secondary" onClick={onRetry}>
              {t('retry')}
            </Button>
          )}
        </>
      }
    />
  );
}

/** An inline problem under a form or a panel, announced to screen readers. */
export function ErrorLine({ error, className }: { error: unknown; className?: string }) {
  const t = useTranslations('marketplace.common');
  const te = useTranslations('marketplace.errors');
  const e = mktError(error);
  return (
    <Alert tone="danger" className={className}>
      <p>{errorMessage(te, e, error)}</p>
      {isPlanGate(e) && e.upgradeHref && (
        <p className="mt-1">
          <Link href={e.upgradeHref} className={TEXT_LINK}>
            {t('upgrade')}
          </Link>
        </p>
      )}
      {e.requestId && (
        <p className="mt-1 font-mono text-[11px]">
          {t('requestId')}: {e.requestId}
        </p>
      )}
    </Alert>
  );
}

// --- small things ----------------------------------------------------------------------------------------------------------------

/** The app's logo, or its initials when it has none or the image does not load. Decorative: the name is always written beside it. */
export function AppLogo({
  name,
  logo,
  className,
}: {
  name: string;
  logo: string | null | undefined;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = isHttpsLink(logo) && !failed ? logo : null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-sm font-semibold text-muted-foreground',
        className,
      )}
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="size-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}

export function ChipView({ chip, title }: { chip: Chip; title?: string }) {
  const t = useTranslations('marketplace.chips');
  return (
    <Badge tone={chip.tone} title={title}>
      {t(chip.key)}
    </Badge>
  );
}

const RISK_TONE = { low: 'success', medium: 'warning', high: 'danger' } as const;

export function RiskChip({ risk }: { risk: MarketScopeRisk }) {
  const t = useTranslations('marketplace.scopes.risk');
  return <Badge tone={RISK_TONE[risk]}>{t(risk)}</Badge>;
}

/** A link to somebody else's site: only https addresses are ever drawn as links, always in a new tab without a referrer. */
export function ExternalLink({
  href,
  children,
  className,
}: {
  href: string | null | undefined;
  children: ReactNode;
  className?: string;
}) {
  const t = useTranslations('marketplace.common');
  if (!isHttpsLink(href)) return <span className={className}>{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(TEXT_LINK, 'inline-flex items-center gap-1', className)}
    >
      {children}
      <ExternalIcon className="size-3.5" />
      <span className="sr-only">{t('opensNewTab')}</span>
    </a>
  );
}

/** The lock chip and, under it, why and what to do. The upgrade link is drawn only when upgrading can help. */
export function LockNotice({ lock, compact }: { lock: LockView; compact?: boolean }) {
  const t = useTranslations('marketplace.lock');
  const tc = useTranslations('marketplace.common');
  return (
    <div className="space-y-1.5 text-sm">
      <Badge tone="warning" className="gap-1">
        <LockIcon className="size-3" />
        {t(`${lock.key}.chip`)}
      </Badge>
      {!compact && <p className="text-muted-foreground">{t(`${lock.key}.message`)}</p>}
      {lock.upgradeHref && (
        <Link href={lock.upgradeHref} className={cn(TEXT_LINK, 'block text-xs')}>
          {tc('upgrade')}
        </Link>
      )}
    </div>
  );
}

/** Copy to the clipboard, with a polite confirmation. The value is never logged and the button never shows it. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const t = useTranslations('marketplace.common');
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
      setTimeout(() => setState('idle'), 2500);
    } catch {
      setState('failed');
    }
  };
  return (
    <>
      <Button variant="secondary" size="sm" onClick={copy} aria-label={label}>
        {state === 'copied' ? <CheckIcon /> : <CopyIcon />}
        {state === 'copied' ? t('copied') : t('copy')}
      </Button>
      <span aria-live="polite" className="sr-only">
        {state === 'copied' ? t('copied') : state === 'failed' ? t('copyFailed') : ''}
      </span>
      {state === 'failed' && (
        <span role="alert" className="text-xs text-danger">
          {t('copyFailed')}
        </span>
      )}
    </>
  );
}

/** Says which permission a missing button needs, instead of leaving the person to guess. */
export function NeedsPermission({ permission }: { permission: string }) {
  const t = useTranslations('marketplace.common');
  return <p className="text-xs text-muted-foreground">{t('needsPermission', { permission })}</p>;
}
