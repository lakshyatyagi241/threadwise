'use client';

import { signupRequestSchema, type RegistrationConfigResponse } from '@crm/contracts';
import { Alert, Button, Checkbox, Input, PasswordInput, Spinner } from '@crm/ui';
import Link from 'next/link';
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
import type { CountryCode } from 'libphonenumber-js';
import { postBff } from './bff';
import { useCaptcha } from './captcha';
import { captchaMissing, mapAuthError, type MappedError } from './errors';
import { dropKey, focusFirstInvalid } from './focus';
import { FormError } from './form-error';
import { FormField } from './form-field';
import { AgreeLabel } from './legal-links';
import { PhoneInput, type PhoneValue } from './phone-input';
import { evaluatePhone, pickDefaultCountry } from './phone';
import { PolicyErrors } from './policy-errors';
import { saveChallenge, toStoredChallenge } from './otp-challenge';
import { currentReferral, forgetReferral, rememberReferral, sanitizeReferral } from './referral';
import { bffSignupResponseSchema } from './schemas';
import { completeSignIn } from './sign-in-complete';
import { suggestSlug } from './slug';
import { SocialButtons } from './social-buttons';
import { StepList } from './step-list';
import { failedFields } from './zod-fields';

const noopSubscribe = () => () => undefined;

const FIELD_ORDER = [
  'fullName',
  'email',
  'orgName',
  'orgSlug',
  'phone',
  'referralCode',
  'password',
  'confirmPassword',
  'acceptTerms',
] as const;

/**
 * Sign-up step 1 (TW-AUTH-005): creates the workspace and its first user together. With registration OTP on, the
 * response asks for the WhatsApp code and nothing exists until /verify-otp succeeds (TW-AUTH-006).
 */
