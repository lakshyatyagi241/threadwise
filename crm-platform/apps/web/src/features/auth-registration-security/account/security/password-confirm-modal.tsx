'use client';

import { ERROR_CODES } from '@crm/contracts';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Field, Input, Modal, PasswordInput, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { ErrorNote } from '../../shared/error-note';
import { focusFirstInvalid } from '../../shared/focus';
import { redirectOnGateError } from '../../shared/gate-errors';

/** A second proof next to the password: an authenticator or recovery code (turning two-factor off). */
export interface CodeFieldProps {
  label: string;
  hint?: string;
  /** Shown under the field when the API says the code is wrong. */
  wrong: string;
  /** Shown when the field is left empty. */
  required: string;
}

/**
 * Asks for the current password before a sensitive action (turn two-factor off,
 * replace recovery codes). The action runs in `onConfirm`; a wrong password is
 * shown under the field, anything else as a general error. With `codeField` it also asks for
 * a current authenticator or recovery code, and `onConfirm` receives it as the second argument.
 */
export function PasswordConfirmModal({
  title,
  description,
  confirmLabel,
  danger,
  codeField,
  onConfirm,
  onClose,
}: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  codeField?: CodeFieldProps;
  onConfirm: (password: string, code: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations('auth-registration-security.account.passwordConfirm');
  const router = useRouter();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    if (!password) {
      setFieldError(t('required'));
      focusFirstInvalid(formRef.current);
      return;
    }
    if (codeField && !code.trim()) {
      setCodeError(codeField.required);
      focusFirstInvalid(formRef.current);
      return;
    }
    setPending(true);
    setFieldError(null);
    setCodeError(null);
    try {
      await onConfirm(password, code.trim());
    } catch (err) {
      if (redirectOnGateError(err, router.replace)) return;
      if (err instanceof ApiError && err.code === ERROR_CODES.AUTH_CURRENT_PASSWORD_WRONG) {
        setFieldError(t('wrong'));
        focusFirstInvalid(formRef.current);
      } else if (
        codeField &&
        err instanceof ApiError &&
        err.code === ERROR_CODES.AUTH_MFA_INVALID_CODE
      ) {
        setCodeError(codeField.wrong);
        focusFirstInvalid(formRef.current);
      } else {
        setError(err);
      }
      setPending(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => !pending && onClose()}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant={danger ? 'danger' : 'primary'}
            disabled={pending}
          >
            {pending && <Spinner label={t('working')} />}
            {confirmLabel}
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
        <div className="text-sm text-muted-foreground">{description}</div>
        <Field label={t('password')} htmlFor={`${formId}-password`} error={fieldError}>
          <PasswordInput
            id={`${formId}-password`}
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setFieldError(null);
            }}
            invalid={Boolean(fieldError)}
            showLabel={t('show')}
            hideLabel={t('hide')}
            autoFocus
          />
        </Field>
        {codeField && (
          <Field
            label={codeField.label}
            htmlFor={`${formId}-code`}
            hint={codeField.hint}
            error={codeError}
          >
            <Input
              id={`${formId}-code`}
              dir="ltr"
              autoComplete="one-time-code"
              inputMode="text"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setCodeError(null);
              }}
              invalid={Boolean(codeError)}
            />
          </Field>
        )}
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}
