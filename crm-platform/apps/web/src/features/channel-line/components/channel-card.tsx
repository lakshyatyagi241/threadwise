'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ConfirmDialog, Input, Textarea, useToast, cn } from '@crm/ui';
import type { LineChannelResponse } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { KEYS, removeChannel, retryWebhook, saveRotation, toggleChannel } from '../api/line';
import {
  channelHealth,
  needsChannelId,
  rotationActionKey,
  rotationBody,
  shortWebhook,
  turnsRotationOff,
} from '../lib/channel-model';
import { ChevronIcon, LINE_GREEN } from './line-icons';

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const smallBtn =
  'rounded-lg border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50';

/** One connected channel: its health, token rotation, and the Re-hook, Pause and Remove actions. */
export function ChannelCard({
  channel,
  canManage,
}: {
  channel: LineChannelResponse;
  canManage: boolean;
}) {
  const t = useTranslations('line.channel');
  const qc = useQueryClient();
  const { toast } = useToast();
  const health = channelHealth(channel);
  const [kid, setKid] = useState(channel.assertionKid ?? '');
  const [key, setKey] = useState('');
  const [channelId, setChannelId] = useState('');
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

  const rotate = async () => {
    const off = turnsRotationOff({ kid, key });
    setBusy(true);
    try {
      await saveRotation(channel.id, rotationBody({ kid, key, channelId }));
      toast(off ? t('rotationDisabled') : t('rotationEnabled'), 'success');
      setKey('');
      if (off) setKid('');
    } catch (e) {
      toast(message(e, t('failed')), 'danger');
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const pill =
    health === 'live' ? (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 font-mono text-[10.5px] text-success">
        <span className="size-1.5 rounded-full bg-success" />
        {t('active')}
      </span>
    ) : health === 'paused' ? (
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

  return (
    <div className="flex items-start gap-4 px-5 py-4">
      <span
        className="grid size-10 shrink-0 place-items-center rounded-xl text-[13px] font-bold text-white"
        style={{ background: LINE_GREEN }}
        aria-hidden="true"
      >
        L
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold">
            {channel.displayName || t('fallbackName')}
          </span>
          {channel.basicId && (
            <span className="font-mono text-[11px] text-muted-foreground">{channel.basicId}</span>
          )}
          {pill}
        </div>
        {channel.lastError && (
          <div className="mt-0.5 text-[11px] text-danger">{channel.lastError}</div>
        )}
        {channel.lastInboundAt && (
          <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
            {t('lastMessage', { when: new Date(channel.lastInboundAt).toLocaleString() })}
          </div>
        )}
        <div className="mt-1 break-all font-mono text-[10.5px] text-muted-foreground">
          {t('webhook')}: {shortWebhook(channel.webhookUrl)}
        </div>

        {canManage && (
          <details className="group mt-2">
            <summary className="inline-flex cursor-pointer select-none items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
              <ChevronIcon className="size-3 transition-transform group-open:rotate-90" />
              {t('rotation')}
              {channel.rotationEnabled && (
                <span
                  className="ms-1 rounded-full px-1.5 py-0.5 font-mono text-[9px]"
                  style={{ background: '#EAF9F0', color: '#0B8043' }}
                >
                  {t('on')}
                </span>
              )}
            </summary>
            <form
              className="mt-2 space-y-2 rounded-xl border border-border bg-muted/40 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void rotate();
              }}
            >
              <p className="text-[10.5px] leading-snug text-muted-foreground">
                {t('rotationHint')}
              </p>
              <Input
                value={kid}
                onChange={(e) => setKid(e.target.value)}
                placeholder={t('kidPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                aria-label={t('kidPlaceholder')}
                className="font-mono text-[11px]"
              />
              <Textarea
                rows={3}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={channel.rotationEnabled ? t('keySaved') : t('keyPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                aria-label={t('keyPlaceholder')}
                className="font-mono text-[10.5px]"
              />
              {needsChannelId(channel) && (
                <div>
                  <Input
                    value={channelId}
                    onChange={(e) => setChannelId(e.target.value)}
                    inputMode="numeric"
                    placeholder={t('channelIdPlaceholder')}
                    autoComplete="off"
                    aria-label={t('channelIdLabel')}
                    className="font-mono text-[11px]"
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground">{t('channelIdHint')}</p>
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-full px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                  style={{ background: LINE_GREEN }}
                >
                  {t(rotationActionKey(channel))}
                </button>
                {channel.rotationEnabled && channel.rotationExpiresAt && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {t('renews', {
                      when: new Date(channel.rotationExpiresAt).toLocaleDateString(),
                    })}
                  </span>
                )}
              </div>
            </form>
          </details>
        )}
      </div>

      {canManage && (
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" className={smallBtn} disabled={busy} onClick={() => void rehook()}>
            {t('rehook')}
          </button>
          <button
            type="button"
            className={smallBtn}
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
          <button
            type="button"
            className={cn(smallBtn, 'border-transparent text-danger hover:bg-danger/10')}
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
