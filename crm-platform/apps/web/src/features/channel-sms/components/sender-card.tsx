'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button, ConfirmDialog, useToast, cn } from '@crm/ui';
import type { SmsSenderResponse } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { KEYS, removeSender, toggleSender } from '../api/sms';
import { smsErrorKey } from '../lib/api-errors';

const PROVIDER_STYLE = {
  twilio: 'bg-success/10 text-success',
  msg91: 'bg-warning/10 text-warning',
} as const;

const dash = '—';

/** One connected sender (TW-SMS-001, 006, 007): number, provider, status, rate, the MSG91 DLT rows and the Activate and Remove actions. */
export function SenderCard({
  sender,
  canManage,
}: {
  sender: SmsSenderResponse;
  canManage: boolean;
}) {
  const t = useTranslations('sms.card');
  const root = useTranslations('sms');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const msg91 = sender.provider === 'msg91';

  const run = async (action: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await action();
      toast(ok, 'success');
      await qc.invalidateQueries({ queryKey: KEYS.all });
    } catch (e) {
      const key = e instanceof ApiError ? smsErrorKey(e.code) : null;
      toast(key ? root(key) : e instanceof ApiError ? e.message : t('failed'), 'danger');
      // A stale row version means the list is behind: reload it so the next try uses the new one.
      if (e instanceof ApiError && e.isRowVersionConflict)
        await qc.invalidateQueries({ queryKey: KEYS.all });
    } finally {
      setBusy(false);
    }
  };

  const row = 'flex items-center justify-between gap-3 text-xs';
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 truncate font-mono text-[15px] font-semibold" dir="ltr">
            {sender.fromNumber}
          </span>
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 font-mono text-[10.5px]',
              PROVIDER_STYLE[sender.provider],
            )}
          >
            {sender.label}
          </span>
        </div>
        <div
          className={cn(
            'inline-flex items-center gap-1.5 font-mono text-[11px]',
            sender.active ? 'text-success' : 'text-muted-foreground',
          )}
        >
          <span
            className={cn(
              'size-1.5 rounded-full',
              sender.active ? 'bg-success' : 'bg-muted-foreground/60',
            )}
          />
          {sender.active ? t('active') : t('inactive')}
        </div>
        <div className="space-y-1.5 border-t border-border pt-3">
          <div className={row}>
            <span className="text-muted-foreground">{t('rate')}</span>
            <span className="font-mono">
              {sender.ratePerSegment ? `${sender.ratePerSegment} ${sender.currency}` : dash}
            </span>
          </div>
          {msg91 && (
            <>
              <div className={row}>
                <span className="text-muted-foreground">{t('dltSender')}</span>
                <span className="font-mono">{sender.senderId || dash}</span>
              </div>
              <div className={row}>
                <span className="text-muted-foreground">{t('dltTemplate')}</span>
                <span className="truncate font-mono">{sender.dltTemplateId || dash}</span>
              </div>
            </>
          )}
        </div>
        {sender.alphanumeric && (
          <p className="text-[11px] leading-snug text-muted-foreground">{t('alphanumeric')}</p>
        )}
      </div>
      {canManage && (
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button
            size="sm"
            variant="secondary"
            className="rounded-full"
            disabled={busy}
            onClick={() =>
              void run(
                () => toggleSender(sender.id, !sender.active, sender.rowVersion),
                sender.active ? t('deactivated') : t('activated'),
              )
            }
          >
            {sender.active ? t('deactivate') : t('activate')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="rounded-full text-danger"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            {t('remove')}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        tone="danger"
        busy={busy}
        title={t('removeTitle')}
        message={t('removeConfirm')}
        confirmLabel={t('remove')}
        cancelLabel={t('cancel')}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void run(() => removeSender(sender.id), t('removed'));
        }}
      />
    </div>
  );
}
