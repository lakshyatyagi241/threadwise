'use client';

import { useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Input, Modal } from '@crm/ui';
import { useCanNativeShare } from '../lib/browser';
import { shareLinks } from '../lib/share';
import { MailIcon, SendIcon, ShareIcon, UploadIcon, WhatsAppIcon } from './icons';

export interface ShareTarget {
  url: string;
  name: string;
}

const TILE =
  'flex items-center gap-3 rounded-xl border border-border px-3 py-3 text-start transition hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

function Tile({ icon, title, hint }: { icon: ReactNode; title: string; hint: string }) {
  return (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </>
  );
}

/**
 * "Share your shop" (TW-STORE-030): the link with Copy, WhatsApp, Email, Telegram and the phone's share sheet, and a QR
 * code drawn here in the browser (no third-party service).
 */
export function ShareModal({
  target,
  onClose,
}: {
  target: ShareTarget | null;
  onClose: () => void;
}) {
  const t = useTranslations('storefront-builder.admin.share');
  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      eyebrow={t('eyebrow')}
      title={target?.name.trim() || t('fallbackName')}
      closeLabel={t('close')}
    >
      {target && <ShareBody key={target.url} target={target} />}
    </Modal>
  );
}

function ShareBody({ target }: { target: ShareTarget }) {
  const t = useTranslations('storefront-builder.admin.share');
  const canShare = useCanNativeShare();
  const [copied, setCopied] = useState(false);
  const [nativeCopied, setNativeCopied] = useState(false);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const title = target.name.trim() || t('fallbackName');
  const links = shareLinks(target.url, title, {
    text: t('message', { name: title }),
    subject: t('subject', { name: title }),
  });

  const copy = async (done: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(target.url);
    } catch {
      return;
    }
    done(true);
    timers.current.push(setTimeout(() => done(false), 1500));
  };

  const shareNative = async () => {
    if (canShare) {
      try {
        await navigator.share({ title, text: links.text, url: target.url });
      } catch {
        /* dismissed */
      }
      return;
    }
    await copy(setNativeCopied);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          readOnly
          value={target.url}
          aria-label={t('link')}
          className="font-mono"
          dir="ltr"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button variant="brand" onClick={() => void copy(setCopied)}>
          {copied ? t('copied') : t('copy')}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <a href={links.whatsapp} target="_blank" rel="noopener noreferrer" className={TILE}>
          <Tile
            icon={<WhatsAppIcon className="size-4 text-success" />}
            title={t('whatsapp')}
            hint={t('whatsappHint')}
          />
        </a>
        <a href={links.email} className={TILE}>
          <Tile icon={<MailIcon />} title={t('email')} hint={t('emailHint')} />
        </a>
        <a href={links.telegram} target="_blank" rel="noopener noreferrer" className={TILE}>
          <Tile
            icon={<SendIcon className="size-4 text-primary" />}
            title={t('telegram')}
            hint={t('telegramHint')}
          />
        </a>
        <button
          type="button"
          onClick={() => void shareNative()}
          title={canShare ? undefined : t('nativeUnsupported')}
          className={`${TILE} ${canShare ? '' : 'opacity-60'}`}
        >
          <Tile
            icon={canShare ? <UploadIcon /> : <ShareIcon />}
            title={nativeCopied ? t('copiedShort') : t('more')}
            hint={canShare ? t('moreHint') : t('nativeUnsupported')}
          />
        </button>
      </div>

      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
          <span
            aria-hidden="true"
            className="inline-block transition group-open:rotate-90 rtl:rotate-180 rtl:group-open:rotate-90"
          >
            ›
          </span>
          {t('showQr')}
        </summary>
        <div className="mt-3 flex flex-col items-center rounded-xl border border-border bg-muted p-4">
          <div className="rounded-lg bg-white p-2">
            <QRCodeSVG value={target.url} size={192} level="M" marginSize={1} title={t('qrAlt')} />
          </div>
          <div className="mt-2 text-xs text-muted-foreground">{t('qrCaption')}</div>
        </div>
      </details>
    </div>
  );
}
