'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Alert, Button, Spinner } from '@crm/ui';
import { usePlayback } from '../api/call-logs';
import { useErrorText } from './use-error-text';
import { PlayIcon } from './icons';

/**
 * The recording of one call. Nothing is fetched until the person presses Play: the server writes every request for a playback link to
 * the audit trail, so a page that is only looked at is not a play. The link works for a few minutes and only for this person; if it has
 * run out by the time the player needs more audio (a long pause, then seeking), one new link is asked for and playing carries on from
 * where it was. The consent line is always shown.
 */
export function RecordingPlayer({ callId, canPlay }: { callId: string; canPlay: boolean }) {
  const t = useTranslations('calling-voice.logs.recording');
  const format = useFormatter();
  const errorText = useErrorText();
  const playback = usePlayback();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [broken, setBroken] = useState(false);
  const resumeAt = useRef(0);
  const renewed = useRef(false);

  const ask = useCallback(
    (resume = 0) => {
      resumeAt.current = resume;
      setBroken(false);
      playback.mutate(callId, {
        onSuccess: (link) => {
          setSrc(link.url.startsWith('/') ? `/api${link.url}` : link.url);
          setExpiresAt(Date.parse(link.expiresAt));
        },
      });
    },
    [callId, playback],
  );

  // After a fresh link loads, carry on from where the old one stopped.
  useEffect(() => {
    const el = audio.current;
    if (!el || !src) return;
    const onReady = () => {
      if (resumeAt.current > 0) el.currentTime = resumeAt.current;
      void el.play().catch(() => undefined);
      resumeAt.current = 0;
    };
    el.addEventListener('loadedmetadata', onReady, { once: true });
    return () => el.removeEventListener('loadedmetadata', onReady);
  }, [src]);

  const onError = () => {
    const at = audio.current?.currentTime ?? 0;
    // The link ran out (or was refused): one new link per press of Play, then say so.
    if (!renewed.current && expiresAt !== null && Date.now() >= expiresAt - 1000) {
      renewed.current = true;
      ask(at);
      return;
    }
    setBroken(true);
  };

  return (
    <section
      aria-labelledby="rec-title"
      className="rounded-xl border border-border bg-background p-5"
    >
      <h3 id="rec-title" className="text-base font-medium">
        {t('title')}
      </h3>
      <p role="note" className="mt-2 text-xs font-medium text-foreground">
        {t('notice')}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{t('privacy')}</p>

      {!canPlay && <p className="mt-3 text-xs italic text-muted-foreground">{t('noAccess')}</p>}
      {canPlay && !src && (
        <Button
          className="mt-3 rounded-full"
          variant="brand"
          disabled={playback.isPending}
          aria-busy={playback.isPending}
          onClick={() => {
            renewed.current = false;
            ask();
          }}
        >
          {playback.isPending ? (
            <Spinner label={t('loading')} />
          ) : (
            <PlayIcon className="size-3.5" />
          )}
          {playback.isPending ? t('loading') : t('play')}
        </Button>
      )}
      {canPlay && src && (
        <figure className="mt-3">
          <audio
            ref={audio}
            key={src}
            controls
            autoPlay
            preload="metadata"
            src={src}
            aria-label={t('playerLabel')}
            className="w-full"
            onError={onError}
          />
          {expiresAt && (
            <figcaption className="mt-1 text-xs text-muted-foreground">
              {t('linkUntil', {
                time: format.dateTime(new Date(expiresAt), { timeStyle: 'short' }),
              })}
            </figcaption>
          )}
        </figure>
      )}
      {playback.isError && (
        <Alert tone="danger" className="mt-3">
          {errorText(playback.error)}
        </Alert>
      )}
      {broken && (
        <Alert tone="danger" className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <span>{t('playFailed')}</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              renewed.current = false;
              ask();
            }}
          >
            {t('retry')}
          </Button>
        </Alert>
      )}
    </section>
  );
}
