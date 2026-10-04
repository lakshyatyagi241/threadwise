'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Spinner } from '@crm/ui';
import { showFlash } from '@/features/auth-registration-security/shared/flash';
import {
  CONNECT_URL,
  DEVICE_CONNECTED_EVENT,
  OPEN_CONNECT_EVENT,
  parseConnectMessage,
} from './logic';

const NS = 'admin-console-shell.connectDevice';

/**
 * The connect-a-device sheet (WD-ASHELL-029): any device picker can open it (dispatch `shell:connect-device` on `window`) to
 * connect a number without leaving a half-filled form. The frame loads when the sheet opens and is emptied when it closes,
 * which also stops the connect page's QR polling. Escape closes it; on success the lists on the page reload in place.
 */
export function ConnectDeviceSheet() {
  const t = useTranslations(NS);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const onOpen = () => {
      setLoading(true);
      setOpen(true);
    };
    window.addEventListener(OPEN_CONNECT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CONNECT_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onMessage = (e: MessageEvent) => {
      const kind = parseConnectMessage(e, window.location.origin, frame.current?.contentWindow);
      if (kind === 'close') setOpen(false);
      if (kind === 'connected') {
        window.dispatchEvent(new CustomEvent(DEVICE_CONNECTED_EVENT));
        showFlash(t('connected'));
        setOpen(false);
        // Lists on the page that depend on devices fetch again; nothing is reloaded, so form fields stay as they are.
        void qc.invalidateQueries();
      }
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    window.addEventListener('message', onMessage);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('message', onMessage);
    };
  }, [open, qc, t]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[75] flex items-end justify-center bg-black/40 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('title')}
        className="relative flex h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl bg-background shadow-2xl sm:h-[640px] sm:w-[660px] sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold">{t('title')}</h2>
          <button
            type="button"
            aria-label={t('close')}
            onClick={() => setOpen(false)}
            className="rounded px-2 text-xl leading-none text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            ×
          </button>
        </div>
        {loading && (
          <div className="absolute inset-x-0 top-14 flex justify-center py-6">
            <Spinner />
          </div>
        )}
        <iframe
          ref={frame}
          title={t('title')}
          src={CONNECT_URL}
          referrerPolicy="same-origin"
          onLoad={() => setLoading(false)}
          className="min-h-0 flex-1 border-0"
        />
      </div>
    </div>
  );
}
