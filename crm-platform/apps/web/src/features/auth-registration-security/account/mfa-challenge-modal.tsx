'use client';

import { ERROR_CODES } from '@crm/contracts';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Button, Field, Input, Modal, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { CodeInput } from '../shared/code-input';
import { ErrorNote } from '../shared/error-note';
import { focusFirstInvalid } from '../shared/focus';
import { bffAuthenticatedSchema, bffPost } from './api';

/**
 * The second-factor prompt that appears when the workspace you are switching
 * to has two-factor on (WD-AUTH-010). The challenge token never leaves this
 * component; the BFF turns a correct code into a session cookie.
 */
export function MfaChallengeModal({
  challengeToken,
  workspaceName,
  onSuccess,
  onClose,
}: {
  challengeToken: string;
  workspaceName: string;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('auth-registration-security.account.mfaChallenge');
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [mode, setMode] = useState<'code' | 'recovery'>('code');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const value = mode === 'code' ? code : recovery.trim();
  const ready = mode === 'code' ? code.length === 6 : recovery.trim().length >= 8;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (!ready) {
      setFieldError(mode === 'code' ? t('codeInvalid') : t('recoveryInvalid'));
      focusFirstInvalid(formRef.current);
      return;
    }
    setPending(true);
    setFieldError(null);
    setError(null);
    try {
      await bffPost(
        'mfa',
        mode === 'code' ? { challengeToken, code: value } : { challengeToken, recoveryCode: value },
        bffAuthenticatedSchema,
      );
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError && err.code === ERROR_CODES.AUTH_MFA_INVALID_CODE) {
        setFieldError(mode === 'code' ? t('codeWrong') : t('recoveryWrong'));
        focusFirstInvalid(formRef.current);
      } else if (err instanceof ApiError && err.code === ERROR_CODES.AUTH_MFA_CHALLENGE_EXPIRED) {
        setFieldError(t('expired'));
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
      title={t('title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t('cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={pending}>
            {pending && <Spinner label={t('verifying')} />}
            {pending ? t('verifying') : t('confirm')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        ref={formRef}
        onSubmit={(e) => void submit(e)}
        className="space-y-3"
        noValidate
      >
        <p className="text-sm text-muted-foreground">{t('intro', { name: workspaceName })}</p>
        {mode === 'code' ? (
          <Field
            label={t('codeLabel')}
            htmlFor={`${formId}-code`}
            hint={t('codeHint')}
            error={fieldError}
          >
            <CodeInput
              id={`${formId}-code`}
              value={code}
              onValueChange={(v) => {
                setCode(v);
                setFieldError(null);
              }}
              invalid={Boolean(fieldError)}
              autoFocus
            />
          </Field>
        ) : (
          <Field
            label={t('recoveryLabel')}
            htmlFor={`${formId}-recovery`}
            hint={t('recoveryHint')}
            error={fieldError}
          >
            <Input
              id={`${formId}-recovery`}
              value={recovery}
              onChange={(e) => {
                setRecovery(e.target.value);
                setFieldError(null);
              }}
              invalid={Boolean(fieldError)}
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              className="font-mono"
              autoFocus
            />
          </Field>
        )}
        <button
          type="button"
          className="text-sm font-medium text-primary underline-offset-2 hover:underline"
          onClick={() => {
            setMode(mode === 'code' ? 'recovery' : 'code');
            setFieldError(null);
            setError(null);
          }}
        >
          {mode === 'code' ? t('useRecovery') : t('useCode')}
        </button>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}
