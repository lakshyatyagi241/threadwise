'use client';

import { ERROR_CODES } from '@crm/contracts';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Field, Modal, PasswordInput, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { ErrorNote } from '../../shared/error-note';
import { focusFirstInvalid } from '../../shared/focus';
import { redirectOnGateError } from '../../shared/gate-errors';

/**
 * Asks for the current password before a sensitive action (turn two-factor off,
 * replace recovery codes). The action runs in `onConfirm`; a wrong password is
 * shown under the field, anything else as a general error.
 */
export function PasswordConfirmModal({
  title,
  description,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: (password: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations('auth-registration-security.account.passwordConfirm');
  const router = useRouter();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [password, setPassword] = useState('');
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
    setPending(true);
    setFieldError(null);
    try {
      await onConfirm(password);
    } catch (err) {
      if (redirectOnGateError(err, router.replace)) return;
      if (err instanceof ApiError && err.code === ERROR_CODES.AUTH_CURRENT_PASSWORD_WRONG) {
        setFieldError(t('wrong'));
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
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}
