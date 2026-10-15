'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { otpTestResponseSchema } from '@crm/contracts';
import type { OtpSenderView, OtpTestResponse } from '@crm/contracts';
import { Alert, Button, Field, Input, Modal, Select, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { normalizePhoneInput, pickerSenders, senderRef } from '../lib/otp-senders';
import { operatorFetch } from '../operator-fetch';

const NS = 'auth-registration-security.platform.registration.otp.test';

/**
 * "Send a test code": a real code to a number the operator types, through the chosen sender. The
 * code is never shown here (the person reads it on the phone), and the API allows 5 a hour.
 */
export function OtpTestModal({
  open,
  onClose,
  senders,
  initialSender,
}: {
  open: boolean;
  onClose: () => void;
  senders: OtpSenderView[];
  /** The sender picked in the form (saved or not): what the operator most likely wants to try. */
  initialSender: string;
}) {
  const t = useTranslations(NS);
  const [to, setTo] = useState('');
  // The dialog is mounted afresh each time it opens, so it starts from the form's current choice.
  const [sender, setSender] = useState(initialSender);
  const [toError, setToError] = useState<string | null>(null);
  const [result, setResult] = useState<OtpTestResponse | null>(null);
  const [failure, setFailure] = useState<{
    text: string;
    detail?: string;
    requestId?: string;
  } | null>(null);

  const send = useMutation({
    mutationFn: (body: { to: string; sender?: string }) =>
      operatorFetch('/settings/registration/otp-test', {
        method: 'POST',
        body,
        schema: otpTestResponseSchema,
      }),
    onSuccess: (data) => {
      setResult(data);
      setFailure(null);
    },
    onError: (err) => {
      setResult(null);
      if (err instanceof ApiError && err.status === 429) {
        const wait = Number(err.fieldErrors.find((f) => f.path === 'retryAfterSeconds')?.message);
        setFailure({
          text: t('errors.rateLimited', { minutes: Math.max(1, Math.ceil((wait || 60) / 60)) }),
        });
      } else if (err instanceof ApiError && err.code === 'AUTH_OTP_SEND_FAILED') {
        const reason = err.fieldErrors.find((f) => f.path === 'reason')?.message;
        setFailure({
          text: t('errors.failed'),
          detail: reason && t.has(`reasons.${reason}`) ? t(`reasons.${reason}`) : undefined,
        });
      } else if (err instanceof ApiError && err.status === 422) {
        setFailure({ text: t('errors.rejected'), detail: err.message });
      } else if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') {
        /* operatorFetch is sending the person to sign in */
      } else {
        setFailure({
          text: t('errors.unexpected'),
          requestId: err instanceof ApiError ? err.requestId : undefined,
        });
      }
    },
  });

  function submit() {
    if (send.isPending) return;
    const number = normalizePhoneInput(to);
    if (!number) {
      setToError(t('errors.invalidNumber'));
      document.getElementById('otp-test-to')?.focus();
      return;
    }
    setToError(null);
    setResult(null);
    setFailure(null);
    send.mutate({ to: number, ...(sender ? { sender } : {}) });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('close')}
          </Button>
          <Button onClick={submit} disabled={send.isPending}>
            {send.isPending && <Spinner label={t('sending')} />}
            {send.isPending ? t('sending') : t('send')}
          </Button>
        </>
      }
    >
      <div
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
            e.preventDefault();
            submit();
          }
        }}
        className="space-y-4"
      >
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
        <Field
          label={t('to')}
          htmlFor="otp-test-to"
          hint={t('toHint')}
          error={toError ?? undefined}
        >
          <Input
            id="otp-test-to"
            type="tel"
            inputMode="tel"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setToError(null);
            }}
            placeholder="+91 98765 43221"
            invalid={Boolean(toError)}
            autoComplete="off"
            dir="ltr"
            className="font-mono"
          />
        </Field>
        <Field label={t('sender')} htmlFor="otp-test-sender" hint={t('senderHint')}>
          <Select id="otp-test-sender" value={sender} onChange={(e) => setSender(e.target.value)}>
            <option value="">{t('savedSender')}</option>
            {/* Only senders that can deliver a code (a test through an unfinished one can only fail). */}
            {pickerSenders(senders, initialSender).map((s) => (
              <option key={s.id} value={senderRef(s)}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        {result && (
          <Alert tone="success" className="space-y-1">
            <p>{t('sent', { to: result.sentTo })}</p>
            <p className="text-xs">
              {t('remaining', { count: result.remainingThisHour })} {t('notShown')}
            </p>
          </Alert>
        )}
        {failure && (
          <Alert tone="danger" className="space-y-1">
            <p>{failure.text}</p>
            {failure.detail && <p className="text-xs">{failure.detail}</p>}
          </Alert>
        )}
      </div>
    </Modal>
  );
}
