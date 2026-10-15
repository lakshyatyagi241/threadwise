'use client';

import {
  signupRequestSchema,
  type PasswordPolicyHint,
  type RegistrationConfigResponse,
} from '@crm/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
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
import { saveChallenge, toStoredChallenge } from './otp-challenge';
import { PhoneInput, type PhoneValue } from './phone-input';
import { evaluatePhone, maskPhone, pickDefaultCountry } from './phone';
import { PolicyErrors } from './policy-errors';
import { longEnough, policyHintParts } from './policy-hint';
import { sanitizeReferral } from './referral';
import { bffSignupResponseSchema } from './schemas';
import { completeSignIn } from './sign-in-complete';
import { clearDraft, parseDraft, readDraftRaw, saveDraft } from './signup-draft';
import { suggestSlug } from './slug';
import { SocialButtons } from './social-buttons';
import { StepList } from './step-list';
import { Alert, ArrowIcon, Button, Checkbox, Input, LINK, PasswordInput, Spinner, cn } from './ui';
import { failedFields } from './zod-fields';

const noopSubscribe = () => () => undefined;
const noDraft = (): string | null => null;

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

/** Slightly tighter fields than the sign-in form: this one has the most of them. */
const COMPACT = 'py-2.5';

/**
 * Sign-up step 1 (TW-AUTH-005): creates the workspace and its first user together. With registration OTP on, the
 * response asks for the WhatsApp code and nothing exists until /verify-otp succeeds (TW-AUTH-006).
 */
