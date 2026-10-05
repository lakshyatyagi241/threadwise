'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { GetaView } from './status-model';

/** Where the settings screen lives (a Settings tile points here). */
export const GETA_SETTINGS_HREF = '/flows/geta-publishing';

interface Props {
  view: GetaView;
  retrying: boolean;
  onRetry: () => void;
}

const pill =
  'flow-status inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-[10.5px] font-medium text-[var(--flb-ink-700)]';

/**
 * The remote state of a published flow, in the editor's own visual language: a pill beside the Published badge ("Going live...",
 * "Live", "Failed at publish - Retry") and, for a failure or a workspace with no Geta credentials, a short notice under the bar
 * with the sanitised reason or the way to set it up. Text is translated (`flb.geta.status.*`).
 */
export function GetaPublishStatus({ view, retrying, onRetry }: Props) {
  const t = useTranslations('flb.geta.status');
  const [dismissed, setDismissed] = useState(false);
  if (view.kind === 'hidden') return null;

  if (view.kind === 'pending') {
    return (
      <span className={pill} aria-live="polite" data-testid="geta-status" data-state="pending">
        <span
          className="h-1.5 w-1.5 animate-pulse rounded-full"
          style={{ background: 'var(--flb-coral)' }}
        />
        {t('pending')}
      </span>
    );
  }
  if (view.kind === 'live') {
    return (
      <span
        className={pill}
        aria-live="polite"
        title={t('liveTitle')}
        data-testid="geta-status"
        data-state="live"
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--flb-green)' }} />
        {t('live')}
      </span>
    );
  }
  if (view.kind === 'push') {
    return (
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        title={t('pushHint')}
        data-testid="geta-status"
        data-state="push"
        className={`${pill} hover:bg-background disabled:opacity-60`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-[#92A29E]" />
        {retrying ? t('retrying') : t('push')}
      </button>
    );
  }
  if (view.kind === 'failed') {
    const label =
      view.failedStep === 'configuration_update'
        ? t('failedConfiguration')
        : view.failedStep === 'publish_bot'
          ? t('failedPublish')
          : t('failed');
    return (
      <>
        <span
          className={pill}
          aria-live="polite"
          title={view.reason ?? label}
          data-testid="geta-status"
          data-state="failed"
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--flb-coral)' }} />
          {label}
          <span aria-hidden="true">&ndash;</span>
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="font-semibold underline-offset-2 hover:underline disabled:opacity-60"
          >
            {retrying ? t('retrying') : t('retry')}
          </button>
        </span>
        <div
          className="absolute end-4 top-full z-40 mt-2 w-[min(420px,calc(100vw-2rem))] rounded-lg border border-border bg-background p-3 text-[12px] shadow-lg"
          role="alert"
          data-testid="geta-notice"
        >
          <div className="font-semibold">{label}</div>
          {view.reason ? (
            <p className="mt-1 break-words text-muted-foreground" data-testid="geta-reason">
              <span className="font-medium text-foreground">{t('reasonLabel')}: </span>
              {view.reason}
            </p>
          ) : null}
          <p className="mt-1 text-muted-foreground">{t('failedNote')}</p>
        </div>
      </>
    );
  }
  // not_configured
  if (dismissed) return null;
  return (
    <div
      className="absolute end-4 top-full z-40 mt-2 flex w-[min(420px,calc(100vw-2rem))] items-start gap-3 rounded-lg border border-border bg-background p-3 text-[12px] shadow-lg"
      aria-live="polite"
      data-testid="geta-notice"
      data-state="not_configured"
    >
      <p className="min-w-0 flex-1">
        {t('notConfigured')}{' '}
        <Link
          href={GETA_SETTINGS_HREF}
          target="_blank"
          rel="noopener"
          className="font-semibold underline underline-offset-2"
        >
          {t('openSettings')}
        </Link>
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t('dismiss')}
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full hover:bg-muted"
      >
        <svg
          viewBox="0 0 16 16"
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        >
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  );
}
