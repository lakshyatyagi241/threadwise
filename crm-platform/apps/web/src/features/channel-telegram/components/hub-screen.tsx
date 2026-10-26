'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Spinner } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useBots } from '../api/telegram';
import { BotCard } from './bot-card';
import { ConnectModal } from './connect-modal';
import { ArrowRightIcon, BulbIcon, InfoIcon, PersonIcon, TelegramGlyph } from './tg-icons';

const TG = '#229ED9';
const STEPS = ['locate', 'create', 'token', 'connect'] as const;
const UNLOCKED = ['support', 'broadcast', 'media'] as const;
const PRE = ['account', 'name', 'app'] as const;
const pillLink =
  'inline-flex h-9 items-center rounded-full border border-border bg-background px-4 text-xs font-medium hover:bg-muted';

/**
 * `/telegram` (TW-TG-001, 002, 007): connect a bot by token, see and manage the connected bots, and the setup guide.
 * The Telegram account card (TW-TG-015 to 017) is shown as Reference has it, but linking an account needs the Node bridge.
 */
export function HubScreen() {
  const t = useTranslations('telegram.hub');
  const bots = useBots();
  const canManage = useCan('tg.bots.manage');
  const canBroadcast = useCan('tg.broadcasts.read');
  const [open, setOpen] = useState(false);
  const list = bots.data?.data ?? [];
  const count = list.length;

  return (
    <main className="mx-auto max-w-none space-y-6 px-4 py-7 sm:px-6 lg:px-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('kicker')}
          </div>
          <h1 className="text-3xl font-normal leading-none tracking-tight sm:text-[40px]">
            {t('title')} <span className="not-italic text-brand">{t('titleAccent')}</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link href="/inbox" className={pillLink}>
            {t('teamInbox')}
          </Link>
          <Link href="/flows" className={pillLink}>
            {t('flows')}
          </Link>
          <Link href="/broadcasts" className={pillLink}>
            {t('broadcasts')}
          </Link>
          {canBroadcast && (
            <Link href="/telegram/broadcasts" className={pillLink}>
              {t('telegramBroadcasts')}
            </Link>
          )}
        </div>
      </div>

      {bots.isError && <Alert tone="danger">{t('loadError')}</Alert>}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_400px]">
        <div className="min-w-0 space-y-5">
          <div className="rounded-2xl border border-border bg-gradient-to-br from-[#EAF6FC] to-background p-5 shadow-sm sm:p-6 dark:from-muted dark:to-background">
            <div className="flex items-start justify-between gap-3">
              <span
                className="grid size-12 shrink-0 place-items-center rounded-2xl text-white"
                style={{ background: TG }}
              >
                <TelegramGlyph className="size-6" />
              </span>
              {count > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2.5 py-1 font-mono text-[11px] text-success">
                  <span className="size-1.5 rounded-full bg-success" />
                  {t('connectedCount', { count })}
                </span>
              ) : (
                <span className="rounded-full border border-border bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
                  {t('notConnected')}
                </span>
              )}
            </div>
            <div className="mt-4 text-[22px] leading-tight">{t('botCardTitle')}</div>
            <p className="mt-1.5 max-w-lg text-xs leading-relaxed text-muted-foreground">
              {t('botCardBody')}
            </p>
            {canManage && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setOpen(true)}
                  className="inline-flex h-10 items-center gap-2 rounded-full px-4 text-[13px] font-semibold text-white transition hover:opacity-90"
                  style={{ background: TG }}
                >
                  {count > 0 ? t('connectAnother') : t('connectBot')}
                  <ArrowRightIcon className="size-3.5" />
                </button>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-background p-5 shadow-sm sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <span
                className="grid size-12 shrink-0 place-items-center rounded-2xl text-white"
                style={{ background: '#1B7CB0' }}
              >
                <PersonIcon className="size-6" />
              </span>
              <span className="rounded-full border border-border bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
                {t('notConnected')}
              </span>
            </div>
            <div className="mt-4 text-[22px] leading-tight">{t('accountCardTitle')}</div>
            <p className="mt-1.5 max-w-lg text-xs leading-relaxed text-muted-foreground">
              {t('accountCardBody')}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled
                className="inline-flex h-10 cursor-not-allowed items-center gap-2 rounded-full px-4 text-[13px] font-semibold text-white opacity-50"
                style={{ background: '#1B7CB0' }}
              >
                {t('connectAccount')}
                <ArrowRightIcon className="size-3.5" />
              </button>
              <span className="text-[11px] text-muted-foreground">{t('accountUnavailable')}</span>
            </div>
          </div>

          {bots.isLoading ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : (
            count > 0 && (
              <div className="space-y-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {t('connectedBots')}
                </div>
                {list.map((b) => (
                  <BotCard key={b.id} bot={b} canManage={canManage} />
                ))}
              </div>
            )
          )}
        </div>

        <aside className="space-y-5 lg:sticky lg:top-6">
          <div className="overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-[#EAF6FC] to-background shadow-sm dark:from-muted dark:to-background">
            <div className="flex items-start gap-3 border-b border-border/70 px-5 py-4">
              <span
                className="grid size-10 shrink-0 place-items-center rounded-2xl text-white"
                style={{ background: TG }}
              >
                <TelegramGlyph className="size-5" />
              </span>
              <div>
                <div className="text-lg leading-tight">{t('guideTitle')}</div>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">{t('guideBody')}</p>
              </div>
            </div>
            <div className="px-5 py-4">
              <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                <InfoIcon className="size-3" />
                {t('prerequisites')}
              </div>
              <ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
                {PRE.map((k) => (
                  <li key={k} className="flex items-center gap-2">
                    <span className="size-1.5 shrink-0 rounded-full bg-success" />
                    {t(`pre.${k}`)}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-background p-5 shadow-sm">
            <div className="mb-3 text-[13px] font-semibold">{t('stepsTitle')}</div>
            <div className="space-y-4">
              {STEPS.map((k, i) => (
                <div key={k} className="flex items-start gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-[#EAF6FC] font-mono text-xs text-[#1B7CB0]">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="mb-1 inline-block rounded-md bg-success/10 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-success">
                      {t('step', { n: i + 1 })}
                    </div>
                    <div className="text-[13px] font-semibold leading-tight">
                      {t(`steps.${k}.title`)}
                    </div>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                      {t(`steps.${k}.body`)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-background p-5 shadow-sm">
            <div className="mb-3 text-[13px] font-semibold">{t('unlockedTitle')}</div>
            <div className="grid grid-cols-1 gap-3">
              {UNLOCKED.map((k) => (
                <div key={k} className="rounded-xl border border-border p-3.5">
                  <div className="text-[12.5px] font-semibold">{t(`unlocked.${k}.title`)}</div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {t(`unlocked.${k}.body`)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4">
            <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-warning">
              <BulbIcon className="size-3.5" />
              {t('tipTitle')}
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-warning/90">{t('tipBody')}</p>
          </div>
        </aside>
      </div>

      <ConnectModal open={open} onClose={() => setOpen(false)} />
    </main>
  );
}
