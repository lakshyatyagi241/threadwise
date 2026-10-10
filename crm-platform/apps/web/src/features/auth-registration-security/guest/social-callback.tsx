'use client';

import type { SocialProvider } from '@crm/contracts';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { postBff } from './bff';
import { mapAuthError, type MappedError } from './errors';
import { MfaStep } from './mfa-step';
import { takeNext } from './next-memory';
import { bffLoginResponseSchema, type BffLoginResponse } from './schemas';
import { completeSignIn } from './sign-in-complete';
import { Alert, LINK, PRIMARY_LINK, Spinner } from './ui';

type State =
  | { phase: 'working' }
  | { phase: 'mfa'; token: string; expiresAt: number; passkey: boolean; next: string | null }
  | { phase: 'failed'; error: MappedError | null; cancelled: boolean; expired: boolean };

/** The state value is single use on the server: one POST per `state`, even when React runs the effect twice. */
const inflight = new Map<string, Promise<BffLoginResponse>>();

function complete(
  provider: SocialProvider,
  code: string,
  state: string,
): Promise<BffLoginResponse> {
  let p = inflight.get(state);
  if (!p) {
    p = postBff('social-callback', { provider, code, state }, bffLoginResponseSchema);
    inflight.set(state, p);
  }
  return p;
}

/**
 * Where Google / Facebook send the browser back to (WD-AUTH-004). The code and state go to the API through the
 * sign-in route; on success the session cookies are set and the visitor lands where `homePathFor` says. An account
 * with two-step sign-in continues with its code on this same page.
 */
export function SocialCallback({
  provider,
  code,
  state,
  providerError,
  rememberMeEnabled,
}: {
  provider: SocialProvider;
  code: string;
  state: string;
  /** `error` query parameter: the visitor cancelled or the provider refused. */
  providerError: string;
  /** Whether the platform allows long sessions; a social sign-in is remembered unless it does not. */
  rememberMeEnabled: boolean;
}) {
  const t = useTranslations('auth-registration-security.guest.callback');
  const te = useTranslations('auth-registration-security.guest.errors');
  const ts = useTranslations('auth-registration-security.guest.social');
  const [view, setView] = useState<State>(
    providerError || !code || !state
      ? { phase: 'failed', error: null, cancelled: Boolean(providerError), expired: !providerError }
      : { phase: 'working' },
  );

  useEffect(() => {
    if (providerError || !code || !state) return;
    let cancelled = false;
    complete(provider, code, state).then(
      (res) => {
        if (cancelled) return;
        // Read once, here: it is the return path remembered before the visitor left for the provider.
        const next = takeNext();
        if (res.status === 'mfa_required') {
          setView({
            phase: 'mfa',
            token: res.challengeToken,
            expiresAt: Date.now() + res.expiresInSeconds * 1000,
            passkey: res.passkey === true,
            next,
          });
          return;
        }
        completeSignIn(res, next);
      },
      (err: unknown) => {
        if (!cancelled)
          setView({ phase: 'failed', error: mapAuthError(err), cancelled: false, expired: false });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [provider, code, state, providerError]);

  const backToSignIn = useCallback((reason?: 'expired') => {
    if (reason === 'expired') {
      setView({ phase: 'failed', error: null, cancelled: false, expired: true });
      return;
    }
    window.location.replace('/login');
  }, []);

  if (view.phase === 'working') {
    return (
      <div
        className="flex items-center justify-center gap-3 py-8 text-[13px] text-(--auth-ink-600)"
        role="status"
      >
        <Spinner label={t('working')} />
        <span>{t('working')}</span>
      </div>
    );
  }

  if (view.phase === 'mfa') {
    return (
      <MfaStep
        challengeToken={view.token}
        expiresAt={view.expiresAt}
        remember={rememberMeEnabled}
        next={view.next}
        passkey={view.passkey}
        onBack={backToSignIn}
      />
    );
  }

  const message = view.cancelled
    ? t('cancelled')
    : view.expired
      ? te('socialExpired')
      : view.error
        ? te(view.error.key, { ...view.error.params, provider: ts(provider) })
        : te('unexpected');
  return (
    <div className="space-y-4">
      <Alert tone="danger" className="space-y-0.5">
        <p className="font-semibold">{t('failedTitle')}</p>
        <p>{message}</p>
      </Alert>
      <div className="flex flex-col items-center gap-3 text-[12.5px]">
        <Link href="/login" className={PRIMARY_LINK}>
          {t('backToSignIn')}
        </Link>
        <Link href="/signup" className={LINK}>
          {t('createAccount')}
        </Link>
      </div>
    </div>
  );
}
