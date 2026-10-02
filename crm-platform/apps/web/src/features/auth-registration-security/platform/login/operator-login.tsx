'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  ERROR_CODES,
  emailSchema,
  mfaRequiredSchema,
  operatorAuthenticatedSchema,
} from '@crm/contracts';
import { Alert, Button, Card, Field, Input, PasswordInput, Spinner } from '@crm/ui';
import { ApiError, toApiError } from '@/lib/api/errors';
import { lockedMinutes } from '../../shared/error-utils';
import { fieldMessage, retryAfterSeconds } from '../lib/api-errors';
import { formatMmSs } from '../lib/kpi';
import { OPERATOR_ACCOUNT_PATH, OPERATOR_HOME } from '../operator-nav';
import { safeConsolePath } from '../lib/next-path';
import { useRecaptcha, type CaptchaConfig } from './use-recaptcha';
import { useCountdown } from './use-countdown';

const NS = 'auth-registration-security.platform.login';
const RECOVERY_CODE = /^[A-Za-z0-9-]{8,32}$/;

/** What `/api/platform-auth/*` returns: the BFF keeps the token pair in cookies and drops it from the body. */
const bffLoginResponseSchema = z.union([
  operatorAuthenticatedSchema.omit({ tokens: true }),
  mfaRequiredSchema,
]);

function focusField(id: string, select = false) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  el?.focus();
  if (select) el?.select();
}

type Step =
  { kind: 'credentials' } | { kind: 'mfa'; challengeToken: string; expiresInSeconds: number };
type Problem =
  | { kind: 'invalid' }
  | { kind: 'locked'; minutes: number | null }
  | { kind: 'ipBlocked'; ip: string }
  | { kind: 'captcha' }
  | { kind: 'challengeExpired' }
  | { kind: 'rateLimited' }
  | { kind: 'unexpected'; requestId?: string };

async function post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Request-Id': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok)
    throw toApiError(
      res.status,
      json,
      res.headers.get('x-request-id'),
      res.headers.get('retry-after'),
    );
  return json;
}

