'use client';

import { useState } from 'react';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { REALTIME_EVENT } from '@crm/contracts';
import { Button } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useRealtimeClient, useRealtimeStatus } from '@/lib/realtime';
import { KEYS, usePendingCalls } from '../api/calling';
import { digitsOf, freshestRinging } from '../lib/calls';
import { useCalling } from './calling-provider';
import { PhoneIcon } from './icons';

/**
 * The incoming WhatsApp call popup (TW-CALL-012, 013, 015). Learns of a ringing call from a push (`call.changed`), with a poll as the fallback (every 4 s without the socket, every 30 s
 * with it), while the tab is visible and not already in a call. Shows the freshest one with Accept / Decline, or "AI is handling this call..." when an
 * assistant answers it (no buttons, so the operator does not race it). Gone as soon as the poll returns no ringing call.
 */
export function IncomingCallToast() {
  const t = useTranslations('calling-voice.incoming');
  const canUse = useCan('call.calls.use');
  const { busy, acceptIncoming, rejectIncoming } = useCalling();
  // Calls this tab already answered or declined: hidden at once, without waiting for the next poll.
  const [handled, setHandled] = useState<ReadonlySet<string>>(() => new Set());
  const qc = useQueryClient();
  const realtime = useRealtimeClient();
  const pushed = useRealtimeStatus() === 'connected';
  // The server says when a call rang, was answered or ended: refetch then, and poll slowly in between only as a fallback.
  useEffect(() => {
    if (!canUse || !realtime) return;
    return realtime.subscribe(REALTIME_EVENT.callChanged, () => {
      void qc.invalidateQueries({ queryKey: KEYS.pending });
    });
  }, [canUse, realtime, qc]);
  const pending = usePendingCalls(canUse && !busy, pushed);

  const call = busy ? null : freshestRinging(pending.data?.calls ?? [], handled);
  if (!call) return null;

  const mark = () => setHandled((s) => new Set(s).add(call.id));
  const digits = digitsOf(call.fromPhone);
  const name = call.contactName?.trim() || t('caller', { digits });

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label={t('title')}
      className="fixed end-4 top-4 z-50 w-72 rounded-xl border border-border bg-background p-4 shadow-lg"
    >
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        <PhoneIcon className="size-3.5 text-success" />
        {t('title')}
      </div>
      <div className="mt-2 truncate text-base font-semibold">{name}</div>
      <div className="text-xs text-muted-foreground">+{digits}</div>
      {call.aiHandled ? (
        <p className="mt-3 text-xs text-muted-foreground">{t('aiHandling')}</p>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button
            variant="brand"
            className="flex-1 rounded-full"
            onClick={() => {
              mark();
              void acceptIncoming(call);
            }}
          >
            {t('accept')}
          </Button>
          <Button
            variant="secondary"
            className="flex-1 rounded-full text-danger"
            onClick={() => {
              mark();
              void rejectIncoming(call, 'REJECTED');
            }}
          >
            {t('decline')}
          </Button>
        </div>
      )}
    </div>
  );
}
