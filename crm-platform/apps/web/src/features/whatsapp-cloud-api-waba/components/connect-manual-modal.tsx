'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import {
  WABA_ID_MAX,
  WABA_LABEL_MAX,
  WABA_TOKEN_MAX,
  connectManualInputSchema,
  type ConnectResult,
  type VerifyTokenResult,
} from '@crm/contracts';
import { Alert, Button, Field, Input, Modal, PasswordInput, Spinner } from '@crm/ui';
import { useConnectManual, useVerifyToken } from '../api/hooks';
import { useErrorText } from './use-error-text';

type FieldKey = 'phoneNumberId' | 'wabaId' | 'businessId' | 'accessToken' | 'displayLabel';
const EMPTY: Record<FieldKey, string> = {
  phoneNumberId: '',
  wabaId: '',
  businessId: '',
  accessToken: '',
  displayLabel: '',
};
const ID = /^\d+$/;

interface Props {
  open: boolean;
  onClose: () => void;
  onConnected: (result: ConnectResult) => void;
}

/** TW-WABA-005 / 006 / 007: paste credentials, optionally verify the token first, then probe and connect. */
export function ConnectManualModal({ open, onClose, onConnected }: Props) {
  const t = useTranslations('whatsapp-cloud-api-waba.connect');
  const tc = useTranslations('whatsapp-cloud-api-waba.common');
  const errorText = useErrorText();
  const connect = useConnectManual();
  const verify = useVerifyToken();
  const [v, setV] = useState(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [formError, setFormError] = useState<{ text: string; requestId?: string } | null>(null);
  const [check, setCheck] = useState<VerifyTokenResult | { empty: true } | null>(null);

  const set = (k: FieldKey) => (e: { target: { value: string } }) =>
    setV((s) => ({ ...s, [k]: e.target.value }));
  const reset = () => {
    setV(EMPTY);
    setErrors({});
    setFormError(null);
    setCheck(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const onVerify = () => {
    if (!v.accessToken.trim()) {
      setCheck({ empty: true });
      return;
    }
    setFormError(null);
    verify.mutate(
      {
        accessToken: v.accessToken.trim(),
        ...(ID.test(v.phoneNumberId.trim()) ? { phoneNumberId: v.phoneNumberId.trim() } : {}),
        ...(ID.test(v.wabaId.trim()) ? { wabaId: v.wabaId.trim() } : {}),
      },
      {
        onSuccess: setCheck,
        onError: (e) => {
          setCheck(null);
          setFormError(errorText(e));
        },
      },
    );
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = connectManualInputSchema.safeParse({
      phoneNumberId: v.phoneNumberId,
      wabaId: v.wabaId,
      ...(v.businessId.trim() ? { businessId: v.businessId } : {}),
      accessToken: v.accessToken,
      ...(v.displayLabel.trim() ? { displayLabel: v.displayLabel } : {}),
    });
    if (!parsed.success) {
      const next: Partial<Record<FieldKey, string>> = {};
      for (const issue of parsed.error.issues) {
        const k = issue.path[0] as FieldKey;
        const empty = !v[k]?.trim();
        next[k] ??= empty ? t('required') : k === 'accessToken' ? issue.message : t('idDigits');
      }
      setErrors(next);
      return;
    }
    setErrors({});
    connect.mutate(parsed.data, {
      onSuccess: (r) => {
        reset();
        onConnected(r);
      },
      onError: (err) => {
        const et = errorText(err);
        const byField: Partial<Record<FieldKey, string>> = {};
        for (const fe of et.fieldErrors) byField[fe.path as FieldKey] = fe.message;
        if (Object.keys(byField).length) setErrors(byField);
        else setFormError(et);
      },
    });
  };

  return (
    <Modal
      open={open}
      onClose={() => !connect.isPending && close()}
      title={t('manualTitle')}
      closeLabel={tc('close')}
      size="md"
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onVerify}
            disabled={verify.isPending || connect.isPending}
          >
            {verify.isPending ? t('verifying') : t('verify')}
          </Button>
          <Button variant="ghost" onClick={close} disabled={connect.isPending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="waba-manual-form" disabled={connect.isPending}>
            {connect.isPending ? (
              <>
                <Spinner /> {t('submitting')}
              </>
            ) : (
              t('submit')
            )}
          </Button>
        </>
      }
    >
      <form id="waba-manual-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <Alert>{t('manualInfo')}</Alert>
        {formError && <Alert tone="danger">{formError.text}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('phoneNumberId')} htmlFor="waba-phone-id" error={errors.phoneNumberId}>
            <Input
              id="waba-phone-id"
              inputMode="numeric"
              maxLength={WABA_ID_MAX}
              value={v.phoneNumberId}
              onChange={set('phoneNumberId')}
              invalid={!!errors.phoneNumberId}
              dir="ltr"
            />
          </Field>
          <Field label={t('wabaId')} htmlFor="waba-waba-id" error={errors.wabaId}>
            <Input
              id="waba-waba-id"
              inputMode="numeric"
              maxLength={WABA_ID_MAX}
              value={v.wabaId}
              onChange={set('wabaId')}
              invalid={!!errors.wabaId}
              dir="ltr"
            />
          </Field>
        </div>
        <Field
          label={t('businessId')}
          htmlFor="waba-business-id"
          hint={t('businessIdHint')}
          error={errors.businessId}
        >
          <Input
            id="waba-business-id"
            inputMode="numeric"
            maxLength={WABA_ID_MAX}
            value={v.businessId}
            onChange={set('businessId')}
            invalid={!!errors.businessId}
            dir="ltr"
          />
        </Field>
        <Field
          label={t('accessToken')}
          htmlFor="waba-token"
          hint={t('accessTokenHint')}
          error={errors.accessToken}
        >
          <PasswordInput
            id="waba-token"
            autoComplete="new-password"
            maxLength={WABA_TOKEN_MAX}
            value={v.accessToken}
            onChange={set('accessToken')}
            invalid={!!errors.accessToken}
            showLabel={t('showToken')}
            hideLabel={t('hideToken')}
          />
        </Field>
        <Field label={t('displayLabel')} htmlFor="waba-label" error={errors.displayLabel}>
          <Input
            id="waba-label"
            maxLength={WABA_LABEL_MAX}
            value={v.displayLabel}
            onChange={set('displayLabel')}
          />
        </Field>

        {check && (
          <div
            data-testid="waba-verify-result"
            className="space-y-2 rounded-md border border-border p-3 text-sm"
          >
            {'empty' in check ? (
              <p>{t('pasteTokenFirst')}</p>
            ) : (
              <>
                <p className={check.ok ? 'font-medium text-success' : 'font-medium text-danger'}>
                  {check.ok ? t('verifyGood') : t('verifyBad')}
                </p>
                <ul className="space-y-1">
                  {check.checks.map((c) => (
                    <li key={c.key} className="flex gap-2">
                      <span aria-hidden className={c.ok ? 'text-success' : 'text-danger'}>
                        {c.ok ? '✓' : '✗'}
                      </span>
                      <span>
                        <span className="font-medium">{c.title}</span>
                        {c.detail && (
                          <span className="block text-xs text-muted-foreground">{c.detail}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}
