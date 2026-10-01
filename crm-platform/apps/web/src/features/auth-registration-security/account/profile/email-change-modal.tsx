'use client';

import { ERROR_CODES, changeEmailRequestSchema } from '@crm/contracts';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Button, Field, Input, Modal, PasswordInput, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { ErrorNote } from '../../shared/error-note';
import { redirectOnGateError } from '../../shared/gate-errors';
import { focusFirstInvalid } from '../../shared/focus';
import { useRouter } from 'next/navigation';
import { authApi } from '../api';

type Errors = Partial<Record<'newEmail' | 'password', string>>;

/**
 * "Change email" (WD-AUTH-025). Asks for the new address and the current
 * password, because the new address becomes the sign-in id; the change takes
 * effect only after the link sent to the new address is opened. (WaDesk changed
 * it on the spot, with no password and no confirmation.)
 */
export function EmailChangeModal({
  currentEmail,
  onClose,
  onRequested,
}: {
  currentEmail: string;
  onClose: () => void;
  /** Called with the address the confirmation went to. */
  onRequested: (newEmail: string) => void;
}) {
  const t = useTranslations('auth-registration-security.account.emailChange');
  const router = useRouter();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  function fail(next: Errors) {
    setErrors(next);
    focusFirstInvalid(formRef.current);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    const parsed = changeEmailRequestSchema.safeParse({ newEmail: newEmail.trim(), password });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'newEmail') next.newEmail = t('errors.invalidEmail');
        if (issue.path[0] === 'password') next.password = t('errors.passwordRequired');
      }
      return fail(next);
    }
    if (parsed.data.newEmail === currentEmail.toLowerCase())
      return fail({ newEmail: t('errors.same') });

    setPending(true);
    setErrors({});
    try {
      await authApi.requestEmailChange(parsed.data);
      onRequested(parsed.data.newEmail);
    } catch (err) {
      if (redirectOnGateError(err, router.replace)) return;
      if (err instanceof ApiError && err.code === ERROR_CODES.AUTH_EMAIL_TAKEN) {
        fail({ newEmail: t('errors.taken') });
      } else if (err instanceof ApiError && err.code === ERROR_CODES.AUTH_CURRENT_PASSWORD_WRONG) {
        fail({ password: t('errors.passwordWrong') });
      } else if (err instanceof ApiError && err.code === ERROR_CODES.VALIDATION_FAILED) {
        fail({ newEmail: t('errors.invalidEmail') });
      } else {
        setError(err);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => !pending && onClose()}
      title={t('title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t('cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={pending}>
            {pending && <Spinner label={t('sending')} />}
            {pending ? t('sending') : t('submit')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        ref={formRef}
        onSubmit={(e) => void submit(e)}
        className="space-y-4"
        noValidate
      >
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
        <Field label={t('newEmail')} htmlFor={`${formId}-email`} error={errors.newEmail}>
          <Input
            id={`${formId}-email`}
            type="email"
            autoComplete="email"
            inputMode="email"
            dir="ltr"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            invalid={Boolean(errors.newEmail)}
            autoFocus
          />
        </Field>
        <Field
          label={t('password')}
          htmlFor={`${formId}-password`}
          hint={t('passwordHint')}
          error={errors.password}
        >
          <PasswordInput
            id={`${formId}-password`}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            invalid={Boolean(errors.password)}
            showLabel={t('showPassword')}
            hideLabel={t('hidePassword')}
          />
        </Field>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}
