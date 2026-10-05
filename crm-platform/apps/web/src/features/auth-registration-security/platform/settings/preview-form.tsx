'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { AuthPageName, RegistrationConfigResponse } from '@crm/contracts';

/** The part of the public configuration the preview reads; a narrower type than the whole response on purpose. */
export type PreviewConfig = Pick<
  RegistrationConfigResponse,
  'social' | 'captcha' | 'rememberMeEnabled' | 'registrationOpen' | 'links'
>;
import { AgreeLabel, LegalLine } from '../../guest/legal-links';
import { SocialButtons } from '../../guest/social-buttons';

const NS = 'auth-registration-security.platform.authPages.preview.form';

function Box() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-4 shrink-0 rounded border border-border bg-background"
    />
  );
}

function Field({ label, aside }: { label: string; aside?: string }) {
  return (
    <div className="space-y-1.5 text-sm">
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{label}</span>
        {aside && <span className="text-xs font-medium text-primary">{aside}</span>}
      </span>
      <div className="h-10 rounded-md border border-border bg-background" />
    </div>
  );
}

/** What the reCAPTCHA gate looks like: a tick box for v2, a one-line notice for v3. Nothing is loaded from Google. */
function CaptchaNotice({ version }: { version: 'v2' | 'v3' }) {
  const t = useTranslations(NS);
  if (version === 'v3') {
    return <p className="text-center text-[11px] text-muted-foreground">{t('captchaV3')}</p>;
  }
  return (
    <div className="flex justify-center">
      <div className="flex w-full max-w-72 items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-3 text-sm">
        <Box />
        <span className="flex-1">{t('captchaV2')}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t('captchaBrand')}
        </span>
      </div>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground">{children}</p>;
}

/**
 * The form of a guest page as a visitor sees it, with nothing to type into: the provider buttons the
 * platform has live, the fields, the keep-signed-in row, the captcha notice, the legal line and the
 * links under the card. Every part follows the live configuration, so enabling a provider or the
 * captcha elsewhere shows up here. Wrapped in `inert`, so no part of it can be focused or clicked.
 */
export function PreviewForm({
  page,
  config,
}: {
  page: AuthPageName;
  /** The public configuration; absent while it loads or when it cannot be read, which shows the bare form. */
  config: PreviewConfig | undefined;
}) {
  const t = useTranslations(NS);
  const social = config?.social;
  const captcha = config?.captcha ?? null;
  const showRemember = page === 'login' && config?.rememberMeEnabled !== false;

  return (
    <div inert aria-hidden="true" className="space-y-5">
      {social && page !== 'forgot' && (
        <SocialButtons
          social={social}
          mode={page === 'register' ? 'signup' : 'login'}
          onError={() => undefined}
          onNeedInput={() => undefined}
          disabled
        />
      )}

      <div className="space-y-4">
        {page === 'register' ? (
          <>
            <Field label={t('org')} />
            <Field label={t('name')} />
            <Field label={t('email')} />
            <Field label={t('password')} />
          </>
        ) : page === 'forgot' ? (
          <>
            <Field label={t('workspace')} />
            <Field label={t('email')} />
          </>
        ) : (
          <>
            <Field label={t('workspace')} />
            <Field label={t('email')} />
            <Field label={t('password')} aside={t('forgotLink')} />
          </>
        )}

        {showRemember && (
          <div className="flex items-center gap-2 text-sm">
            <Box />
            <span>{t('remember')}</span>
          </div>
        )}
        {page === 'register' && config && (
          <div className="flex items-start gap-2 text-sm">
            <Box />
            <span>
              <AgreeLabel links={config.links} />
            </span>
          </div>
        )}

        {captcha && <CaptchaNotice version={captcha.version} />}

        <div className="flex h-11 items-center justify-center rounded-md bg-[var(--auth-accent)] text-sm font-medium text-[var(--auth-ink)]">
          {t(`submit.${page}`)}
        </div>
      </div>

      <div className="space-y-2 text-center text-sm">
        {page === 'login' && config?.registrationOpen !== false && (
          <Note>
            {t('newHere')} <span className="font-medium text-primary">{t('createAccount')}</span>
          </Note>
        )}
        {page === 'register' && (
          <Note>
            {t('haveAccount')} <span className="font-medium text-primary">{t('signInLink')}</span>
          </Note>
        )}
        {page === 'forgot' && (
          <Note>
            <span className="font-medium text-primary">{t('backToSignIn')}</span>
          </Note>
        )}
        {page === 'login' && config && <LegalLine links={config.links} />}
      </div>
    </div>
  );
}
