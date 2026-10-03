'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Spinner } from '@crm/ui';
import { mediaFailureKind, mediaRetryHelps, type MediaView } from '../../lib/media-state';

export interface MediaStateNoteProps {
  state: Extract<MediaView, 'pending' | 'failed'>;
  /** The stable code of why the download failed (`MEDIA_EXPIRED`...); it decides the hint and whether Retry is offered. */
  failureCode?: string | null;
  onRetry: () => Promise<void>;
}

/**
 * Where a file would be while it is not there: "Downloading..." while the provider's file is being fetched, and "Could not download"
 * with a Retry button when it failed and trying again can help (a file that expired, is too large or was refused stays that way, so
 * the button is not offered for those). A reader of the thread is never left looking at an empty bubble.
 */
export function MediaStateNote({ state, failureCode = null, onRetry }: MediaStateNoteProps) {
  const t = useTranslations('channel-whatsapp-cloud.inbox.media');
  const [retrying, setRetrying] = useState(false);

  if (state === 'pending') {
    return (
      <p
        role="status"
        data-testid="inbox-media-pending"
        className="flex w-56 max-w-full items-center gap-2 rounded-md border border-dashed border-border bg-background/70 px-3 py-4 text-xs text-muted-foreground"
      >
        <Spinner /> {t('downloading')}
      </p>
    );
  }
  const kind = mediaFailureKind(failureCode);
  return (
    <div
      data-testid="inbox-media-failed"
      data-kind={kind}
      className="flex w-56 max-w-full flex-col gap-1 rounded-md border border-danger/30 bg-danger/5 px-3 py-3 text-xs text-danger"
    >
      <p className="font-medium">{t('failed')}</p>
      <p className="text-muted-foreground">{t(`reason.${kind}`)}</p>
      {mediaRetryHelps(kind) && (
        <button
          type="button"
          data-testid="inbox-media-retry"
          disabled={retrying}
          onClick={() => {
            setRetrying(true);
            void onRetry().finally(() => setRetrying(false));
          }}
          className="self-start rounded font-medium underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50"
        >
          {retrying ? t('retrying') : t('retry')}
        </button>
      )}
    </div>
  );
}
