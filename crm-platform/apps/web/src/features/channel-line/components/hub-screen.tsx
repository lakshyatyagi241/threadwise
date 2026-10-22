'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Spinner } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useChannels } from '../api/line';
import { ChannelCard } from './channel-card';
import { ConnectForm } from './connect-form';
import { LINE_GREEN, SendIcon } from './line-icons';

const GUIDE = ['one', 'two', 'three', 'four', 'five'] as const;
const GOOD = ['credentials', 'webhook', 'friend'] as const;

/**
 * `/line`: connect a LINE Official Account by pasting its Channel access token and Channel secret, see and manage the connected
 * channels, and the setup guide. Rich menus and insights are not part of this screen yet (see the inventory).
 */
export function HubScreen() {
  const t = useTranslations('line.hub');
  const channels = useChannels();
  const canManage = useCan('line.channels.manage');
  const canBroadcast = useCan('line.broadcasts.read');
  const list = channels.data?.data ?? [];

  return (
    <main className="mx-auto max-w-none space-y-6 px-4 py-7 sm:px-6 lg:px-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('kicker')}
          </div>
          <h1 className="text-3xl font-normal leading-none tracking-tight sm:text-[38px]">
            {t('title')}{' '}
            <span className="not-italic" style={{ color: LINE_GREEN }}>
              {t('titleAccent')}
            </span>
          </h1>
          <p className="mt-2 max-w-xl text-[13px] text-muted-foreground">{t('intro')}</p>
        </div>
        {list.length > 0 && canBroadcast && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link
              href="/line/broadcasts"
              className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-xs font-semibold text-white"
              style={{ background: LINE_GREEN }}
            >
              <SendIcon className="size-3.5" />
              {t('broadcasts')}
            </Link>
          </div>
        )}
      </div>

      {channels.isError && <Alert tone="danger">{t('loadError')}</Alert>}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {canManage && <ConnectForm />}

          <section className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <span className="text-[13px] font-semibold">{t('connectedChannels')}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{list.length}</span>
            </div>
            {channels.isLoading ? (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            ) : list.length === 0 ? (
              <div className="px-5 py-6 text-center text-xs text-muted-foreground">{t('none')}</div>
            ) : (
              <div className="divide-y divide-border">
                {list.map((c) => (
                  <ChannelCard key={c.id} channel={c} canManage={canManage} />
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="rounded-2xl border border-border bg-background p-5 shadow-sm">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('guideKicker')}
          </div>
          <h3 className="mt-0.5 text-lg leading-tight">{t('guideTitle')}</h3>
          <ol className="mt-3 list-inside list-decimal space-y-2.5 text-xs">
            {GUIDE.map((k) => (
              <li key={k}>{t(`guide.${k}`)}</li>
            ))}
          </ol>
          <p className="mt-3 text-[11px] text-muted-foreground">{t('guideNote')}</p>
          <div className="mt-4 border-t border-border pt-3">
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('goodTitle')}
            </div>
            <ul className="space-y-1.5 text-[11.5px] text-muted-foreground">
              {GOOD.map((k) => (
                <li key={k} className="flex gap-2">
                  <span style={{ color: LINE_GREEN }}>•</span>
                  {t(`good.${k}`)}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </main>
  );
}
