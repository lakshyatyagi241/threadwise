'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, type HTMLAttributes, type ReactNode } from 'react';
import { Button, EmptyState, Spinner, cn } from '@crm/ui';
import { errorKind, isPlanLocked, requestIdOf } from '../lib/errors';
import { syncStatus, type SyncStatus } from '../lib/format';
import { pageWindow, totalPages } from '../lib/pages';
import { BoxIcon, ChevronLeftIcon, ChevronRightIcon, ImageIcon, LockIcon } from './icons';
import { useErrorText } from './use-error-text';

/** The white rounded card every Reference catalog screen is made of. */
export const CARD = 'rounded-2xl border border-border bg-background shadow-sm';
/** The small mono caption above a block. */
export const KICKER = 'font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground';
/** Table header cells. */
export const TH =
  'px-2 py-2.5 text-start font-mono text-[10px] font-normal uppercase tracking-[0.14em]';
export const PILL_LINK =
  'inline-flex h-10 items-center justify-center gap-2 rounded-full bg-brand px-4 text-xs font-semibold text-brand-foreground outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background';
export const TEXT_LINK =
  'font-semibold text-brand hover:underline focus-visible:underline outline-none dark:text-primary';
export const INPUT_TEXT = 'text-[13px]';

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex justify-center p-12">
      <Spinner label={label} />
    </div>
  );
}

/** The paywall of a plan without the storefront flag (Reference shows an overlay on the GET pages; mutations are refused). */
export function Paywall() {
  const t = useTranslations('catalogProducts.paywall');
  return (
    <div
      className={cn(CARD, 'mx-auto flex max-w-2xl flex-col items-center gap-3 p-10 text-center')}
    >
      <span className="grid size-12 place-items-center rounded-xl bg-muted text-muted-foreground">
        <LockIcon className="size-6" />
      </span>
      <h2 className="font-serif text-2xl leading-tight">{t('title')}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{t('message')}</p>
      <Link href="/account/plans" className={PILL_LINK}>
        {t('upgrade')}
      </Link>
    </div>
  );
}

/** A failed load: the paywall for a locked plan, otherwise the sentence for the problem code with a retry. */
export function LoadError({
  error,
  onRetry,
  title,
}: {
  error: unknown;
  onRetry?: () => void;
  title: string;
}) {
  const t = useTranslations('catalogProducts.common');
  const text = useErrorText();
  if (isPlanLocked(error)) return <Paywall />;
  const id = requestIdOf(error);
  const unexpected = errorKind(error) === 'unexpected';
  return (
    <EmptyState
      title={title}
      message={
        <>
          {text(error)}
          {unexpected && id ? (
            <span className="mt-1 block font-mono text-[11px]">
              {t('requestId')}: {id}
            </span>
          ) : null}
        </>
      }
      actions={
        onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            {t('retry')}
          </Button>
        ) : undefined
      }
    />
  );
}

/** An inline red line under a form or a panel. */
export function ErrorLine({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger',
        className,
      )}
    >
      {children}
    </div>
  );
}

const SYNC_TONE: Record<SyncStatus, string> = {
  unsynced: 'bg-muted text-muted-foreground',
  pending: 'bg-warning/15 text-warning',
  synced: 'bg-success/15 text-success',
  failed: 'bg-danger/15 text-danger',
};

/** The Meta status pill of a product row: unsynced grey, pending amber, synced green, failed red. */
export function SyncPill({ status }: { status: string | null }) {
  const t = useTranslations('catalogProducts.status');
  const s = syncStatus(status);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10.5px]',
        SYNC_TONE[s],
      )}
    >
      {t(s)}
    </span>
  );
}

/** A product thumbnail that falls back to the box glyph when there is no image or it does not load. */
export function ProductThumb({
  url,
  size = 'size-10',
  glyph = 'box',
  className,
}: {
  url: string | null;
  size?: string;
  glyph?: 'box' | 'image';
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const Glyph = glyph === 'box' ? BoxIcon : ImageIcon;
  if (!url || failed === url) {
    return (
      <span
        className={cn(
          'grid shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground',
          size,
          className,
        )}
      >
        <Glyph className="size-4" />
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      onError={() => setFailed(url)}
      className={cn('shrink-0 rounded-lg object-cover', size, className)}
    />
  );
}

/** A step number badge ("01") of the Send tab. */
export function StepBadge({ n }: { n: string }) {
  return (
    <span className="inline-flex size-[23px] shrink-0 items-center justify-center rounded-[7px] bg-muted font-mono text-[10px] font-semibold text-brand dark:text-primary">
      {n}
    </span>
  );
}

const PAGER_BTN =
  'inline-flex size-9 items-center justify-center rounded-md border border-border text-sm tabular-nums outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40';

/** The numbered pager under a table or a list. */
export function Pager({
  page,
  total,
  size,
  onPage,
}: {
  page: number;
  total: number | undefined;
  size: number;
  onPage: (page: number) => void;
}) {
  const t = useTranslations('catalogProducts.pager');
  const pages = totalPages(total ?? 0, size);
  if (pages <= 1) return null;
  return (
    <nav aria-label={t('label')} className="mt-4 flex items-center justify-center gap-1">
      <button
        type="button"
        className={PAGER_BTN}
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        aria-label={t('prev')}
      >
        <ChevronLeftIcon className="size-4 rtl:rotate-180" />
      </button>
      {pageWindow(page, pages).map((slot, i) =>
        slot === 'gap' ? (
          <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-muted-foreground">
            &hellip;
          </span>
        ) : (
          <button
            key={slot}
            type="button"
            onClick={() => onPage(slot)}
            aria-current={slot === page ? 'page' : undefined}
            aria-label={t('goTo', { page: slot })}
            className={cn(
              PAGER_BTN,
              slot === page && 'border-brand bg-brand text-brand-foreground hover:bg-brand',
            )}
          >
            {slot}
          </button>
        ),
      )}
      <button
        type="button"
        className={PAGER_BTN}
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
        aria-label={t('next')}
      >
        <ChevronRightIcon className="size-4 rtl:rotate-180" />
      </button>
    </nav>
  );
}

/** A mono pill with a dot, as used for the connection state and the sender status. */
export function DotPill({
  on,
  children,
  className,
  ...rest
}: { on: boolean; children: ReactNode } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px]',
        on
          ? 'border-success/40 bg-success/10 text-success'
          : 'border-border bg-muted text-muted-foreground',
        className,
      )}
      {...rest}
    >
      <span className={cn('size-1.5 rounded-full', on ? 'bg-success' : 'bg-border')} />
      {children}
    </span>
  );
}
