'use client';

import {
  signupSetPasswordRequestSchema,
  type PasswordPolicyHint,
  type RegistrationConfigResponse,
} from '@crm/contracts';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';
import { postBff } from './bff';
import { mapAuthError, type MappedError } from './errors';
import { dropKey, focusFirstInvalid } from './focus';
import { FormError } from './form-error';
import { FormField } from './form-field';
import { AgreeLabel } from './legal-links';
import { saveChallenge, toStoredChallenge } from './otp-challenge';
import { PolicyErrors } from './policy-errors';
import { longEnough, policyHintParts } from './policy-hint';
import { bffSignupResponseSchema } from './schemas';
import { completeSignIn } from './sign-in-complete';
import {
  clearSignupStage,
  defaultStore,
  parseSignupStage,
  readSignupStageRaw,
  type StoredSignupStage,
} from './signup-challenge';
import { Button, ArrowIcon, Checkbox, PasswordInput, Spinner } from './ui';
import { failedFields } from './zod-fields';

const FIELD_ORDER = ['password', 'confirmPassword', 'acceptTerms'] as const;

const noopSubscribe = () => () => undefined;
const UNREAD = Symbol('unread');

/**
 * Sign-up step 3 of 3: the account's password and terms, now that the email is verified
 * (TW-AUTH-006 email-verification redesign). The pending sign-up lives on the server; this page only
 * keeps the non-secret stage data (token, masked email, deadlines) in sessionStorage so a reload keeps
 * its place. Submitting creates the account, unless the admin also requires a verified mobile number,
 * in which case it starts that check next (/verify-otp), same as the one-step sign-up form did.
 */
export function SignupPasswordForm({
  config,
  passwordPolicy,
}: {
  config: RegistrationConfigResponse;
  /** The live password rules, for the hint. Null when they could not be read. */
  passwordPolicy: PasswordPolicyHint | null;
}) {
  const router = useRouter();
  // sessionStorage only exists in the browser: the server render (and hydration) sees `UNREAD`, never "empty".
  const raw = useSyncExternalStore<string | null | typeof UNREAD>(
    noopSubscribe,
    () => readSignupStageRaw(defaultStore()),
    () => UNREAD,
  );
  const stage = useMemo(() => (raw === UNREAD ? null : parseSignupStage(raw)), [raw]);
  const missing = raw !== UNREAD && stage === null;

  useEffect(() => {
    // Nothing to set a password for (opened directly, or the tab was closed): start over.
    if (missing) router.replace('/signup');
  }, [missing, router]);

  if (!stage) {
    return (
      <div className="flex justify-center py-8 text-(--auth-ink-500)">
        <Spinner />
      </div>
    );
  }
  return <PasswordEntry initial={stage} config={config} passwordPolicy={passwordPolicy} />;
}

