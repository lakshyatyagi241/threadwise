'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { usePendingCalls } from '../api/calling';
import { digitsOf, freshestRinging } from '../lib/calls';
import { useCalling } from './calling-provider';
import { PhoneIcon } from './icons';

/**
 * The incoming WhatsApp call popup (TW-CALL-012, 013, 015). Asks for ringing calls every 4 s while the tab is visible, not
 * while this tab is already in a call. Shows the freshest one with Accept / Decline, or "AI is handling this call..." when an
 * assistant answers it (no buttons, so the operator does not race it). Gone as soon as the poll returns no ringing call.
 */
export function IncomingCallToast() {
  const t = useTranslations('calling-voice.incoming');
  const canUse = useCan('call.calls.use');
  const { busy, acceptIncoming, rejectIncoming } = useCalling();
  // Calls this tab already answered or declined: hidden at once, without waiting for the next poll.
  const [handled, setHandled] = useState<ReadonlySet<string>>(() => new Set());
  const pending = usePendingCalls(canUse && !busy);

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
      className="fixed right-4 top-4 z-50 w-72 rounded-xl border border-border bg-background p-4 shadow-lg"
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
