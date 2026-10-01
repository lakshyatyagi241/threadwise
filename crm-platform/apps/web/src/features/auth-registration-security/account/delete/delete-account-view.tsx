'use client';

import {
  DELETE_CONFIRMATION_PHRASE,
  ERROR_CODES,
  deleteAccountRequestSchema,
} from '@crm/contracts';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Alert, Button, Card, Field, Input, PasswordInput, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { ErrorNote } from '../../shared/error-note';
import { focusFirstInvalid } from '../../shared/focus';
import { redirectOnGateError } from '../../shared/gate-errors';
import { WarningIcon } from '../../shared/icons';
import { authApi } from '../api';
import { blockerOf, phraseMatches, type DeleteBlocker } from './delete-rules';

/**
 * Delete account (WD-AUTH-028). The API hard-deletes the user: the
 * sign-in, profile, photo and devices are gone for good and the audit trail
 * keeps the record. It is refused for the only member and the only
 * administrator, which is stated here after the attempt. WaDesk's copy claimed
 * workspaces and conversations were deleted; they are not, and neither are
 * they here: the workspace and its other members stay.
 */
export function DeleteAccountView() {
  const t = useTranslations('auth-registration-security.account.delete');
  const router = useRouter();
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [phrase, setPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Partial<Record<'phrase' | 'password', string>>>({});
  const [blocker, setBlocker] = useState<DeleteBlocker | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  function fail(next: typeof errors) {
    setErrors(next);
    focusFirstInvalid(formRef.current);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setBlocker(null);
    const found: typeof errors = {};
    if (!phraseMatches(phrase)) found.phrase = t('errors.phrase');
    if (!password) found.password = t('errors.passwordRequired');
    if (Object.keys(found).length) return fail(found);

    const parsed = deleteAccountRequestSchema.safeParse({ confirmation: phrase.trim(), password });
    if (!parsed.success) return fail({ phrase: t('errors.phrase') });

    setPending(true);
    setErrors({});
    try {
      await authApi.deleteAccount(parsed.data);
      // The session is gone server-side; a full navigation clears every client cache too.
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      } catch {
        /* the cookies are useless now anyway */
      }
      window.location.assign('/login?account_deleted=1');
    } catch (err) {
      if (redirectOnGateError(err, router.replace)) return;
      if (err instanceof ApiError && err.code === ERROR_CODES.AUTH_CURRENT_PASSWORD_WRONG) {
        fail({ password: t('errors.passwordWrong') });
      } else if (err instanceof ApiError && err.code === ERROR_CODES.AUTH_CONFIRMATION_MISMATCH) {
        fail({ phrase: t('errors.phrase') });
      } else if (blockerOf(err)) {
        setBlocker(blockerOf(err));
      } else {
        setError(err);
      }
      setPending(false);
    }
  }

  const ready = phraseMatches(phrase) && password.length > 0;

  return (
    <Card className="space-y-5 border-danger/40 p-5">
      <div className="flex items-start gap-3">
        <WarningIcon className="mt-1 size-5 text-danger" />
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-danger">{t('title')}</h2>
          <p className="text-sm">{t('warning')}</p>
          <p className="text-sm font-medium">{t('irreversible')}</p>
        </div>
      </div>

      <div className="rounded-md border border-border bg-muted p-3 text-sm">
        <p className="mb-1 font-medium">{t('consequencesTitle')}</p>
        <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
          <li>{t('consequence1')}</li>
          <li>{t('consequence2')}</li>
          <li>{t('consequence3')}</li>
        </ul>
      </div>

      {blocker && (
        <Alert tone="warning">
          <p className="font-medium">{t(`blocked.${blocker}.title`)}</p>
          <p>{t(`blocked.${blocker}.body`)}</p>
        </Alert>
      )}

      <form ref={formRef} onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
        <Field
          label={t('phraseLabel', { phrase: DELETE_CONFIRMATION_PHRASE })}
          htmlFor={`${uid}-phrase`}
          hint={t('phraseHint')}
          error={errors.phrase}
        >
          <Input
            id={`${uid}-phrase`}
            value={phrase}
            onChange={(e) => {
              setPhrase(e.target.value);
              setErrors((v) => ({ ...v, phrase: undefined }));
            }}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            dir="ltr"
            placeholder={DELETE_CONFIRMATION_PHRASE}
            invalid={Boolean(errors.phrase)}
          />
        </Field>
        <Field label={t('password')} htmlFor={`${uid}-password`} error={errors.password}>
          <PasswordInput
            id={`${uid}-password`}
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setErrors((v) => ({ ...v, password: undefined }));
            }}
            invalid={Boolean(errors.password)}
            showLabel={t('showPassword')}
            hideLabel={t('hidePassword')}
          />
        </Field>

        <ErrorNote error={error} />

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push('/account/profile')}
            disabled={pending}
          >
            {t('cancel')}
          </Button>
          <Button type="submit" variant="danger" disabled={pending || !ready}>
            {pending && <Spinner label={t('deleting')} />}
            {pending ? t('deleting') : t('submit')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
