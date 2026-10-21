'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Spinner } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useChannels } from '../api/wechat';
import { ChannelCard } from './channel-card';
import { ConnectModal } from './connect-modal';
import { SendIcon, WECHAT_GREEN } from './wechat-icons';

const STEPS = ['account', 'credentials', 'serverConfig', 'paste', 'back'] as const;
const GOOD = ['certified', 'credentials', 'webhook', 'window'] as const;

/**
 * `/wechat`: connect an Official Account by its AppID, AppSecret and Token, see the connected channels with the address and Token to
 * paste into the WeChat console, and the setup guide. (Reference's Menu and Insights pages are not built yet: recorded as blocked.)
 */
export function HubScreen() {
  const t = useTranslations('wechat.hub');
  const channels = useChannels();
  const canManage = useCan('wechat.channels.manage');
  const canBroadcasts = useCan('wechat.broadcasts.read');
  const [open, setOpen] = useState(false);
  const list = channels.data?.data ?? [];
  // Banned in some countries (India): the workspace cannot connect a channel or send, and the entry points stay hidden.
  const blocked = channels.data !== undefined && !channels.data.availability.available;

  return (
    <main className="mx-auto max-w-none space-y-6 px-4 py-7 sm:px-6 lg:px-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('kicker')}
          </div>
          <h1 className="text-3xl font-normal leading-none tracking-tight sm:text-[38px]">
            {t('title')}{' '}
            <span className="not-italic" style={{ color: WECHAT_GREEN }}>
              {t('titleAccent')}
            </span>
          </h1>
          <p className="mt-2 max-w-xl text-[13px] text-muted-foreground">{t('intro')}</p>
        </div>
        {list.length > 0 && canBroadcasts && !blocked && (
          <Link
            href="/wechat/broadcasts"
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-4 text-xs font-semibold text-white"
            style={{ background: WECHAT_GREEN }}
          >
            <SendIcon className="size-3.5" />
            {t('broadcasts')}
          </Link>
        )}
      </div>

      {channels.isError && <Alert tone="danger">{t('loadError')}</Alert>}
      {blocked && <Alert tone="warning">{t('unavailableCountry')}</Alert>}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-2xl border border-border bg-background p-6 shadow-sm">
            <h2 className="text-[22px] leading-tight">{t('connectTitle')}</h2>
            <p className="mt-1 text-[12.5px] text-muted-foreground">{t('connectBody')}</p>
            {canManage && !blocked && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="mt-4 inline-flex h-9 items-center rounded-full px-4 text-xs font-semibold text-white hover:opacity-90"
                style={{ background: WECHAT_GREEN }}
              >
                {t('connect')}
              </button>
            )}
          </section>

          <section className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <span className="text-[13px] font-semibold">{t('connectedTitle')}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{list.length}</span>
            </div>
            <div className="divide-y divide-border/60">
              {channels.isLoading ? (
                <div className="flex justify-center py-6">
                  <Spinner />
                </div>
              ) : list.length === 0 ? (
                <div className="px-5 py-6 text-center text-xs text-muted-foreground">
                  {t('empty')}
                </div>
              ) : (
                list.map((c) => <ChannelCard key={c.id} channel={c} canManage={canManage} />)
              )}
            </div>
          </section>
        </div>

        <aside className="rounded-2xl border border-border bg-background p-5 shadow-sm">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('guideKicker')}
          </div>
          <h3 className="mt-0.5 text-lg leading-tight">{t('guideTitle')}</h3>
          <ol className="mt-3 list-inside list-decimal space-y-2.5 text-xs text-foreground/80">
            {STEPS.map((k) => (
              <li key={k}>{t(`steps.${k}`)}</li>
            ))}
          </ol>
          <p className="mt-3 text-[11px] text-muted-foreground">{t('guideNote')}</p>
          <div className="mt-4 border-t border-border/60 pt-3">
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('goodTitle')}
            </div>
            <ul className="space-y-1.5 text-[11.5px] text-muted-foreground">
              {GOOD.map((k) => (
                <li key={k} className="flex gap-2">
                  <span style={{ color: WECHAT_GREEN }}>•</span>
                  {t(`good.${k}`)}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      <ConnectModal open={open} onClose={() => setOpen(false)} />
    </main>
  );
}
