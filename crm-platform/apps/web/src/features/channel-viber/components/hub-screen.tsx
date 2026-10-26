'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Spinner } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useChannels } from '../api/viber';
import { ChannelCard } from './channel-card';
import { ConnectForm } from './connect-form';
import { SendIcon, VIBER } from './viber-icons';

const KNOW = ['know1', 'know2', 'know3', 'know4', 'know5'] as const;
const pillLink =
  'inline-flex h-9 items-center rounded-full border border-border bg-background px-4 text-xs font-medium hover:bg-muted';

/** `/viber` (TW-VIB-001, 002, 007): connect a Viber Public Account by token, see and manage the connected channels, and the setup guide. */
export function HubScreen() {
  const t = useTranslations('viber.hub');
  const channels = useChannels();
  const canManage = useCan('viber.channels.manage');
  const canBroadcast = useCan('viber.broadcasts.read');
  const list = channels.data?.data ?? [];

  return (
    <main className="mx-auto max-w-none space-y-6 px-4 py-7 sm:px-6 lg:px-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('kicker')}
          </div>
          <h1 className="text-3xl font-normal leading-none tracking-tight sm:text-[38px]">
            {t('title')}{' '}
            <span className="not-italic" style={{ color: VIBER }}>
              {t('titleAccent')}
            </span>
          </h1>
          <p className="mt-2 max-w-xl text-[13px] text-muted-foreground">{t('intro')}</p>
        </div>
        {list.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link href="/viber/insights" className={pillLink}>
              {t('insights')}
            </Link>
            {canBroadcast && (
              <Link
                href="/viber/broadcasts"
                className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-xs font-semibold text-white"
                style={{ background: VIBER }}
              >
                <SendIcon className="size-3.5" />
                {t('broadcasts')}
              </Link>
            )}
          </div>
        )}
      </div>

      {channels.isError && <Alert tone="danger">{t('loadError')}</Alert>}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          {canManage && <ConnectForm />}

          <section className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <span className="text-[13px] font-semibold">{t('connectedTitle')}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{list.length}</span>
            </div>
            {channels.isLoading ? (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            ) : list.length === 0 ? (
              <div className="px-5 py-6 text-center text-xs text-muted-foreground">{t('none')}</div>
            ) : (
              <div className="divide-y divide-border/60">
                {list.map((c) => (
                  <ChannelCard key={c.id} channel={c} canManage={canManage} />
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-border bg-background p-5 shadow-sm">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('howKicker')}
            </div>
            <h3 className="mt-0.5 text-lg leading-tight">{t('howTitle')}</h3>
            <ol className="mt-3 list-inside list-decimal space-y-2.5 text-xs">
              <li>{t('how1')}</li>
              <li>{t('how2')}</li>
              <li>{t('how3')}</li>
            </ol>
          </div>

          <div className="rounded-2xl border border-warning/30 bg-warning/5 p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-warning">
              {t('knowKicker')}
            </div>
            <ul className="mt-2 space-y-2 text-xs">
              {KNOW.map((k) => (
                <li key={k} className="flex gap-2">
                  <span style={{ color: VIBER }}>•</span>
                  {t(k)}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </main>
  );
}
