'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@crm/ui';
import { useBroadcastChannels } from '../api/channels';
import { channelCards } from '../lib/channel-cards';
import { PlusIcon } from './icons';

const BUTTON =
  'inline-flex h-10 items-center gap-2 rounded-full bg-brand px-4 text-xs font-semibold text-brand-foreground hover:opacity-90';
const LINK =
  'block w-full rounded-xl px-3 py-2 text-center text-xs font-semibold text-brand hover:bg-muted';

const CARD =
  'group block rounded-xl border border-border p-4 transition hover:border-brand hover:bg-muted/40';

/**
 * "New campaign" / "New broadcast" (TW-BCAST-003). With only WhatsApp connected it goes straight to the campaign builder; when a Telegram
 * bot is on, a Facebook Page is connected, an Instagram account is linked or an SMS sender is on it opens the channel chooser, one card
 * per available channel, as Reference does. `label` and `variant` let the Campaigns screen use it as its "New campaign" button (a
 * filled button) or as a text link in the side rail; the legacy broadcasts list keeps its own wording.
 */
export function NewBroadcast({
  label: custom,
  variant = 'button',
}: {
  label?: string;
  variant?: 'button' | 'link';
} = {}) {
  const t = useTranslations('broadcasts.chooser');
  const sms = useTranslations('sms.chooser');
  const channels = useBroadcastChannels();
  const [open, setOpen] = useState(false);
  const style = variant === 'link' ? LINK : BUTTON;
  const label =
    variant === 'link' ? (
      <>{custom ?? t('newBroadcast')} →</>
    ) : (
      <>
        <PlusIcon className="size-3.5" />
        {custom ?? t('newBroadcast')}
      </>
    );

  const cards = channelCards(channels);

  if (cards.length === 1) {
    return (
      <Link href="/campaigns/create" className={style}>
        {label}
      </Link>
    );
  }
  return (
    <>
      <button type="button" className={style} onClick={() => setOpen(true)}>
        {label}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        eyebrow={t('eyebrow')}
        title={t('title')}
        closeLabel={t('close')}
        size="md"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {cards.map((c) => {
            const tc = c.id === 'sms' ? sms : (k: string) => t(`${c.id}.${k}`);
            return (
              <Link key={c.id} href={c.href} className={CARD}>
                <div className="text-lg font-semibold">{tc('name')}</div>
                <p className="mt-1.5 text-xs text-muted-foreground">{tc('hint')}</p>
                <div className="mt-3 text-xs font-semibold text-brand">{tc('cta')} →</div>
              </Link>
            );
          })}
        </div>
      </Modal>
    </>
  );
}
