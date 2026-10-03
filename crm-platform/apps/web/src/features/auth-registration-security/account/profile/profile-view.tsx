'use client';

import { ERROR_CODES, updateProfileRequestSchema, type ProfileResponse } from '@crm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Card, Field, Input, Select, Spinner } from '@crm/ui';
import { setLocale, setTheme } from '@/components/shell/actions';
import { ApiError } from '@/lib/api/errors';
import { LOCALES, isLocale } from '@/i18n/locales';
import { ErrorNote } from '../../shared/error-note';
import { redirectOnGateError } from '../../shared/gate-errors';
import { focusFirstInvalid } from '../../shared/focus';
import { MailIcon } from '../../shared/icons';
import { PhoneField, type PhoneValue } from '../../shared/phone-field';
import { TimezoneCombobox } from '../../shared/timezone-combobox';
import { useGateRedirect } from '../../shared/use-gate-redirect';
import { useSession } from '../../shared/session-context';
import { authApi, keys } from '../api';
import { firstNameOf } from '../hub/person-text';
import { EmailChangeModal } from './email-change-modal';
import { profileChanges, savedZone } from './profile-changes';

type Theme = ProfileResponse['theme'];
const THEMES: Theme[] = ['paper', 'bright', 'dark'];
type FieldKey = 'fullName' | 'displayName' | 'phone' | 'locale' | 'theme' | 'workspaceTimezone';
type Errors = Partial<Record<FieldKey, string>>;

export function ProfileView() {
  const t = useTranslations('auth-registration-security.account.profile');
  const c = useTranslations('auth-registration-security.account.common');
  const query = useQuery({ queryKey: keys.profile, queryFn: authApi.profile, staleTime: 0 });
  useGateRedirect(query.error);

  if (query.isPending) {
    return (
      <Card className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner label={c('loading')} /> {c('loading')}
      </Card>
    );
  }
  if (query.isError) {
    return (
      <div className="space-y-3">
        <ErrorNote error={query.error} />
        <Button variant="secondary" onClick={() => void query.refetch()}>
          {c('retry')}
        </Button>
      </div>
    );
  }
  return <ProfileForm profile={query.data} title={t('personalInfo')} />;
}

/** Applies the theme now: the shell stores light/dark in a cookie, paper and bright are both light. */
function applyTheme(theme: Theme) {
  const mode = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = mode;
  void setTheme(mode);
}

