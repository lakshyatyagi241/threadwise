'use client';

import { useTranslations } from 'next-intl';

/**
 * The email campaign's preview: a simple mail card with the sender's address, the subject (the Header field, else the campaign name, as
 * the server sends it) and the typed body as plain text. The unsubscribe link the server adds is named under the body.
 */
export function EmailPreview({
  from,
  subject,
  campaignName,
  body,
}: {
  /** The mailbox, "Name · address@example.com"; null until one is picked. */
  from: string | null;
  /** The Header field. */
  subject: string;
  campaignName: string;
  body: string;
}) {
  const t = useTranslations('campaigns.builder.preview');
  const shownSubject = subject.trim() !== '' ? subject : campaignName.trim();
  return (
    <div
      className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm"
      data-testid="email-preview"
    >
      <div className="border-b border-border bg-muted/40 px-4 py-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {t('emailTitle')}
        </div>
        <dl className="mt-2 space-y-1 text-[12.5px]">
          <div className="flex gap-2">
            <dt className="w-14 shrink-0 text-muted-foreground">{t('emailFrom')}</dt>
            <dd className="min-w-0 break-words font-medium">{from ?? t('emailNoSender')}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-14 shrink-0 text-muted-foreground">{t('emailSubject')}</dt>
            <dd className="min-w-0 break-words font-semibold">
              {shownSubject !== '' ? shownSubject : t('emailNoSubject')}
            </dd>
          </div>
        </dl>
      </div>
      <div className="min-h-32 px-4 py-4 text-[13px]">
        {body.trim() !== '' ? (
          <p className="whitespace-pre-wrap break-words">{body}</p>
        ) : (
          <p className="text-muted-foreground">{t('emailEmpty')}</p>
        )}
      </div>
      <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        {t('emailUnsubscribe')}
      </p>
    </div>
  );
}
