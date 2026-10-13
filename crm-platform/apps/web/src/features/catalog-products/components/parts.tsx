'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, type HTMLAttributes, type ReactNode } from 'react';
import { Button, EmptyState, Spinner, cn } from '@crm/ui';
import { isPlanLocked } from '../lib/errors';
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

/**
 * The paywall of a plan without the storefront flag. Reference lets the page render and slides a sheet up over it ("not on your
 * plan", with the plans that include the feature as cards). The catalog API refuses every call on such a plan, so the sheet
 * is drawn over the empty frame; the plan cards wait on a plans list that says which plans carry the flag.
 */
export function Paywall() {
  const t = useTranslations('catalogProducts.paywall');
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cat-paywall-title"
      data-testid="catalog-paywall"
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 px-3 sm:px-4"
    >
      <div className="max-h-[94vh] w-full max-w-[920px] overflow-y-auto rounded-t-3xl border border-b-0 border-border bg-background px-6 pb-8 pt-7 text-center shadow-lg sm:px-8">
        <span className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-muted text-brand dark:text-primary">
          <LockIcon className="size-5" />
        </span>
        <div className={KICKER}>{t('kicker')}</div>
        <h2
          id="cat-paywall-title"
          className="mt-1 font-serif text-[26px] leading-tight sm:text-[30px]"
        >
          {t('title')}
        </h2>
        <p className="mx-auto mt-2 max-w-[52ch] text-[13.5px] text-muted-foreground">
          {t('message')}
        </p>
        <div className="mt-6 flex items-center justify-center gap-4">
          <Link
            href="/dashboard"
            className="text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
          >
            {t('back')}
          </Link>
          <span className="text-border">·</span>
          <Link
            href="/account/plans"
            className={cn(TEXT_LINK, 'inline-flex items-center gap-1 text-[12.5px]')}
          >
            {t('compare')}
            <ChevronRightIcon className="size-3 rtl:rotate-180" />
          </Link>
        </div>
      </div>
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
  return (
    <EmptyState
      title={title}
      message={text(error)}
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
  className,
}: {
  page: number;
  total: number | undefined;
  size: number;
  onPage: (page: number) => void;
  className?: string;
}) {
  const t = useTranslations('catalogProducts.pager');
  const pages = totalPages(total ?? 0, size);
  if (pages <= 1) return null;
  return (
    <nav
      aria-label={t('label')}
      className={cn('flex items-center justify-center gap-1', className ?? 'mt-4')}
    >
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

/** Laravel's paginator footer, as Reference draws it: "Showing 1 to 25 of 28 results" on one side, the page links on the other. */
export function PagerBar({
  page,
  total,
  size,
  shown,
  onPage,
  className,
}: {
  page: number;
  total: number | undefined;
  size: number;
  /** Rows on this page. */
  shown: number;
  onPage: (page: number) => void;
  className?: string;
}) {
  const t = useTranslations('catalogProducts.pager');
  if (total === undefined || total <= size) return null;
  const from = (page - 1) * size + 1;
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      <div className="text-[12.5px] text-muted-foreground" aria-live="polite">
        {t('showing', { from, to: from + Math.max(shown, 1) - 1, total })}
      </div>
      <Pager page={page} total={total} size={size} onPage={onPage} className="mt-0" />
    </div>
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