function ProfileForm({ profile, title }: { profile: ProfileResponse; title: string }) {
  const t = useTranslations('auth-registration-security.account.profile');
  const c = useTranslations('auth-registration-security.account.common');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { org } = useSession();
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);

  const initialZone = savedZone(profile);
  const [fullName, setFullName] = useState(profile.fullName);
  // Like Reference, a person with no display name sees their first name in the box as its value, so
  // saving the form as it stands stores it.
  const defaultDisplayName = profile.displayName ?? firstNameOf(profile.fullName);
  const [displayName, setDisplayName] = useState(defaultDisplayName);
  const [phone, setPhone] = useState<PhoneValue>({
    e164: profile.phone,
    empty: !profile.phone,
    problem: null,
  });
  const [locale, setLocaleValue] = useState(profile.locale ?? '');
  const [theme, setThemeValue] = useState<Theme>(profile.theme);
  const [zone, setZone] = useState(initialZone);
  const [resetCount, setResetCount] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailSent, setEmailSent] = useState<string | null>(null);

  const languageNames = useMemo(() => {
    const out: Array<{ code: string; name: string }> = [];
    for (const code of LOCALES) {
      let name: string = code;
      try {
        name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
      } catch {
        /* keep the code */
      }
      out.push({ code, name });
    }
    return out;
  }, []);

  /** Only what changed, so saving never overwrites a field the person did not touch. */
  const body = profileChanges(profile, {
    fullName,
    displayName,
    phone: phone.e164,
    locale,
    theme,
    zone,
  });
  const dirty = Object.keys(body).length > 0;

  function fail(next: Errors) {
    setErrors(next);
    setSaved(false);
    focusFirstInvalid(formRef.current);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setSaved(false);

    const next: Errors = {};
    if (!fullName.trim()) next.fullName = t('errors.fullNameRequired');
    if (phone.problem) next.phone = t('errors.phoneInvalid');
    const parsed = updateProfileRequestSchema.safeParse(body);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as FieldKey | undefined;
        if (key && !next[key]) next[key] = t('errors.invalid');
      }
    }
    if (Object.keys(next).length) return fail(next);
    // Reference's Save is always live; with nothing changed there is nothing to send and the page just confirms.
    if (!dirty) {
      setErrors({});
      setSaved(true);
      return;
    }

    setPending(true);
    setErrors({});
    try {
      const updated = await authApi.updateProfile(body);
      queryClient.setQueryData(keys.profile, updated);
      setSaved(true);
      if (body.theme) applyTheme(body.theme);
      if (body.locale && isLocale(body.locale)) await setLocale(body.locale);
      // The name and photo in the shell come from the session, which the server re-reads.
      router.refresh();
    } catch (err) {
      if (redirectOnGateError(err, router.replace)) return;
      if (err instanceof ApiError && err.code === ERROR_CODES.FORBIDDEN) {
        fail({ workspaceTimezone: t('errors.timezoneForbidden') });
      } else if (
        err instanceof ApiError &&
        err.code === ERROR_CODES.VALIDATION_FAILED &&
        err.fieldErrors.length
      ) {
        const mapped: Errors = {};
        for (const f of err.fieldErrors) {
          const key = f.path as FieldKey;
          if (!mapped[key])
            mapped[key] =
              key === 'workspaceTimezone' ? t('errors.timezoneInvalid') : t('errors.invalid');
        }
        fail(mapped);
      } else {
        setError(err);
      }
    } finally {
      setPending(false);
    }
  }

  function reset() {
    setFullName(profile.fullName);
    setDisplayName(defaultDisplayName);
    setPhone({ e164: profile.phone, empty: !profile.phone, problem: null });
    setLocaleValue(profile.locale ?? '');
    setThemeValue(profile.theme);
    setZone(initialZone);
    setErrors({});
    setError(null);
    setSaved(false);
    setResetCount((n) => n + 1);
  }

  const pendingEmail = emailSent ?? profile.pendingEmail;
  const id = (name: string) => `${uid}-${name}`;

  return (
    <>
      <Card className="space-y-5 p-5">
        <h2 className="text-lg font-semibold">{title}</h2>
        <form ref={formRef} onSubmit={(e) => void submit(e)} className="space-y-5" noValidate>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t('fullName')} htmlFor={id('name')} error={errors.fullName}>
              <Input
                id={id('name')}
                value={fullName}
                maxLength={120}
                autoComplete="name"
                onChange={(e) => setFullName(e.target.value)}
                invalid={Boolean(errors.fullName)}
                required
              />
            </Field>
            <Field
              label={t('displayName')}
              htmlFor={id('display')}
              hint={t('displayNameHint')}
              error={errors.displayName}
            >
              <Input
                id={id('display')}
                value={displayName}
                maxLength={120}
                onChange={(e) => setDisplayName(e.target.value)}
                invalid={Boolean(errors.displayName)}
              />
            </Field>
          </div>

          <Field label={t('email')} htmlFor={id('email')}>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id={id('email')}
                value={profile.email}
                readOnly
                dir="ltr"
                className="min-w-0 flex-1 basis-56 bg-muted"
              />
              <Button type="button" variant="secondary" onClick={() => setEmailOpen(true)}>
                {t('changeEmail')}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {profile.emailVerified ? (
                <Badge tone="success">{t('verified')}</Badge>
              ) : (
                <Badge tone="warning">{t('unverified')}</Badge>
              )}
            </div>
            {pendingEmail && (
              <Alert tone="info" className="mt-2 flex items-start gap-2">
                <MailIcon className="mt-0.5 size-4" />
                <span>{t('pendingEmail', { email: pendingEmail })}</span>
              </Alert>
            )}
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label={t('phone')}
              htmlFor={id('phone')}
              hint={t('phoneHint')}
              error={errors.phone}
            >
              <PhoneField
                key={resetCount}
                id={id('phone')}
                initial={profile.phone}
                onChange={setPhone}
                invalid={Boolean(errors.phone)}
              />
            </Field>

            {/* Everyone sees the workspace timezone; only whoever the API allows can change it. */}
            <Field
              label={
                <>
                  {t('workspaceTimezone')}{' '}
                  <span className="text-xs font-normal text-muted-foreground">
                    {t('workspaceTag')}
                  </span>
                </>
              }
              htmlFor={id('tz')}
              hint={t('workspaceTimezoneHint', { workspace: org.name })}
              error={errors.workspaceTimezone}
            >
              <TimezoneCombobox
                id={id('tz')}
                value={zone}
                onChange={setZone}
                invalid={Boolean(errors.workspaceTimezone)}
                disabled={!profile.canEditWorkspaceTimezone}
              />
            </Field>
          </div>

          {/* Beyond Reference's form: the person's own language and theme. */}
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label={t('language')}
              htmlFor={id('locale')}
              hint={t('languageHint')}
              error={errors.locale}
            >
              <Select
                id={id('locale')}
                value={locale}
                onChange={(e) => setLocaleValue(e.target.value)}
              >
                <option value="">{t('languageDefault')}</option>
                {languageNames.map((l) => (
                  <option key={l.code} value={l.code} lang={l.code}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('theme')} htmlFor={id('theme')} error={errors.theme}>
              <Select
                id={id('theme')}
                value={theme}
                onChange={(e) => setThemeValue(e.target.value as Theme)}
              >
                {THEMES.map((name) => (
                  <option key={name} value={name}>
                    {t(`themes.${name}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <ErrorNote error={error} />
          {saved && <Alert tone="success">{t('saved')}</Alert>}

          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="secondary" onClick={reset} disabled={pending}>
              {c('reset')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner label={c('saving')} />}
              {pending ? c('saving') : c('save')}
            </Button>
          </div>
        </form>
      </Card>

      {emailOpen && (
        <EmailChangeModal
          currentEmail={profile.email}
          onClose={() => setEmailOpen(false)}
          onRequested={(address) => {
            setEmailSent(address);
            setEmailOpen(false);
            void queryClient.invalidateQueries({ queryKey: keys.profile });
          }}
        />
      )}
    </>
  );
}
