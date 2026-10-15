'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button, ConfirmDialog, useToast, cn } from '@crm/ui';
import type { ViberChannelResponse } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { KEYS, removeChannel, retryWebhook, toggleChannel } from '../api/viber';
import { ViberMark } from './viber-icons';

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const action =
  'rounded-lg border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50';

/** One connected channel: its name and address, health, and the Re-hook, Pause or Enable and Remove actions (TW-VIB-001, 007). */
export function ChannelCard({
  channel,
  canManage,
}: {
  channel: ViberChannelResponse;
  canManage: boolean;
}) {
  const t = useTranslations('viber.channel');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: KEYS.all });
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok, 'success');
      await refresh();
    } catch (e) {
      toast(message(e, t('failed')), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const rehook = async () => {
    setBusy(true);
    try {
      const res = await retryWebhook(channel.id);
      toast(res.webhookError ?? t('rehooked'), res.webhookError ? 'info' : 'success');
      await refresh();
    } catch (e) {
      toast(message(e, t('failed')), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-start gap-4 px-5 py-4">
      <ViberMark />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold">
          {channel.name || t('viberBot')}
          {channel.uri && (
            <span className="ms-2 font-mono text-[11px] font-normal text-muted-foreground">
              viber.com/{channel.uri}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {channel.active ? t('active') : t('paused')}
          {channel.lastError && <span className="text-danger"> · {channel.lastError}</span>}
        </div>
        {channel.lastInboundAt && (
          <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
            {t('lastMessage', { when: new Date(channel.lastInboundAt).toLocaleString() })}
          </div>
        )}
        <div className="mt-1 break-all font-mono text-[10.5px] text-muted-foreground">
          {channel.webhookUrl}
        </div>
      </div>
      {canManage && (
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className={action}
            title={t('rehookTitle')}
            disabled={busy}
            onClick={() => void rehook()}
          >
            {t('rehook')}
          </button>
          <button
            type="button"
            className={action}
            disabled={busy}
            onClick={() =>
              void run(
                () => toggleChannel(channel.id),
                channel.active ? t('pausedDone') : t('enabledDone'),
              )
            }
          >
            {channel.active ? t('pause') : t('enable')}
          </button>
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-auto px-2 py-1 text-[11px] text-danger hover:bg-danger/10')}
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            {t('remove')}
          </Button>
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
