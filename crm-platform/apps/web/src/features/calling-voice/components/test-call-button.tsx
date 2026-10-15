'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Field, Input, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { CallError, isPermissionRequested } from '../lib/calls';
import { digitsOnly, isDialable } from '../lib/readiness';
import { useCalling } from './calling-provider';
import { useErrorText } from './use-error-text';

/**
 * "Place a test call to my phone" (EXT-CALL-010): the same dial path as the inbox's Call button (permission first, then the browser's
 * peer), to a number the admin types, so the whole chain from this number to a real phone can be heard before customers depend on it.
 * It runs under the calling provider of the screen it sits on (`CallingSettingsScreen`, `CallingToggleCard`): one call per tab, and a
 * call in progress is not cut when the card refreshes, because the provider belongs to the screen and not to the card.
 */
export function TestCallButton({ numberId }: { numberId: string }) {
  const canUse = useCan('call.calls.use');
  if (!canUse) return null;
  return <TestCall numberId={numberId} />;
}

function TestCall({ numberId }: { numberId: string }) {
  const t = useTranslations('calling-voice');
  const { toast } = useToast();
  const errorText = useErrorText();
  const { startOutboundCall, busy } = useCalling();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [starting, setStarting] = useState(false);
  const valid = isDialable(phone);
  const phoneId = useId();

  const call = async () => {
    setStarting(true);
    try {
      await startOutboundCall({ numberId, to: digitsOnly(phone), displayName: digitsOnly(phone) });
    } catch (err) {
      if (isPermissionRequested(err)) toast(t('toast.permissionSent'), 'info');
      else if (err instanceof CallError) toast(errorText(err, { reasons: true }), 'danger');
      else toast(t('toast.startFailed', { message: errorText(err, { reasons: true }) }), 'danger');
    } finally {
      setStarting(false);
    }
  };

  if (!open) {
    return (
      <div className="mt-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setOpen(true)}
          data-testid="test-call-open"
        >
          {t('readiness.testCall.show')}
        </Button>
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-md border border-border bg-background p-3" data-testid="test-call">
      <div className="text-sm font-medium">{t('readiness.testCall.title')}</div>
      <p className="mt-1 text-xs text-muted-foreground">{t('readiness.testCall.intro')}</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <Field
            label={t('readiness.testCall.phoneLabel')}
            htmlFor={phoneId}
            hint={t('readiness.testCall.phoneHint')}
            error={phone !== '' && !valid ? t('readiness.testCall.invalid') : undefined}
          >
            <Input
              id={phoneId}
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
        </div>
        <Button
          size="sm"
          variant="brand"
          disabled={!valid || starting || busy}
          aria-busy={starting}
          onClick={() => void call()}
        >
          {t('readiness.testCall.call')}
        </Button>
      </div>
    </div>
  );
}