/** Exported (alongside `SignupPasswordForm`) so a render test can drive it without touching sessionStorage. */
export function PasswordEntry({
  initial,
  config,
  passwordPolicy,
}: {
  initial: StoredSignupStage;
  config: RegistrationConfigResponse;
  passwordPolicy: PasswordPolicyHint | null;
}) {
  const t = useTranslations('auth-registration-security.guest.signup');
  const tv = useTranslations('auth-registration-security.guest.validation');
  const tl = useTranslations('auth-registration-security.guest.login');
  const te = useTranslations('auth-registration-security.guest.errors');
  const tp = useTranslations('auth-registration-security.guest.policy');
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const policy = policyHintParts(passwordPolicy);
  const passwordHint = [
    tp('minLength', { min: policy.min }),
    ...policy.extras.map((e) => tp(e)),
  ].join(' ');

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MappedError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, ReactNode>>({});
  const [agree, setAgree] = useState(false);

  function show(failed: string[], messages: Record<string, ReactNode>) {
    setFieldErrors(messages);
    focusFirstInvalid(form.current, FIELD_ORDER, failed);
  }

  function restart() {
    clearSignupStage();
    router.replace('/signup');
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    const data = new FormData(e.currentTarget);
    const password = String(data.get('password') ?? '');
    const confirm = String(data.get('confirmPassword') ?? '');

    const body = {
      token: initial.token,
      password,
      acceptTerms: agree ? (true as const) : (false as unknown as true),
    };
    const parsed = signupSetPasswordRequestSchema.safeParse(body);
    const messages: Record<string, ReactNode> = {};
    const failed: string[] = parsed.success ? [] : failedFields(parsed.error);
    for (const f of failed)
      messages[f] = tv(f === 'password' ? 'newPassword' : f, { min: policy.min });
    // The contract only guards the floor; the live minimum is shown to the visitor before the server is asked.
    if (!failed.includes('password') && !longEnough(password, policy)) {
      messages.password = tv('newPassword', { min: policy.min });
      failed.push('password');
    }
    if (password !== confirm) {
      messages.confirmPassword = tv('confirmPassword');
      failed.push('confirmPassword');
    }
    if (failed.length > 0 || !parsed.success) {
      show(failed, messages);
      return;
    }
    setFieldErrors({});

    setPending(true);
    try {
      const res = await postBff('signup-set-password', parsed.data, bffSignupResponseSchema);
      clearSignupStage();
      if (res.status === 'otp_required') {
        saveChallenge(toStoredChallenge(res, Date.now()));
        router.push('/verify-otp');
        return;
      }
      completeSignIn(res);
    } catch (err) {
      const mapped = mapAuthError(err);
      // The staged sign-up is gone (it lives a limited time, or was consumed by a race): nothing left to
      // set a password for.
      if (mapped.key === 'signupExpired') return restart();
      setError(mapped);
      const messages: Record<string, ReactNode> = {};
      if (mapped.key === 'passwordPolicy') {
        messages.password = <PolicyErrors rules={mapped.policy} />;
      } else if (mapped.key === 'validation') {
        for (const name of FIELD_ORDER) {
          const first = mapped.fieldErrors[name]?.[0];
          if (first) messages[name] = first;
        }
      } else if (mapped.field) {
        messages[mapped.field] = te(mapped.key, mapped.params);
      }
      setFieldErrors(messages);
      focusFirstInvalid(form.current, FIELD_ORDER, Object.keys(messages));
      setPending(false);
    }
  }

  return (
    <form
      method="post"
      ref={form}
      onSubmit={(e) => void onSubmit(e)}
      onInput={(e) => {
        const name = (e.target as HTMLInputElement).name;
        setFieldErrors((prev) => dropKey(prev, name));
        setError((cur) => (cur && cur.field === name ? null : cur));
      }}
      noValidate
      className="space-y-2.5"
    >
      <div className="empty:hidden">
        <FormError
          error={error}
          skipFieldMessage={Boolean(
            error &&
            (error.key === 'passwordPolicy' || (error.field && fieldErrors[error.field])),
          )}
        />
      </div>

      <FormField label={t('password')} error={fieldErrors.password} hint={passwordHint}>
        {(p) => (
          <PasswordInput
            {...p}
            name="password"
            autoComplete="new-password"
            placeholder={tp('placeholder', { min: policy.min })}
            showLabel={tl('showPassword')}
            hideLabel={tl('hidePassword')}
            autoFocus
            className="py-2.5"
          />
        )}
      </FormField>

      <FormField label={t('confirmPassword')} error={fieldErrors.confirmPassword}>
        {(p) => (
          <PasswordInput
            {...p}
            name="confirmPassword"
            autoComplete="new-password"
            showLabel={tl('showPassword')}
            hideLabel={tl('hidePassword')}
            className="py-2.5"
          />
        )}
      </FormField>

      <div className="space-y-1.5 pt-0.5">
        <Checkbox
          id="acceptTerms"
          name="acceptTerms"
          checked={agree}
          onChange={(e) => setAgree(e.target.checked)}
          aria-invalid={fieldErrors.acceptTerms ? true : undefined}
          className="items-start text-[12.5px] leading-snug"
          label={<AgreeLabel links={config.links} />}
        />
        {fieldErrors.acceptTerms && (
          <p role="alert" className="text-[11.5px] text-(--auth-coral-ink)">
            {fieldErrors.acceptTerms}
          </p>
        )}
      </div>

      <Button type="submit" className="mt-1 w-full py-3" disabled={pending}>
        {pending ? <Spinner label={t('submitting')} /> : null}
        {pending ? t('submitting') : t('submit')}
        {!pending && <ArrowIcon />}
      </Button>
    </form>
  );
}
