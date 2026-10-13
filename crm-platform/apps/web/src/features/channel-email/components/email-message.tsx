'use client';

import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { cn } from '@crm/ui';
import type { EmailAttachment, EmailMeta } from '@crm/contracts';
import { attachmentUrl } from '../api/mailboxes';
import { deliveryView } from '../lib/bounce-view';
import {
  buildSrcDoc,
  formatAddress,
  formatAddresses,
  hasRemoteImages,
  listedAttachments,
} from '../lib/email-view';

const FRAME_MAX = 1600;

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The body of an email in the thread (TW-MAIL-026): subject and header lines, the cleaned HTML inside a frame that cannot run
 * scripts and cannot fetch remote pictures until the agent asks, the plain text when there is no HTML, and the files that came
 * with it. The frame is the safety boundary: nothing from the mail is ever put into this page's own DOM as markup.
 */
export function EmailMessageBody({
  email,
  conversationId,
  messageId,
  body,
  date,
  className,
}: {
  email: EmailMeta;
  conversationId: string;
  messageId: string;
  /** The plain text body of the message: shown when the mail has no HTML. */
  body: string | null;
  /** When the message was sent (the provider's time, or when it was stored). */
  date: string | null;
  className?: string;
}) {
  const t = useTranslations('email.thread');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const [images, setImages] = useState(false);
  const remote = email.html ? hasRemoteImages(email.html) : false;
  const files = listedAttachments(email.attachments);
  const delivery = deliveryView(email);
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  const fit = () => {
    const doc = frame.current?.contentDocument;
    const h = doc?.documentElement?.scrollHeight;
    if (h) setHeight(Math.min(h + 2, FRAME_MAX));
  };

  const line = 'flex gap-2';
  const key = 'w-12 shrink-0 text-muted-foreground';

  return (
    <div data-testid="email-message" className={cn('min-w-0 space-y-2', className)}>
      <div className="space-y-0.5 border-b border-border pb-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <p dir="auto" className="min-w-0 break-words text-sm font-semibold">
            {email.subject || t('noSubject')}
          </p>
          {email.automated && (
            <span
              data-testid="email-automated"
              className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              {t('automated')}
            </span>
          )}
        </div>
        <p className={line}>
          <span className={key}>{t('from')}</span>
          <span dir="ltr" className="min-w-0 break-all">
            {formatAddress(email.from)}
          </span>
        </p>
        {email.to.length > 0 && (
          <p className={line}>
            <span className={key}>{t('to')}</span>
            <span dir="ltr" className="min-w-0 break-all">
              {formatAddresses(email.to)}
            </span>
          </p>
        )}
        {date && (
          <p className={line}>
            <span className={key}>{t('date')}</span>
            <time dateTime={date}>
              {new Intl.DateTimeFormat(locale, {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone,
              }).format(new Date(date))}
            </time>
          </p>
        )}
        {email.cc.length > 0 && (
          <p className={line}>
            <span className={key}>{t('cc')}</span>
            <span dir="ltr" className="min-w-0 break-all">
              {formatAddresses(email.cc)}
            </span>
          </p>
        )}
      </div>

      {delivery.state === 'bounced' && (
        <div
          role="alert"
          data-testid="email-bounce"
          data-kind={delivery.kind}
          className="rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-xs text-danger"
        >
          <p dir="auto" className="break-words font-medium">
            {t('bounce.title', { address: delivery.address })}
            {delivery.reason ? ` ${t('bounce.reason', { reason: delivery.reason })}` : ''}
          </p>
          <p className="mt-0.5 text-danger/90">{t(`bounce.${delivery.kind}`)}</p>
        </div>
      )}

      {email.html ? (
        <>
          {remote && !images && (
            <div
              data-testid="email-images-blocked"
              className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground"
            >
              <span>{t('imagesBlocked')}</span>
              <button
                type="button"
                data-testid="email-load-images"
                onClick={() => setImages(true)}
                className="rounded font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
              >
                {t('loadImages')}
              </button>
            </div>
          )}
          <iframe
            ref={frame}
            title={t('frameTitle', { subject: email.subject || t('noSubject') })}
            data-testid="email-frame"
            // No scripts, no forms, no top navigation: a link only opens a new tab. Same-origin is allowed only so the height can be
            // measured, which is safe because scripts cannot run in the frame.
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            srcDoc={buildSrcDoc(
              email.html,
              images,
              `/api/v2/email/attachments/${encodeURIComponent(conversationId)}/${encodeURIComponent(messageId)}`,
            )}
            onLoad={fit}
            style={{ height }}
            className="w-full rounded-md border border-border bg-white"
          />
          {email.htmlTruncated && <p className="text-xs text-muted-foreground">{t('truncated')}</p>}
        </>
      ) : (
        <p dir="auto" className="whitespace-pre-wrap break-words text-sm">
          {body?.trim() ? body : t('noBody')}
        </p>
      )}

      {files.length > 0 && (
        <ul
          aria-label={t('attachments', { count: files.length })}
          data-testid="email-attachments"
          className="flex flex-wrap gap-2"
        >
          {files.map((a) => (
            <li key={a.id}>
              <AttachmentChip a={a} href={attachmentUrl(conversationId, messageId, a.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AttachmentChip({ a, href }: { a: EmailAttachment; href: string }) {
  const t = useTranslations('email.thread');
  const chip =
    'inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs';
  if (a.tooLarge) {
    return (
      <span className={cn(chip, 'text-muted-foreground')} data-testid="email-attachment-large">
        <span className="truncate">{a.name}</span>
        <span className="shrink-0">· {t('tooLarge', { size: humanSize(a.size) })}</span>
      </span>
    );
  }
  return (
    <a
      href={href}
      download={a.name}
      data-testid="email-attachment"
      aria-label={t('download', { name: a.name, size: humanSize(a.size) })}
      className={cn(chip, 'hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary')}
    >
      <span className="truncate">{a.name}</span>
      <span className="shrink-0 text-muted-foreground">{humanSize(a.size)}</span>
    </a>
  );
}