export function SignupForm({
  config,
  referral: initialReferral,
  passwordPolicy,
  restore = false,
  slugConflict = false,
}: {
  config: RegistrationConfigResponse;
  /** The code to prefill: `?ref=` from the address, else the 30-day cookie, resolved on the server. */
  referral: string;
  /** The live password rules, for the hint. Null when they could not be read. */
  passwordPolicy: PasswordPolicyHint | null;
  /** Coming back from the code check: refill the non-secret answers kept in this tab. */
  restore?: boolean;
  /** The workspace address was taken while the code was being checked: open the address field. */
  slugConflict?: boolean;
}) {
  const t = useTranslations('auth-registration-security.guest.signup');
  const tv = useTranslations('auth-registration-security.guest.validation');
  const tl = useTranslations('auth-registration-security.guest.login');
  const te = useTranslations('auth-registration-security.guest.errors');
  const tp = useTranslations('auth-registration-security.guest.policy');
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const captcha = useCaptcha(config.captcha, 'register');
  const policy = policyHintParts(passwordPolicy);
  const passwordHint = [
    tp('minLength', { min: policy.min }),
    ...policy.extras.map((e) => tp(e)),
  ].join(' ');

  // The tab's saved answers exist only in the browser: the server render (and hydration) sees none.
  const rawDraft = useSyncExternalStore(
    noopSubscribe,
    () => (restore ? readDraftRaw() : null),
    noDraft,
  );
  const draft = useMemo(() => parseDraft(rawDraft), [rawDraft]);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MappedError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, ReactNode>>(
    slugConflict ? { orgSlug: te('slugTaken') } : {},
  );
  const [orgNameEdit, setOrgNameEdit] = useState<string | null>(null);
  const [customSlugEdit, setCustomSlugEdit] = useState<boolean | null>(null);
  const [orgSlugEdit, setOrgSlugEdit] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const orgName = orgNameEdit ?? draft?.orgName ?? '';
  const customSlug = customSlugEdit ?? (slugConflict || Boolean(draft?.customSlug));
  const orgSlug = orgSlugEdit ?? draft?.orgSlug ?? '';

  // Referral: the link or cookie code prefills the box; typing overrides it (then the box rules).
  const [referralEdit, setReferralEdit] = useState<string | null>(null);
  const referral = referralEdit ?? (initialReferral || draft?.referral || '');

  // Phone: opens on the platform's default country; the same on the server and in the browser.
  const defaultIso = pickDefaultCountry(config.defaultCountryIso);
  const [phoneEdit, setPhoneEdit] = useState<{ raw: string; iso: CountryCode } | null>(null);
  const phone = useMemo<PhoneValue>(() => {
    const raw = phoneEdit?.raw ?? draft?.phoneRaw ?? '';
    const iso = phoneEdit?.iso ?? pickDefaultCountry(draft?.phoneIso, defaultIso);
    return { raw, iso, state: evaluatePhone(raw, iso) };
  }, [phoneEdit, draft, defaultIso]);

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
    for (const f of failed)
      messages[f] = tv(f === 'password' ? 'newPassword' : f, { min: policy.min });
    // The contract only guards the floor; the live minimum is shown to the visitor before the server is asked.
    if (!failed.includes('password') && !longEnough(password, policy)) {
      messages.password = tv('newPassword', { min: policy.min });
      failed.push('password');
    }
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
        saveDraft({
          fullName: text('fullName'),
          email: text('email'),
          orgName: text('orgName'),
          orgSlug: customSlug ? text('orgSlug') : '',
          customSlug,
          phoneRaw: phone.raw,
          phoneIso: phone.state.iso,
          referral,
        });
        // The mask is built from the number just typed (right for any calling-code length), so the code page
        // never depends on how the server guessed the prefix.
        saveChallenge(
          toStoredChallenge(
            res,
            Date.now(),
            phone.state.e164 ? maskPhone(phone.state.e164) : undefined,
          ),
        );
        router.push('/verify-otp');
        return;
      }
      clearDraft();
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
      if (mapped.key === 'slugTaken') setCustomSlugEdit(true);
      setFieldErrors(messages);
      focusFirstInvalid(form.current, FIELD_ORDER, Object.keys(messages));
      setPending(false);
    }
  }

  if (!config.registrationOpen) {
    return (
      <div className="space-y-4">
        <Alert tone="warning">{t('closedBody')}</Alert>
        <p className="text-center text-[12.5px] text-(--auth-ink-600)">
          <Link href="/login" className={LINK}>
            {t('closedBack')}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <StepList current={1} className="mb-3" />

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
        key={draft ? 'restored' : 'fresh'}
        method="post"
        ref={form}
        onSubmit={(e) => void onSubmit(e)}
        onInput={(e) => {
          const name = (e.target as HTMLInputElement).name;
          setFieldErrors((prev) => dropKey(prev, name));
          setError((cur) => (cur && cur.field === name ? null : cur));
        }}
        noValidate
        className="grid grid-cols-1 gap-x-3 gap-y-2.5 @md:grid-cols-2"
      >
        <div className="@md:col-span-2 empty:hidden">
          <FormError
            error={error}
            skipFieldMessage={Boolean(
              error &&
              (error.key === 'passwordPolicy' || (error.field && fieldErrors[error.field])),
            )}
          />
        </div>

        <FormField label={t('fullName')} error={fieldErrors.fullName}>
          {(p) => (
            <Input
              {...p}
              name="fullName"
              defaultValue={draft?.fullName}
              autoComplete="name"
              placeholder={t('fullNamePlaceholder')}
              autoFocus
              className={COMPACT}
            />
          )}
        </FormField>

        <FormField label={t('email')} error={fieldErrors.email}>
          {(p) => (
            <Input
              {...p}
              name="email"
              type="email"
              defaultValue={draft?.email}
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={tl('emailPlaceholder')}
              className={COMPACT}
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
              onChange={(e) => setOrgNameEdit(e.target.value)}
              autoComplete="organization"
              placeholder={t('orgNamePlaceholder')}
              className={COMPACT}
            />
          )}
        </FormField>

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

        {customSlug ? (
          <FormField label={t('orgSlug')} error={fieldErrors.orgSlug} hint={t('orgSlugHint')}>
            {(p) => (
              <Input
                {...p}
                name="orgSlug"
                value={orgSlug}
                onChange={(e) => setOrgSlugEdit(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={suggested || t('orgSlugPlaceholder')}
                className={COMPACT}
                autoFocus={slugConflict}
              />
            )}
          </FormField>
        ) : (
          <button
            type="button"
            onClick={() => setCustomSlugEdit(true)}
            className={cn(LINK, 'text-[13px]')}
          >
            {t('customiseSlug')}
          </button>
        )}

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
              className={cn(
                COMPACT,
                'font-mono uppercase tracking-wider placeholder:font-sans placeholder:normal-case placeholder:tracking-normal',
              )}
            />
          )}
        </FormField>

        <FormField label={t('password')} error={fieldErrors.password} hint={passwordHint}>
          {(p) => (
            <PasswordInput
              {...p}
              name="password"
              autoComplete="new-password"
              placeholder={tp('placeholder', { min: policy.min })}
              showLabel={tl('showPassword')}
              hideLabel={tl('hidePassword')}
              className={COMPACT}
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
              className={COMPACT}
            />
          )}
        </FormField>

        <div className="space-y-1.5 pt-0.5 @md:col-span-2">
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

        <div className="@md:col-span-2 empty:hidden">{captcha.widget}</div>

        <Button type="submit" className="mt-1 w-full py-3 @md:col-span-2" disabled={pending}>
          {pending ? <Spinner label={t('submitting')} /> : null}
          {pending ? t('submitting') : t('submit')}
          {!pending && <ArrowIcon />}
        </Button>

        <p className="text-center text-[13px] text-(--auth-ink-600) @md:col-span-2">
          {t('haveAccount')}{' '}
          <Link href="/login" className={LINK}>
            {t('signIn')}
          </Link>
        </p>
      </form>
    </div>
  );
}