export function SignupForm({
  config,
  referralParam,
}: {
  config: RegistrationConfigResponse;
  /** `?ref=` from the address. */
  referralParam: string;
}) {
  const t = useTranslations('auth-registration-security.guest.signup');
  const tv = useTranslations('auth-registration-security.guest.validation');
  const tl = useTranslations('auth-registration-security.guest.login');
  const te = useTranslations('auth-registration-security.guest.errors');
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const captcha = useCaptcha(config.captcha, 'register');

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MappedError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, ReactNode>>({});
  const [orgName, setOrgName] = useState('');
  const [customSlug, setCustomSlug] = useState(false);
  const [orgSlug, setOrgSlug] = useState('');
  const [agree, setAgree] = useState(false);

  // Referral: `?ref=` wins, then the 30-day cookie from an earlier visit; typing overrides both.
  const cookieReferral = useSyncExternalStore(noopSubscribe, currentReferral, () => '');
  const [referralEdit, setReferralEdit] = useState<string | null>(null);
  const referral = referralEdit ?? (sanitizeReferral(referralParam) || cookieReferral);
  useEffect(() => {
    if (referralParam) rememberReferral(referralParam);
  }, [referralParam]);

  // Phone: the admin's default country, else the browser language's region (known only in the browser).
  const defaultIso = useSyncExternalStore(
    noopSubscribe,
    () => pickDefaultCountry(config.defaultCountryIso, navigator.languages ?? [navigator.language]),
    () => pickDefaultCountry(config.defaultCountryIso, []),
  );
  const [phoneEdit, setPhoneEdit] = useState<{ raw: string; iso: CountryCode } | null>(null);
  const phone = useMemo<PhoneValue>(() => {
    const raw = phoneEdit?.raw ?? '';
    const iso = phoneEdit?.iso ?? defaultIso;
    return { raw, iso, state: evaluatePhone(raw, iso) };
  }, [phoneEdit, defaultIso]);

  const suggested = useMemo(() => suggestSlug(orgName), [orgName]);

  function show(failed: string[], messages: Record<string, ReactNode>) {
    setFieldErrors(messages);
    focusFirstInvalid(form.current, FIELD_ORDER, failed);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    const data = new FormData(e.currentTarget);
    const text = (k: string) => String(data.get(k) ?? '').trim();
    const password = String(data.get('password') ?? '');
    const confirm = String(data.get('confirmPassword') ?? '');

    const body = {
      orgName: text('orgName'),
      ...(customSlug && text('orgSlug') ? { orgSlug: text('orgSlug') } : {}),
      fullName: text('fullName'),
      email: text('email'),
      ...(phone.state.e164 ? { phone: phone.state.e164 } : {}),
      password,
      acceptTerms: agree ? (true as const) : (false as unknown as true),
      ...(referral ? { referralCode: referral } : {}),
    };
    const parsed = signupRequestSchema.safeParse(body);
    const messages: Record<string, ReactNode> = {};
    const failed: string[] = parsed.success ? [] : failedFields(parsed.error);
    for (const f of failed) messages[f] = tv(f === 'password' ? 'newPassword' : f);
    if (!phone.raw.trim()) {
      messages.phone = tv('phoneRequired');
      failed.push('phone');
    } else if (!phone.state.valid) {
      messages.phone = tv('phone');
      failed.push('phone');
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
      if (captcha.needsInteraction) throw captchaMissing();
      const captchaToken = await captcha.token();
      const res = await postBff(
        'signup',
        { ...parsed.data, ...(captchaToken ? { captchaToken } : {}) },
        bffSignupResponseSchema,
      );
      if (res.status === 'otp_required') {
        saveChallenge(toStoredChallenge(res, Date.now()));
        router.push('/verify-otp');
        return;
      }
      forgetReferral();
      completeSignIn(res);
    } catch (err) {
      captcha.reset();
      const mapped = mapAuthError(err);
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
      // A taken address the server derived itself still needs a place to type another one.
      if (mapped.key === 'slugTaken') setCustomSlug(true);
      setFieldErrors(messages);
      focusFirstInvalid(form.current, FIELD_ORDER, Object.keys(messages));
      setPending(false);
    }
  }

  if (!config.registrationOpen) {
    return (
      <div className="space-y-4">
        <Alert tone="warning">{t('closedBody')}</Alert>
        <p className="text-center text-sm text-muted-foreground">
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {t('closedBack')}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <StepList current={1} />

      <SocialButtons
        social={config.social}
        mode="signup"
        compact
        getOrgName={() => orgName}
        onError={setError}
        onNeedInput={() => {
          setFieldErrors({ orgName: tv('orgNameForSocial') });
          focusFirstInvalid(form.current, FIELD_ORDER, ['orgName']);
        }}
        disabled={pending}
      />

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
        className="space-y-4"
      >
        <FormError
          error={error}
          skipFieldMessage={Boolean(
            error && (error.key === 'passwordPolicy' || (error.field && fieldErrors[error.field])),
          )}
        />

        <FormField label={t('fullName')} error={fieldErrors.fullName}>
          {(p) => (
            <Input
              {...p}
              name="fullName"
              autoComplete="name"
              placeholder={t('fullNamePlaceholder')}
              autoFocus
            />
          )}
        </FormField>

        <FormField label={t('email')} error={fieldErrors.email}>
          {(p) => (
            <Input
              {...p}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={tl('emailPlaceholder')}
            />
          )}
        </FormField>

        <FormField
          label={t('orgName')}
          error={fieldErrors.orgName}
          hint={suggested ? t('orgNameHint', { slug: suggested }) : t('orgNameHintEmpty')}
        >
          {(p) => (
            <Input
              {...p}
              name="orgName"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              autoComplete="organization"
              placeholder={t('orgNamePlaceholder')}
            />
          )}
        </FormField>

        {customSlug ? (
          <FormField label={t('orgSlug')} error={fieldErrors.orgSlug} hint={t('orgSlugHint')}>
            {(p) => (
              <Input
                {...p}
                name="orgSlug"
                value={orgSlug}
                onChange={(e) => setOrgSlug(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={suggested || t('orgSlugPlaceholder')}
              />
            )}
          </FormField>
        ) : (
          <button
            type="button"
            onClick={() => setCustomSlug(true)}
            className="text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            {t('customiseSlug')}
          </button>
        )}

        <FormField label={t('phone')} error={fieldErrors.phone} hint={t('phoneHint')}>
          {(p) => (
            <PhoneInput
              id={p.id}
              name="phone"
              value={phone}
              onChange={(next) => setPhoneEdit({ raw: next.raw, iso: next.iso })}
              invalid={p.invalid}
              describedBy={p['aria-describedby']}
              placeholder={t('phonePlaceholder')}
            />
          )}
        </FormField>

        <FormField
          label={t('referral')}
          optionalLabel={t('optional')}
          error={fieldErrors.referralCode}
        >
          {(p) => (
            <Input
              {...p}
              name="referralCode"
              value={referral}
              onChange={(e) => setReferralEdit(sanitizeReferral(e.target.value))}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={16}
              placeholder={t('referralPlaceholder')}
              className="font-mono uppercase placeholder:font-sans placeholder:normal-case"
            />
          )}
        </FormField>

        <FormField label={t('password')} error={fieldErrors.password} hint={t('passwordHint')}>
          {(p) => (
            <PasswordInput
              {...p}
              name="password"
              autoComplete="new-password"
              showLabel={tl('showPassword')}
              hideLabel={tl('hidePassword')}
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
            />
          )}
        </FormField>

        <div className="space-y-1.5">
          <Checkbox
            id="acceptTerms"
            name="acceptTerms"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            aria-invalid={fieldErrors.acceptTerms ? true : undefined}
            label={<AgreeLabel links={config.links} />}
          />
          {fieldErrors.acceptTerms && (
            <p role="alert" className="text-xs text-danger">
              {fieldErrors.acceptTerms}
            </p>
          )}
        </div>

        {captcha.widget}

        <Button type="submit" className="h-11 w-full" disabled={pending}>
          {pending && <Spinner label={t('submitting')} />}
          {pending ? t('submitting') : t('submit')}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        {t('haveAccount')}{' '}
        <Link href="/login" className="font-medium text-primary underline-offset-2 hover:underline">
          {t('signIn')}
        </Link>
      </p>
    </div>
  );
}
