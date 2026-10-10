'use client';

import { PASSKEY_NAME_MAX, passkeyRegisterRequestSchema, type PasskeyItem } from '@crm/contracts';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Alert, Button, Field, Input, Modal, PasswordInput, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { ErrorNote } from '../error-note';
import { focusFirstInvalid } from '../focus';
import { createPasskey } from './passkey-browser';
import type { PasskeyApi } from './passkey-api';
import { classifyPasskeyError, type PasskeyFailure } from './passkey-failure';

type Stage = 'idle' | 'options' | 'device' | 'saving';

/**
 * Adding a passkey: a name, then the three steps that make one: the API's options, the browser's prompt (fingerprint,
 * face, screen lock or a security key) and the API checking the answer. The password is asked for only when the API
 * says the session is too old (403 AUTH_REAUTH_REQUIRED), and sent with the next try.
 */
export function AddPasskeyModal({
  api,
  onClose,
  onAdded,
  onNeedsMfa,
}: {
  api: PasskeyApi;
  onClose: () => void;
  onAdded: (item: PasskeyItem) => void;
  /** The API says two-factor is off (409 AUTH_PASSKEY_NEEDS_MFA): the card explains and offers the way there. */
  onNeedsMfa: () => void;
}) {
  const t = useTranslations('auth-registration-security.account.passkeys');
  const p = useTranslations('auth-registration-security.account.passwordConfirm');
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [problem, setProblem] = useState<PasskeyFailure | null>(null);
  const [apiError, setApiError] = useState<unknown>(null);
  const pending = stage !== 'idle';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setProblem(null);
    setApiError(null);
    const parsedName = passkeyRegisterRequestSchema.shape.name.safeParse(name);
    if (!parsedName.success) {
      setNameError(t('nameRequired'));
      focusFirstInvalid(formRef.current);
      return;
    }
    if (needsPassword && !password) {
      setPasswordError(p('required'));
      focusFirstInvalid(formRef.current);
      return;
    }
    setNameError(null);
    setPasswordError(null);
    const confirmed = needsPassword ? password : undefined;
    try {
      setStage('options');
      const options = await api.options(confirmed);
      setStage('device');
      const response = await createPasskey(options);
      setStage('saving');
      const item = await api.register({
        response,
        name: parsedName.data,
        ...(confirmed ? { password: confirmed } : {}),
      });
      onAdded(item);
    } catch (err) {
      const kind = classifyPasskeyError(err);
      setStage('idle');
      if (kind === 'needsMfa') {
        onNeedsMfa();
      } else if (kind === 'reauth') {
        setNeedsPassword(true);
        setPasswordError(null);
      } else if (kind === 'wrongPassword') {
        setPasswordError(p('wrong'));
        focusFirstInvalid(formRef.current);
      } else if (kind === 'other' && err instanceof ApiError) {
        setApiError(err);
      } else {
        setProblem(kind);
      }
    }
  }

  const progress =
    stage === 'device' ? t('waiting') : stage === 'saving' ? t('saving') : t('preparing');

  return (
    <Modal
      open
      onClose={() => !pending && onClose()}
      title={t('addTitle')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {p('cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={pending}>
            {pending && <Spinner label={progress} />}
            {pending ? progress : t('addConfirm')}
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
        <p className="text-sm text-muted-foreground">{t('addDescription')}</p>
        <Field
          label={t('nameLabel')}
          htmlFor={`${formId}-name`}
          hint={t('nameHint', { max: PASSKEY_NAME_MAX })}
          error={nameError}
        >
          <Input
            id={`${formId}-name`}
            value={name}
            maxLength={PASSKEY_NAME_MAX}
            placeholder={t('namePlaceholder')}
            autoComplete="off"
            autoFocus
            disabled={pending}
            invalid={Boolean(nameError)}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
          />
        </Field>
        {needsPassword && (
          <Field
            label={p('password')}
            htmlFor={`${formId}-password`}
            hint={t('passwordNeeded')}
            error={passwordError}
          >
            <PasswordInput
              id={`${formId}-password`}
              autoComplete="current-password"
              value={password}
              disabled={pending}
              invalid={Boolean(passwordError)}
              showLabel={p('show')}
              hideLabel={p('hide')}
              autoFocus
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError(null);
              }}
            />
          </Field>
        )}
        {problem && <Alert tone="warning">{problemText(problem)}</Alert>}
        <ErrorNote error={apiError} />
      </form>
    </Modal>
  );

  function problemText(kind: PasskeyFailure): string {
    switch (kind) {
      case 'cancelled':
        return t('problems.cancelled');
      case 'alreadyRegistered':
        return t('problems.alreadyRegistered');
      case 'invalid':
        return t('problems.invalid');
      case 'limit':
        return t('problems.limit');
      case 'unsupported':
        return t('problems.unsupported');
      default:
        return t('problems.failed');
    }
  }
}
