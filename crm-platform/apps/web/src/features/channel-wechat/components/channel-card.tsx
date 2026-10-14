'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ConfirmDialog, useToast } from '@crm/ui';
import type { WechatChannel } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { KEYS, recheckChannel, removeChannel, toggleChannel, useServerConfig } from '../api/wechat';
import { CopyField } from './copy-field';
import { WechatBadge } from './wechat-icons';

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

const smallButton =
  'rounded-lg border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50';

/**
 * One connected channel: its state, the address and Token to paste into the WeChat console (the Token only when asked for, and only
 * for people who can manage the channel), and Re-check, Pause or Enable, and Remove.
 */
export function ChannelCard({
  channel,
  canManage,
}: {
  channel: WechatChannel;
  canManage: boolean;
}) {
  const t = useTranslations('wechat.channel');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [reveal, setReveal] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const config = useServerConfig(channel.id, canManage && reveal);

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

  const recheck = async () => {
    setBusy(true);
    try {
      const res = await recheckChannel(channel.id);
      if (res.checkError) toast(t('recheckFailed', { error: res.checkError }), 'danger');
      else toast(t('rechecked'), 'success');
      await refresh();
    } catch (e) {
      toast(message(e, t('failed')), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const token = reveal && config.data ? config.data.verifyToken : null;

  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:gap-4">
      <WechatBadge />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold">
          {channel.accountName || t('fallbackName')}
          {channel.wxId && (
            <span className="ms-1.5 font-mono text-[11px] font-normal text-muted-foreground">
              {channel.wxId}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {channel.active ? t('active') : t('paused')} ·{' '}
          <span className="font-mono">{channel.appId}</span>
          {channel.lastError && <span className="text-danger"> · {channel.lastError}</span>}
        </div>
        <div className="mt-2 space-y-1.5 rounded-xl border border-border bg-muted/50 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {t('pasteTitle')}
          </div>
          <CopyField label={t('url')} value={channel.webhookUrl} />
          {canManage && (
            <CopyField
              label={t('token')}
              value={token}
              trailing={
                <button
                  type="button"
                  className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium hover:bg-muted"
                  onClick={() => setReveal((v) => !v)}
                >
                  {reveal ? t('hideToken') : t('showToken')}
                </button>
              }
            />
          )}
          {reveal && config.isError && (
            <div className="text-[10.5px] text-danger">{t('tokenError')}</div>
          )}
        </div>
      </div>
      {canManage && (
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className={smallButton}
            disabled={busy}
            onClick={() => void recheck()}
          >
            {t('recheck')}
          </button>
          <button
            type="button"
            className={smallButton}
            disabled={busy}
            onClick={() =>
              void run(
                () => toggleChannel(channel.id),
                channel.active ? t('pausedDone') : t('enabled'),
              )
            }
          >
            {channel.active ? t('pause') : t('enable')}
          </button>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-[11px] text-danger hover:bg-danger/10 disabled:opacity-50"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            {t('remove')}
          </button>
        </div>
      )}

      {canManage && (
        <ConfirmDialog
          open={confirming}
          tone="danger"
          busy={busy}
          title={t('remove')}
          message={t('removeConfirm')}
          confirmLabel={t('remove')}
          cancelLabel={t('cancel')}
          onClose={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void run(() => removeChannel(channel.id), t('removed'));
          }}
        />
      )}
    </div>
  );
}
