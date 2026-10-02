'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button, Checkbox, ConfirmDialog, Input, useToast, cn } from '@crm/ui';
import type { BotResponse } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { KEYS, removeBot, retryWebhook, savePayments, toggleBot } from '../api/telegram';
import { CardIcon, PauseIcon, PlayIcon, RefreshIcon, TelegramGlyph, TrashIcon } from './tg-icons';

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const shorten = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** One connected bot: its health, payment settings, and the Fix inbound, Pause and Disconnect actions (WD-TG-001, 007). */
export function BotCard({ bot, canManage }: { bot: BotResponse; canManage: boolean }) {
  const t = useTranslations('telegram.bot');
  const qc = useQueryClient();
  const { toast } = useToast();
  const live = bot.active && !bot.lastError;
  const [token, setToken] = useState('');
  const [clear, setClear] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: KEYS.all });
  const run = async (action: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await action();
      toast(ok, 'success');
      await refresh();
    } catch (e) {
      toast(message(e, t('failed')), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const fixInbound = async () => {
    setBusy(true);
    try {
      const res = await retryWebhook(bot.id);
      toast(res.webhookError ?? t('webhookFixed'), res.webhookError ? 'info' : 'success');
      await refresh();
    } catch (e) {
      toast(message(e, t('failed')), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const pill = live ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 font-mono text-[10.5px] text-success">
      <span className="size-1.5 rounded-full bg-success" />
      {t('live')}
    </span>
  ) : !bot.active ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground">
      <span className="size-1.5 rounded-full bg-muted-foreground/60" />
      {t('paused')}
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 font-mono text-[10.5px] text-warning">
      <span className="size-1.5 rounded-full bg-warning" />
      {t('needsAttention')}
    </span>
  );

  const iconBtn = 'grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted';

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
      <div className="flex items-start gap-3.5 p-4">
        <span
          className="grid size-12 shrink-0 place-items-center rounded-2xl text-white"
          style={{ background: '#229ED9' }}
        >
          <TelegramGlyph className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold">{bot.name || bot.username}</span>
            {pill}
          </div>
          <div className="font-mono text-xs text-muted-foreground">
            {bot.username ? `@ ${bot.username.replace(/^@/, '')}` : ''}
          </div>
          {bot.lastError && <div className="mt-1 text-[11px] text-danger">{bot.lastError}</div>}
          {bot.lastInboundAt && (
            <div className="mt-1 font-mono text-[10.5px] text-muted-foreground">
              {t('lastMessage', { when: new Date(bot.lastInboundAt).toLocaleString() })}
            </div>
          )}
        </div>
      </div>

      {canManage && (
        <details className="border-t border-border">
          <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-2.5 text-xs text-muted-foreground hover:bg-muted/50">
            <CardIcon className="size-3.5" />
            {t('payments')}
            {bot.hasPaymentToken && (
              <span className="rounded-full bg-success/10 px-1.5 py-0.5 font-mono text-[10px] text-success">
                {t('on')}
              </span>
            )}
          </summary>
          <form
            className="space-y-2 px-4 pb-4 pt-1"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await savePayments(bot.id, {
                  paymentProviderToken: token,
                  clearPaymentToken: clear,
                });
                setToken('');
                setClear(false);
              }, t('paymentsSaved'));
            }}
          >
            <p className="text-[11px] leading-snug text-muted-foreground">{t('paymentsHint')}</p>
            <Input
              type="password"
              autoComplete="new-password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={bot.hasPaymentToken ? t('paymentsSavedPlaceholder') : '284685063:TEST:…'}
              className="font-mono text-xs"
              aria-label={t('paymentsToken')}
            />
            <div className="flex items-center justify-between gap-2">
              {bot.hasPaymentToken ? (
                <Checkbox
                  id={`clear-${bot.id}`}
                  checked={clear}
                  onChange={(e) => setClear(e.target.checked)}
                  label={<span className="text-[11px]">{t('removeToken')}</span>}
                />
              ) : (
                <span />
              )}
              <Button
                type="submit"
                size="sm"
                className="rounded-full text-white"
                style={{ background: '#229ED9' }}
                disabled={busy}
              >
                {t('save')}
              </Button>
            </div>
          </form>
        </details>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
        <span className="truncate font-mono text-[10.5px] text-muted-foreground">
          {t('webhook')}: {shorten(bot.webhookUrl, 42)}
        </span>
        {canManage && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className={iconBtn}
              title={t('fixInbound')}
              aria-label={t('fixInbound')}
              disabled={busy}
              onClick={() => void fixInbound()}
            >
              <RefreshIcon className="size-3.5" />
            </button>
            <button
              type="button"
              className={iconBtn}
              title={bot.active ? t('pause') : t('resume')}
              aria-label={bot.active ? t('pause') : t('resume')}
              disabled={busy}
              onClick={() =>
                void run(() => toggleBot(bot.id), bot.active ? t('pausedDone') : t('resumedDone'))
              }
            >
              {bot.active ? <PauseIcon className="size-3.5" /> : <PlayIcon className="size-3.5" />}
            </button>
            <button
              type="button"
              className={cn(iconBtn, 'text-danger hover:bg-danger/10')}
              title={t('disconnect')}
              aria-label={t('disconnect')}
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              <TrashIcon className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        tone="danger"
        busy={busy}
        title={t('disconnect')}
        message={t('disconnectConfirm')}
        confirmLabel={t('disconnect')}
        cancelLabel={t('cancel')}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void run(() => removeBot(bot.id), t('disconnected'));
        }}
      />
    </div>
  );
}
