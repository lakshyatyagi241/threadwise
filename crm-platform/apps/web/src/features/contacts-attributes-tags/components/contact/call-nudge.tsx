'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, cn } from '@crm/ui';
import { useCanLogCall } from '../../api/call-log';
import {
  CALL_NUDGE,
  dismissCallPrompt,
  pendingCall,
  rememberCallClick,
  shouldAsk,
  type PendingCall,
} from '../../lib/call-log';
import { PhoneIcon, XIcon } from '../icons';

/** Fired when a click on a phone number was remembered or a prompt was answered, so a mounted prompt looks again. */
const CALL_EVENT = 'crm:call-prompt';

/** The click lives for this browser tab; what the person dismissed is remembered per contact for good. */
const stores = () => {
  try {
    return { pending: window.sessionStorage, dismissed: window.localStorage };
  } catch {
    return null;
  }
};

/** The person clicked to call this contact on the phone (a `tel:` link): ask how it went when they come back. */
export function rememberPhoneClick(contactId: string): void {
  const s = stores();
  if (s) rememberCallClick(s.pending, contactId, Date.now());
}

/** Tells a mounted prompt that something changed. */
export function notifyCallClick(): void {
  window.dispatchEvent(new Event(CALL_EVENT));
}

/** The call was logged (or the prompt dismissed) from somewhere else: this click is done with. */
export function settlePendingCall(contactId: string): void {
  const s = stores();
  if (!s) return;
  const call = pendingCall(s.pending, s.dismissed, contactId, Date.now());
  if (call) dismissCallPrompt(s.pending, s.dismissed, call);
  notifyCallClick();
}

/**
 * Whether to ask "How did the call go?" about this contact now. A `tel:` click cannot be told apart from a call that was made, so
 * the prompt waits for the person to come back to the page after a real absence (`CALL_NUDGE.minAwaySeconds`), or for half a minute
 * after the click if the page never lost them; a click older than half an hour is forgotten. It is a hint, never a blocker.
 */
export function useCallPrompt(contactId: string, enabled: boolean) {
  const [call, setCall] = useState<PendingCall | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let away: number | null = document.hidden ? Date.now() : null;
    let timer: number | undefined;

    const current = () => {
      const s = stores();
      return s ? pendingCall(s.pending, s.dismissed, contactId, Date.now()) : null;
    };
    const ask = (awayMs: number) => {
      const p = current();
      if (p && shouldAsk(awayMs, Date.now() - p.clickedAt)) setCall(p);
    };
    const schedule = () => {
      window.clearTimeout(timer);
      const p = current();
      if (!p) {
        setCall(null);
        return;
      }
      const wait = Math.max(0, CALL_NUDGE.idleSeconds * 1000 - (Date.now() - p.clickedAt));
      timer = window.setTimeout(() => {
        if (!document.hidden) ask(0);
      }, wait);
    };
    const left = () => {
      away ??= Date.now();
    };
    const back = () => {
      const awayMs = away === null ? 0 : Date.now() - away;
      away = null;
      ask(awayMs);
    };
    const onVisibility = () => (document.hidden ? left() : back());

    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', left);
    window.addEventListener('focus', back);
    window.addEventListener(CALL_EVENT, schedule);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', left);
      window.removeEventListener('focus', back);
      window.removeEventListener(CALL_EVENT, schedule);
    };
  }, [contactId, enabled]);

  const dismiss = useCallback(() => {
    const s = stores();
    if (s && call) dismissCallPrompt(s.pending, s.dismissed, call);
    setCall(null);
  }, [call]);

  return { call: enabled ? call : null, dismiss };
}

/**
 * "How did the call go? Log it": a quiet line over the activity, shown after the person clicked a phone number of this contact and came
 * back. "Log it" opens the call form of the compose box with the time of the click; the cross dismisses it for that click. It never
 * covers the page and nothing waits for it.
 */
export function CallNudge({
  contactId,
  name,
  onLog,
  className,
}: {
  contactId: string;
  name: string;
  className?: string;
  /** Opens the compose box on the Call tab, starting at the time of the click. */
  onLog: (clickedAt: number) => void;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.record.callNudge');
  const canLog = useCanLogCall();
  const { call, dismiss } = useCallPrompt(contactId, canLog);
  if (!call) return null;
  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm',
        className,
      )}
    >
      <PhoneIcon className="size-4 shrink-0 text-primary" />
      <p className="min-w-0 flex-1" dir="auto">
        {t('question', { name })}
      </p>
      <Button size="sm" onClick={() => onLog(call.clickedAt)}>
        {t('log')}
      </Button>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('dismiss')}
        title={t('dismiss')}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}
