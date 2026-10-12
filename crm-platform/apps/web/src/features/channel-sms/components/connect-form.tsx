'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Button, Field, Input, Select, useToast } from '@crm/ui';
import type { SmsProvider } from '@crm/contracts';
import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { connectSender, KEYS } from '../api/sms';
import { smsErrorKey } from '../lib/api-errors';
import {
  EMPTY_CONNECT,
  toConnectInput,
  validateConnect,
  type ConnectErrors,
  type ConnectForm,
} from '../lib/connect-model';

/**
 * "Connect a number" (TW-SMS-002, 005): provider, From, credentials, the collapsible MSG91 / India (DLT) options with the
 * delivery-report address, and the rate. The server verifies the credentials with the provider before anything is saved; its
 * reason is shown here and the typed values are kept. Re-submitting a From number updates that sender.
 */
export function ConnectForm({ deliveryReportUrl }: { deliveryReportUrl: string | undefined }) {
  const t = useTranslations('sms.connect');
  const root = useTranslations('sms');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<ConnectForm>(EMPTY_CONNECT);
  const [errors, setErrors] = useState<ConnectErrors>({});
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [providerReason, setProviderReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const msg91 = form.provider === 'msg91';
  const set = (p: Partial<ConnectForm>) => setForm((f) => ({ ...f, ...p }));
  const fieldError = (k: keyof ConnectForm) => {
    const key = errors[k];
    return key ? t(`errors.${key}`) : null;
  };
  const shown = [...Object.values(errors).map((k) => t(`errors.${k}`)), ...serverErrors];

  const submit = async () => {
    const found = validateConnect(form);
    setErrors(found);
    setServerErrors([]);
    setProviderReason(null);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      await connectSender(toConnectInput(form));
      await qc.invalidateQueries({ queryKey: KEYS.all });
      toast(t('connected'), 'success');
      setForm(EMPTY_CONNECT);
    } catch (e) {
      if (e instanceof ApiError && e.code === ERROR_CODES.SMS_CREDENTIALS_REJECTED) {
        setProviderReason(e.message);
      } else if (e instanceof ApiError) {
        const key = smsErrorKey(e.code);
        const fields = e.fieldErrors.map((x) => x.message);
        setServerErrors(key ? [root(key)] : fields.length > 0 ? fields : [e.message]);
      } else {
        setServerErrors([t('failed')]);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      id="sms-connect"
      className="rounded-2xl border border-border bg-background p-5 shadow-sm sm:p-6"
    >
      <div className="text-lg leading-tight">{t('title')}</div>
      <p className="mt-1 text-xs text-muted-foreground">{t('intro')}</p>

      {(shown.length > 0 || providerReason) && (
        <Alert tone="danger" className="mt-4">
          <div className="font-semibold">{t('errorTitle')}</div>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-[12.5px]">
            {shown.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
            {providerReason && <li>{t('providerError', { reason: providerReason })}</li>}
          </ul>
        </Alert>
      )}

      <form
        className="mt-4 space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label={`${t('provider')} *`} htmlFor="sms-provider" hint={t('providerHint')}>
            <Select
              id="sms-provider"
              value={form.provider}
              onChange={(e) => set({ provider: e.target.value as SmsProvider })}
            >
              <option value="twilio">{t('providerTwilio')}</option>
              <option value="msg91">{t('providerMsg91')}</option>
            </Select>
          </Field>
          <Field
            label={`${t('from')} *`}
            htmlFor="sms-from"
            hint={t('fromHint')}
            error={fieldError('fromNumber')}
          >
            <Input
              id="sms-from"
              dir="ltr"
              value={form.fromNumber}
              maxLength={32}
              invalid={errors.fromNumber !== undefined}
              onChange={(e) => set({ fromNumber: e.target.value })}
              placeholder={t('fromPlaceholder')}
              className="font-mono"
              autoComplete="off"
            />
          </Field>
          {!msg91 && (
            <Field
              label={t('sid')}
              htmlFor="sms-sid"
              hint={t('sidHint')}
              error={fieldError('accountSid')}
            >
              <Input
                id="sms-sid"
                dir="ltr"
                value={form.accountSid}
                maxLength={64}
                invalid={errors.accountSid !== undefined}
                onChange={(e) => set({ accountSid: e.target.value })}
                placeholder={t('sidPlaceholder')}
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          )}
          <Field
            label={t('token')}
            htmlFor="sms-token"
            hint={t('tokenHint')}
            error={fieldError('authToken')}
          >
            <Input
              id="sms-token"
              type="password"
              dir="ltr"
              value={form.authToken}
              maxLength={255}
              invalid={errors.authToken !== undefined}
              onChange={(e) => set({ authToken: e.target.value })}
              autoComplete="new-password"
              className="font-mono"
            />
          </Field>
        </div>

        <details className="rounded-xl border border-border" open={msg91}>
          <summary className="cursor-pointer select-none px-4 py-2.5 text-[13px] font-semibold hover:bg-muted/50">
            {t('dltOptions')}
          </summary>
          <div className="space-y-4 border-t border-border p-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field
                label={t('senderId')}
                htmlFor="sms-sender-id"
                hint={t('senderIdHint')}
                error={fieldError('senderId')}
              >
                <Input
                  id="sms-sender-id"
                  dir="ltr"
                  value={form.senderId}
                  maxLength={16}
                  invalid={errors.senderId !== undefined}
                  onChange={(e) => set({ senderId: e.target.value })}
                  placeholder={t('senderIdPlaceholder')}
                  className="font-mono"
                  autoComplete="off"
                />
              </Field>
              <Field
                label={t('dltTemplate')}
                htmlFor="sms-dlt-template"
                hint={t('dltTemplateHint')}
                error={fieldError('dltTemplateId')}
              >
                <Input
                  id="sms-dlt-template"
                  dir="ltr"
                  value={form.dltTemplateId}
                  maxLength={64}
                  invalid={errors.dltTemplateId !== undefined}
                  onChange={(e) => set({ dltTemplateId: e.target.value })}
                  className="font-mono"
                  autoComplete="off"
                />
              </Field>
            </div>
            {deliveryReportUrl && (
              <div className="rounded-xl bg-muted/60 p-3 text-xs">
                <div className="font-semibold">{t('reportBoxTitle')}</div>
                <p className="mt-0.5 text-muted-foreground">{t('reportBoxBody')}</p>
                <code className="mt-1.5 block break-all font-mono text-[11.5px]" dir="ltr">
                  {deliveryReportUrl}
                </code>
              </div>
            )}
          </div>
        </details>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field
            label={t('rate')}
            htmlFor="sms-rate"
            hint={t('rateHint')}
            error={fieldError('ratePerSegment')}
          >
            <Input
              id="sms-rate"
              type="number"
              inputMode="decimal"
              step="0.0001"
              min="0"
              dir="ltr"
              value={form.ratePerSegment}
              invalid={errors.ratePerSegment !== undefined}
              onChange={(e) => set({ ratePerSegment: e.target.value })}
              placeholder={t('ratePlaceholder')}
              className="font-mono"
            />
          </Field>
          <Field label={t('currency')} htmlFor="sms-currency" error={fieldError('currency')}>
            <Input
              id="sms-currency"
              dir="ltr"
              value={form.currency}
              maxLength={8}
              invalid={errors.currency !== undefined}
              onChange={(e) => set({ currency: e.target.value })}
              className="font-mono uppercase"
              autoComplete="off"
            />
          </Field>
        </div>

        <Button type="submit" className="rounded-full" disabled={busy}>
          {busy ? t('submitting') : t('submit')}
        </Button>
      </form>
    </div>
  );
}
