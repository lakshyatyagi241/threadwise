'use client';

import { ERROR_CODES, passwordSchema } from '@crm/contracts';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Alert, Button, Card, Field, PasswordInput, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { ErrorNote } from '../../shared/error-note';
import { focusFirstInvalid } from '../../shared/focus';
import { redirectOnGateError } from '../../shared/gate-errors';
import { showFlash } from '../../shared/flash';
import { useSession } from '../../shared/session-context';
import { authApi } from '../api';
import { policyViolations, type PolicyViolation } from './policy-rules';

type Errors = Partial<Record<'current' | 'next' | 'confirm', string>>;

/**
 * Change password, signed in (TW-AUTH-027). Current + new + confirm; the server
 * enforces the admin password policy and reports each broken rule, which are
 * listed under the new-password field. Success revokes every other device.
 * In the forced mode (an admin required a new password) it finishes by sending
 * the person to their landing page.
 */
export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const t = useTranslations('auth-registration-security.account.password');
  const c = useTranslations('auth-registration-security.account.common');
  const router = useRouter();
  const { flags } = useSession();
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [rules, setRules] = useState<PolicyViolation[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const [revoked, setRevoked] = useState<number | null>(null);
  const id = (name: string) => `${uid}-${name}`;

  /** Our wording per rule; "at least N" needs N, and anything unknown keeps the server's text. */
  function ruleText(v: PolicyViolation): string {
    if (v.rule === 'min_length')
      return v.count ? t('rules.min_length', { count: v.count }) : v.message;
    return v.rule ? t(`rules.${v.rule}`) : v.message;
  }

  function fail(nextErrors: Errors, policy: PolicyViolation[] = []) {
    setErrors(nextErrors);
    setRules(policy);
    setRevoked(null);
    focusFirstInvalid(formRef.current);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setRevoked(null);

    const found: Errors = {};
    if (!current) found.current = t('errors.currentRequired');
    const parsed = passwordSchema.safeParse(next);
    if (!parsed.success)
      found.next = next.length > 256 ? t('errors.tooLong') : t('errors.tooShort');
    if (!found.next && next === current) found.next = t('errors.sameAsCurrent');
    if (confirm !== next) found.confirm = t('errors.mismatch');
    if (Object.keys(found).length) return fail(found);

    setPending(true);
    setErrors({});
    setRules([]);
    try {
      const result = await authApi.changePassword({ currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      setRevoked(result.revokedOtherSessions);
      // The flags (forced change) come from the session; re-read it.
      router.refresh();
      if (forced && !flags.mfaEnrolmentRequired) {
        showFlash(t('forcedDone'));
        router.replace('/');
      }
    } catch (err) {
      if (redirectOnGateError(err, router.replace, '/account/security')) return;
      if (err instanceof ApiError && err.code === ERROR_CODES.AUTH_CURRENT_PASSWORD_WRONG) {
        fail({ current: t('errors.currentWrong') });
      } else if (err instanceof ApiError && err.code === ERROR_CODES.AUTH_PASSWORD_POLICY) {
        fail({ next: t('errors.policy') }, policyViolations(err, 'newPassword'));
      } else if (err instanceof ApiError && err.code === ERROR_CODES.VALIDATION_FAILED) {
        fail({ next: t('errors.sameAsCurrent') });
      } else {
        setError(err);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Card id="password" className="scroll-mt-20 space-y-4 p-5">
      <div>
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {forced && <Alert tone="warning">{t('forcedBanner')}</Alert>}

      <form ref={formRef} onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
        <Field label={t('current')} htmlFor={id('current')} error={errors.current}>
          <PasswordInput
            id={id('current')}
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            invalid={Boolean(errors.current)}
            showLabel={c('showPassword')}
            hideLabel={c('hidePassword')}
          />
        </Field>

        <Field label={t('new')} htmlFor={id('new')} hint={t('newHint')} error={errors.next}>
          <PasswordInput
            id={id('new')}
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            invalid={Boolean(errors.next)}
            aria-describedby={rules.length ? id('rules') : undefined}
            showLabel={c('showPassword')}
            hideLabel={c('hidePassword')}
          />
        </Field>
        {rules.length > 0 && (
          <ul
            id={id('rules')}
            role="alert"
            className="-mt-2 list-disc space-y-0.5 ps-5 text-xs text-danger"
          >
            {rules.map((violation) => (
              <li key={violation.rule ?? violation.message}>{ruleText(violation)}</li>
            ))}
          </ul>
        )}

        <Field label={t('confirm')} htmlFor={id('confirm')} error={errors.confirm}>
          <PasswordInput
            id={id('confirm')}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            invalid={Boolean(errors.confirm)}
            showLabel={c('showPassword')}
            hideLabel={c('hidePassword')}
          />
        </Field>

        <ErrorNote error={error} />
        {revoked !== null && <Alert tone="success">{t('success', { count: revoked })}</Alert>}

        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending && <Spinner label={t('updating')} />}
            {pending ? t('updating') : t('submit')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
