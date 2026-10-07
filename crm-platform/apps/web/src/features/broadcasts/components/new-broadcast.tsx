'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@crm/ui';
import { useBroadcastChannels } from '../api/channels';
import { PlusIcon } from './icons';

const BUTTON =
  'inline-flex h-10 items-center gap-2 rounded-full bg-brand px-4 text-xs font-semibold text-brand-foreground hover:opacity-90';

const CARD =
  'group block rounded-xl border border-border p-4 transition hover:border-brand hover:bg-muted/40';

/**
 * "New broadcast" (WD-BCAST-003). With only WhatsApp connected it goes straight to the WhatsApp composer; when a Telegram bot is on or
 * an Instagram account is linked it opens the channel chooser, one card per available channel, as WaDesk does.
 */
export function NewBroadcast() {
  const t = useTranslations('broadcasts.chooser');
  const channels = useBroadcastChannels();
  const [open, setOpen] = useState(false);
  const label = (
    <>
      <PlusIcon className="size-3.5" />
      {t('newBroadcast')}
    </>
  );

  if (!channels.telegram && !channels.instagram) {
    return (
      <Link href="/campaigns/wizard" className={BUTTON}>
        {label}
      </Link>
    );
  }
  return (
    <>
      <button type="button" className={BUTTON} onClick={() => setOpen(true)}>
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
          <Link href="/campaigns/wizard" className={CARD}>
            <div className="text-lg font-semibold">{t('whatsapp.name')}</div>
            <p className="mt-1.5 text-xs text-muted-foreground">{t('whatsapp.hint')}</p>
            <div className="mt-3 text-xs font-semibold text-brand">{t('whatsapp.cta')} →</div>
          </Link>
          {channels.telegram && (
            <Link href="/telegram/broadcasts" className={CARD}>
              <div className="text-lg font-semibold">{t('telegram.name')}</div>
              <p className="mt-1.5 text-xs text-muted-foreground">{t('telegram.hint')}</p>
              <div className="mt-3 text-xs font-semibold text-brand">{t('telegram.cta')} →</div>
            </Link>
          )}
          {channels.instagram && (
            <Link href="/instagram/broadcast" className={CARD}>
              <div className="text-lg font-semibold">{t('instagram.name')}</div>
              <p className="mt-1.5 text-xs text-muted-foreground">{t('instagram.hint')}</p>
              <div className="mt-3 text-xs font-semibold text-brand">{t('instagram.cta')} →</div>
            </Link>
          )}
        </div>
      </Modal>
    </>
  );
}
