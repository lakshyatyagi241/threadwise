'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { SenderHidden } from '@crm/contracts';
import { senderEmpty } from '../lib/sender-empty';

/**
 * The "Send from" list is empty: say why, with the action that fixes it, never a bare "no senders". The cause comes from the numbers
 * the server left out (`hidden`); `sms` is the SMS card.
 */
export function SenderEmptyNotice({
  id,
  hidden,
  sms = false,
}: {
  id?: string | undefined;
  hidden: readonly SenderHidden[] | undefined;
  sms?: boolean;
}) {
  const t = useTranslations('campaigns.senderEmpty');
  const { cause, count, href } = senderEmpty(hidden, { sms });
  // The SMS card words only "nothing connected" its own way; a personal number never applies to it.
  const key = sms && (cause === 'none' || cause === 'personal_off') ? 'sms.none' : cause;
  return (
    <div
      id={id}
      role="status"
      data-cause={cause}
      className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-[12px] text-foreground"
    >
      <p className="font-semibold">{t(`${key}.title`, { count })}</p>
      <p className="mt-0.5 text-muted-foreground">{t(`${key}.body`, { count })}</p>
      <Link href={href} className="mt-1.5 inline-block font-semibold text-brand hover:underline">
        {t(`${key}.action`)}
      </Link>
    </div>
  );
}

/** A placeholder with the select's shape while the numbers (or the platform switch) are still loading. */
export function SenderLoading({ id }: { id?: string | undefined }) {
  const t = useTranslations('campaigns.senderEmpty');
  return (
    <div
      id={id}
      role="status"
      aria-busy="true"
      aria-label={t('loading')}
      className="h-9 w-full animate-pulse rounded-lg border border-border bg-muted"
    />
  );
}