/** Sign-in for platform operators: credentials, optional captcha, then the MFA step. */
export function OperatorLogin({
  expired,
  idleMinutes = null,
  next,
  captcha,
}: {
  expired: boolean;
  /** The session ended for inactivity (TW-AUTH-033): the limit in minutes, shown in the notice. */
  idleMinutes?: number | null;
  next?: string;
  captcha: CaptchaConfig | null;
}) {
  const t = useTranslations(NS);
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: 'credentials' });
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
    code?: string;
    captcha?: string;
  }>({});
  const [useRecovery, setUseRecovery] = useState(false);
  const [notice, setNotice] = useState<'expired' | 'idle' | null>(
    expired ? 'expired' : idleMinutes ? 'idle' : null,
  );
  const {
    status: captchaStatus,
    solved: captchaSolved,
    setContainer,
    getToken,
    reset: resetCaptcha,
    retry: retryCaptcha,
  } = useRecaptcha(captcha);
  const lock = useCountdown();
  const challenge = useCountdown();

  const locked = lock.remaining > 0;

  const finish = (enrolmentRequired: boolean) => {
    router.replace(
      enrolmentRequired ? OPERATOR_ACCOUNT_PATH : safeConsolePath(next, OPERATOR_HOME),
    );
    router.refresh();
  };

  function explain(e: unknown): Problem {
    if (!(e instanceof ApiError)) return { kind: 'unexpected' };
    switch (e.code) {
      case ERROR_CODES.AUTH_INVALID_CREDENTIALS:
      case ERROR_CODES.AUTH_MFA_INVALID_CODE:
        return { kind: 'invalid' };
      case ERROR_CODES.AUTH_ACCOUNT_LOCKED: {
        const wait = retryAfterSeconds(e);
        if (wait) lock.start(wait);
        return { kind: 'locked', minutes: lockedMinutes(e) };
      }
      case ERROR_CODES.AUTH_IP_BLOCKED:
        return { kind: 'ipBlocked', ip: fieldMessage(e, 'ip') ?? '' };
      case ERROR_CODES.AUTH_CAPTCHA_FAILED:
        return { kind: 'captcha' };
      case ERROR_CODES.AUTH_MFA_CHALLENGE_EXPIRED:
        return { kind: 'challengeExpired' };
      case ERROR_CODES.RATE_LIMITED: {
        const wait = retryAfterSeconds(e);
        if (wait) lock.start(wait);
        return { kind: 'rateLimited' };
      }
      default:
        return { kind: 'unexpected', requestId: e.requestId };
    }
  }

  function backToCredentials(p: Problem | null) {
    challenge.stop();
    setStep({ kind: 'credentials' });
    setUseRecovery(false);
    setProblem(p);
  }

  async function submitCredentials(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || locked) return;
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    const errors: typeof fieldErrors = {};
    if (!emailSchema.safeParse(email).success) errors.email = t('errors.email');
    if (!password) errors.password = t('errors.passwordRequired');
    if (captcha && captchaStatus === 'ready' && captcha.version === 'v2' && !captchaSolved) {
      errors.captcha = t('errors.captchaRequired');
    }
    setFieldErrors(errors);
    setNotice(null);
    if (errors.email) return focusField('op-email');
    if (errors.password) return focusField('op-password');
    if (errors.captcha) return;

    setPending(true);
    setProblem(null);
    try {
      const captchaToken = captcha ? await getToken() : undefined;
      const raw = await post('/api/platform-auth/login', {
        email,
        password,
        ...(captchaToken ? { captchaToken } : {}),
      });
      const res = bffLoginResponseSchema.safeParse(raw);
      if (!res.success) throw new ApiError(502, 'INTERNAL', 'Unexpected response');
      if (res.data.status === 'mfa_required') {
        challenge.start(res.data.expiresInSeconds);
        setStep({
          kind: 'mfa',
          challengeToken: res.data.challengeToken,
          expiresInSeconds: res.data.expiresInSeconds,
        });
        setPending(false);
        return;
      }
      finish(res.data.mfaEnrolmentRequired);
    } catch (err) {
      setProblem(explain(err));
      resetCaptcha();
      if (err instanceof ApiError && err.code === ERROR_CODES.AUTH_INVALID_CREDENTIALS)
        focusField('op-password', true);
      setPending(false);
    }
  }

  async function submitCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || locked || step.kind !== 'mfa') return;
    const value = String(new FormData(e.currentTarget).get('code') ?? '').trim();
    const valid = useRecovery ? RECOVERY_CODE.test(value) : /^\d{6}$/.test(value);
    if (!valid) {
      setFieldErrors({ code: useRecovery ? t('errors.recoveryFormat') : t('errors.codeFormat') });
      focusField('op-code');
      return;
    }
    setFieldErrors({});
    setPending(true);
    setProblem(null);
    try {
      const raw = (await post('/api/platform-auth/mfa', {
        challengeToken: step.challengeToken,
        ...(useRecovery ? { recoveryCode: value } : { code: value }),
      })) as { mfaEnrolmentRequired?: boolean };
      finish(raw.mfaEnrolmentRequired === true);
    } catch (err) {
      const p = explain(err);
      if (p.kind === 'challengeExpired' || p.kind === 'ipBlocked') backToCredentials(p);
      else {
        setProblem(p);
        focusField('op-code', true);
      }
      setPending(false);
    }
  }

  const problemText = (p: Problem): string => {
    switch (p.kind) {
      case 'invalid':
        return step.kind === 'mfa' ? t('problems.invalidCode') : t('problems.invalid');
      case 'locked':
        return p.minutes ? t('problems.lockedWait', { minutes: p.minutes }) : t('problems.locked');
      case 'ipBlocked':
        return p.ip ? t('problems.ipBlocked', { ip: p.ip }) : t('problems.ipBlockedUnknown');
      case 'captcha':
        return t('problems.captcha');
      case 'challengeExpired':
        return t('problems.challengeExpired');
      case 'rateLimited':
        return t('problems.rateLimited');
      default:
        return t('problems.unexpected');
    }
  };

  const challengeLeft = challenge.remaining;
  // Once the code window has closed the server refuses the code anyway: say so and restart.
  const challengeOver = step.kind === 'mfa' && challengeLeft === 0;

  // Both forms use method=post: a submit before the page has hydrated must never put the password or code in the address bar.
  return (
    <Card className="w-full space-y-5 p-6 shadow-sm sm:p-8">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">
          {step.kind === 'mfa' ? t('mfa.title') : t('title')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {step.kind === 'mfa'
            ? useRecovery
              ? t('mfa.recoveryIntro')
              : t('mfa.intro')
            : t('intro')}
        </p>
      </header>

      {notice === 'expired' && step.kind === 'credentials' && (
        <Alert tone="info">{t('notices.expired')}</Alert>
      )}
      {notice === 'idle' && step.kind === 'credentials' && idleMinutes && (
        <Alert tone="info">{t('notices.idle', { minutes: idleMinutes })}</Alert>
      )}

      {problem && (
        <Alert tone="danger" className="space-y-1">
          <p>{problemText(problem)}</p>
          {problem.kind === 'locked' && locked && (
            <p className="font-mono text-xs" aria-live="off">
              {t('problems.tryAgainIn', { time: formatMmSs(lock.remaining) })}
            </p>
          )}
          {problem.kind === 'ipBlocked' && (
            <p className="text-xs opacity-80">{t('problems.ipBlockedHelp')}</p>
          )}
          {problem.kind === 'unexpected' && problem.requestId && (
            <p className="text-xs opacity-80">
              {t('requestId')}: <span className="font-mono">{problem.requestId}</span>
            </p>
          )}
        </Alert>
      )}

      {step.kind === 'credentials' ? (
        <form
          method="post"
          action="/admin/login"
          onSubmit={(e) => void submitCredentials(e)}
          noValidate
          className="space-y-4"
        >
          <Field label={t('fields.email')} htmlFor="op-email" error={fieldErrors.email}>
            <Input
              id="op-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoFocus
              required
              invalid={Boolean(fieldErrors.email)}
              placeholder={t('fields.emailPlaceholder')}
            />
          </Field>
          <Field label={t('fields.password')} htmlFor="op-password" error={fieldErrors.password}>
            <PasswordInput
              id="op-password"
              name="password"
              autoComplete="current-password"
              required
              invalid={Boolean(fieldErrors.password)}
              showLabel={t('fields.showPassword')}
              hideLabel={t('fields.hidePassword')}
            />
          </Field>

          {captcha && captcha.version === 'v2' && (
            <div className="space-y-1.5">
              {captchaStatus === 'error' ? (
                <Alert tone="warning" className="space-y-2">
                  <p>{t('captcha.loadFailed')}</p>
                  <Button variant="secondary" size="sm" onClick={retryCaptcha}>
                    {t('captcha.retry')}
                  </Button>
                </Alert>
              ) : (
                <div ref={setContainer} className="min-h-[78px]" />
              )}
              {fieldErrors.captcha && (
                <p role="alert" className="text-xs text-danger">
                  {fieldErrors.captcha}
                </p>
              )}
            </div>
          )}
          {captcha && captcha.version === 'v3' && captchaStatus === 'error' && (
            <Alert tone="warning" className="space-y-2">
              <p>{t('captcha.loadFailed')}</p>
              <Button variant="secondary" size="sm" onClick={retryCaptcha}>
                {t('captcha.retry')}
              </Button>
            </Alert>
          )}
          {captcha && captcha.version === 'v3' && (
            <p className="text-xs text-muted-foreground">{t('captcha.v3Notice')}</p>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={pending || locked || (captcha !== null && captchaStatus === 'loading')}
          >
            {pending && <Spinner label={t('submitting')} />}
            {pending
              ? t('submitting')
              : locked
                ? t('problems.tryAgainIn', { time: formatMmSs(lock.remaining) })
                : t('submit')}
          </Button>
        </form>
      ) : (
        <form
          method="post"
          action="/admin/login"
          onSubmit={(e) => void submitCode(e)}
          noValidate
          className="space-y-4"
        >
          <Field
            label={useRecovery ? t('mfa.recoveryLabel') : t('mfa.codeLabel')}
            htmlFor="op-code"
            error={fieldErrors.code}
            hint={useRecovery ? t('mfa.recoveryHint') : t('mfa.codeHint')}
          >
            <Input
              id="op-code"
              key={useRecovery ? 'recovery' : 'code'}
              name="code"
              autoFocus
              required
              autoComplete={useRecovery ? 'off' : 'one-time-code'}
              inputMode={useRecovery ? 'text' : 'numeric'}
              maxLength={useRecovery ? 32 : 6}
              spellCheck={false}
              autoCapitalize="none"
              invalid={Boolean(fieldErrors.code) || problem?.kind === 'invalid'}
              className={
                useRecovery ? 'font-mono tracking-wider' : 'font-mono text-lg tracking-[0.4em]'
              }
              dir="ltr"
              onChange={(e) => {
                if (!useRecovery)
                  e.currentTarget.value = e.currentTarget.value.replace(/\D/g, '').slice(0, 6);
              }}
            />
          </Field>
          <p className="text-xs text-muted-foreground" aria-live="off">
            {challengeOver
              ? t('mfa.windowClosed')
              : t('mfa.windowLeft', { time: formatMmSs(challengeLeft) })}
          </p>
          <Button type="submit" className="w-full" disabled={pending || challengeOver || locked}>
            {pending && <Spinner label={t('mfa.verifying')} />}
            {pending
              ? t('mfa.verifying')
              : locked
                ? t('problems.tryAgainIn', { time: formatMmSs(lock.remaining) })
                : t('mfa.verify')}
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <button
              type="button"
              onClick={() => {
                setUseRecovery((v) => !v);
                setFieldErrors({});
                setProblem(null);
              }}
              className="rounded text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
            >
              {useRecovery ? t('mfa.useAuthenticator') : t('mfa.useRecovery')}
            </button>
            <button
              type="button"
              onClick={() => backToCredentials(null)}
              className="rounded text-muted-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('mfa.back')}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
