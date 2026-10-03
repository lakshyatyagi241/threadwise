'use client';

import {
  socialStartResponseSchema,
  type RegistrationConfigResponse,
  type SocialProvider,
} from '@crm/contracts';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { callApi } from './bff';
import { mapAuthError, type MappedError } from './errors';
import { rememberNext } from './next-memory';
import { Spinner, cn } from './ui';

const PROVIDERS: SocialProvider[] = ['google', 'facebook'];

function GoogleMark({ small }: { small: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={small ? 'size-3.5' : 'size-4'} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2-1.9 3.3-4.7 3.3-8z"
      />
      <path
        fill="#34A853"
        d="M12 23c3 0 5.4-1 7.2-2.7l-3.5-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.100-4.600H2.300v2.800A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.900 13.900a6.600 6.600 0 0 1 0-4.200V6.900H2.300a11 11 0 0 0 0 9.900l3.600-2.900z"
      />
      <path
        fill="#EA4335"
        d="M12 5.400c1.600 0 3.100.6 4.200 1.700l3.100-3.100A11 11 0 0 0 2.300 6.900l3.600 2.800C6.700 7.300 9.100 5.400 12 5.400z"
      />
    </svg>
  );
}

function FacebookMark({ small }: { small: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={small ? 'size-3.5' : 'size-4'} aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#1877F2" />
      <path
        fill="#fff"
        d="M13.4 21v-7.500h2.500l.4-3h-2.900V8.600c0-.8.300-1.400 1.500-1.400h1.500V4.500c-.3 0-1.200-.1-2.200-.1-2.200 0-3.700 1.300-3.700 3.800v2.300H8v3h2.500V21h2.900z"
      />
    </svg>
  );
}

/**
 * Google / Facebook buttons (TW-AUTH-004). Only providers the platform enabled are shown. A click asks the
 * API for the provider's consent URL (the API keeps the single-use `state`) and leaves for it; the provider
 * returns to /auth/social/<provider>/callback.
 */
export function SocialButtons({
  social,
  mode,
  getOrgSlug,
  getOrgName,
  compact = false,
  next,
  onError,
  onNeedInput,
  disabled,
}: {
  social: RegistrationConfigResponse['social'];
  mode: 'login' | 'signup';
  /** Sign-in needs the workspace; sign-up needs the new workspace's name. Return '' when not filled in yet. */
  getOrgSlug?: () => string;
  getOrgName?: () => string;
  compact?: boolean;
  /** Where to land after a sign-in that returns from the provider (kept for the round trip). */
  next?: string | null;
  onError: (error: MappedError | null) => void;
  /** Called with the missing field when the visitor clicks before filling it in. */
  onNeedInput: (field: 'orgSlug' | 'orgName') => void;
  disabled?: boolean;
}) {
  const t = useTranslations('auth-registration-security.guest.social');
  const [pending, setPending] = useState<SocialProvider | null>(null);
  const live = PROVIDERS.filter((p) => social[p]);
  if (live.length === 0) return null;

  async function start(provider: SocialProvider) {
    onError(null);
    const orgSlug = getOrgSlug?.().trim() ?? '';
    const orgName = getOrgName?.().trim() ?? '';
    if (mode === 'login' && !orgSlug) return onNeedInput('orgSlug');
    if (mode === 'signup' && orgName.length < 2) return onNeedInput('orgName');
    setPending(provider);
    if (mode === 'login') rememberNext(next);
    try {
      const { url } = await callApi(`/auth/social/${provider}/start`, {
        query: {
          mode,
          orgSlug: mode === 'login' ? orgSlug : undefined,
          orgName: mode === 'signup' ? orgName : undefined,
          redirectUri: `${window.location.origin}/auth/social/${provider}/callback`,
        },
        schema: socialStartResponseSchema,
      });
      window.location.assign(url);
    } catch (e) {
      // The failure text names the provider ("Could not complete Google sign-in").
      const mapped = mapAuthError(e);
      onError({ ...mapped, params: { ...mapped.params, provider: t(provider) } });
      setPending(null);
    }
  }

  return (
    <div>
      <div className={cn('grid gap-2', live.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
        {live.map((provider) => (
          <button
            key={provider}
            type="button"
            disabled={disabled || pending !== null}
            aria-label={t(`${mode}.${provider}`)}
            onClick={() => void start(provider)}
            className={cn(
              'inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 font-medium text-foreground transition',
              'hover:bg-muted focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60',
              compact ? 'py-2 text-[12.5px]' : 'py-2.5 text-[13px]',
            )}
          >
            {pending === provider ? (
              <Spinner label={t('redirecting')} />
            ) : provider === 'google' ? (
              <GoogleMark small={compact} />
            ) : (
              <FacebookMark small={compact} />
            )}
            <span>{t(provider)}</span>
          </button>
        ))}
      </div>
      <div className={cn('flex items-center gap-3', compact ? 'my-3' : 'my-5')} aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="font-mono rtl:font-sans text-[10.5px] uppercase tracking-wider rtl:tracking-normal text-(--auth-ink-500)">
          {t('divider')}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
