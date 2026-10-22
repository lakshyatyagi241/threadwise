'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ReminderTestSendResult } from '@crm/contracts';
import { Button } from '@crm/ui';
import { sequencesApi } from '../api/sequences-service';
import { testAddressState, testEmailState, type TestEmailState } from '../lib/reminder-timeline';
import type { ReminderDraft } from '../lib/reminder-rules';
import { ErrorLine } from './parts';

/**
 * "Send a test email" on a step (BL-425): the saved step goes to the signed-in person's own address with sample values and `[Test]` in
 * the subject. The worker sends it a moment later and the result arrives in the notifications. Email only: the API has no WhatsApp test.
 */
export function ReminderTestEmail({
  typeId,
  rule,
  dirty,
  canEdit,
}: {
  typeId: string;
  rule: ReminderDraft;
  dirty: boolean;
  canEdit: boolean;
}) {
  const t = useTranslations('appointments.reminders.test');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReminderTestSendResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [to, setTo] = useState('');
  const address = testAddressState(to);
  const state: TestEmailState = testEmailState({ canEdit, dirty, rule });
  // A noEmail step has nothing to test, and a viewer cannot send: leave the control out only in those two cases.
  if (state === 'readOnly' || state === 'noEmail') return null;

  async function send() {
    if (busy || state !== 'ok' || !rule.serverId || address === 'invalid') return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await sequencesApi.testEmail(
          typeId,
          rule.serverId,
          address === 'valid' ? to.trim() : undefined,
        ),
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-1.5 border-t border-border pt-3">
      <div className="space-y-1">
        <label htmlFor={`test-to-${rule.id}`} className="text-xs font-medium text-foreground">
          {t('toLabel')}
        </label>
        <input
          id={`test-to-${rule.id}`}
          type="email"
          inputMode="email"
          autoComplete="off"
          value={to}
          maxLength={254}
          disabled={state !== 'ok'}
          onChange={(e) => setTo(e.target.value)}
          placeholder={t('toPlaceholder')}
          aria-invalid={address === 'invalid'}
          className="block h-9 w-full max-w-sm rounded-md border border-border bg-background px-2 text-sm"
        />
        {address === 'invalid' && (
          <p role="alert" className="text-xs text-danger">
            {t('toInvalid')}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={state !== 'ok' || busy || address === 'invalid'}
          onClick={() => void send()}
        >
          {busy ? t('sending') : t('send')}
        </Button>
        <span className="text-xs text-muted-foreground">
          {state === 'ok' ? t('hint') : t(`wait.${state}`)}
        </span>
      </div>
      {result?.status === 'queued' && (
        <p role="status" className="text-xs text-success">
          {t('queued', { address: result.sentTo ?? '' })}
        </p>
      )}
      {result?.status === 'skipped' && (
        <p role="status" className="text-xs text-warning">
          {t('skipped')}
        </p>
      )}
      {error !== null && <ErrorLine error={error} />}
      <p className="text-xs text-muted-foreground">{t('noWhatsapp')}</p>
    </div>
  );
}
