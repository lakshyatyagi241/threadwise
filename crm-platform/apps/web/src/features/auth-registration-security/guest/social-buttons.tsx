'use client';

import {
  socialStartResponseSchema,
  type RegistrationConfigResponse,
  type SocialProvider,
} from '@crm/contracts';
import { Spinner, cn } from '@crm/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { callApi } from './bff';
import { mapAuthError, type MappedError } from './errors';

const PROVIDERS: SocialProvider[] = ['google', 'facebook'];

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
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

function FacebookMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#1877F2" />
      <path
        fill="#fff"
        d="M13.4 21v-7.500h2.500l.4-3h-2.900V8.600c0-.8.300-1.400 1.500-1.400h1.500V4.500c-.3 0-1.200-.1-2.200-.1-2.200 0-3.700 1.300-3.700 3.800v2.300H8v3h2.500V21h2.900z"
      />
    </svg>
  );
}

/**
 * Google / Facebook buttons (WD-AUTH-004). Only providers the platform enabled are shown. A click asks the
 * API for the provider's consent URL (the API keeps the single-use `state`) and leaves for it; the provider
 * returns to /auth/social/<provider>/callback.
 */
export function SocialButtons({
  social,
  mode,
  getOrgSlug,
  getOrgName,
  compact = false,
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
      onError(mapAuthError(e));
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className={cn('grid gap-2', live.length > 1 && 'sm:grid-cols-2')}>
        {live.map((provider) => (
          <button
            key={provider}
            type="button"
            disabled={disabled || pending !== null}
            onClick={() => void start(provider)}
            className={cn(
              'inline-flex items-center justify-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground transition',
              'hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60',
              compact ? 'h-9' : 'h-10',
            )}
          >
            {pending === provider ? (
              <Spinner label={t('redirecting')} />
            ) : provider === 'google' ? (
              <GoogleMark />
            ) : (
              <FacebookMark />
            )}
            <span>{t(`${mode}.${provider}`)}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span>{t('divider')}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
