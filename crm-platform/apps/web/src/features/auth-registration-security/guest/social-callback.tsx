'use client';

import type { SocialProvider } from '@crm/contracts';
import { Spinner } from '@crm/ui';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { postBff } from './bff';
import { mapAuthError, type MappedError } from './errors';
import { MfaStep } from './mfa-step';
import { bffLoginResponseSchema, type BffLoginResponse } from './schemas';
import { completeSignIn } from './sign-in-complete';

type State =
  | { phase: 'working' }
  | { phase: 'mfa'; token: string; expiresAt: number }
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
}: {
  provider: SocialProvider;
  code: string;
  state: string;
  /** `error` query parameter: the visitor cancelled or the provider refused. */
  providerError: string;
}) {
  const t = useTranslations('auth-registration-security.guest.callback');
  const te = useTranslations('auth-registration-security.guest.errors');
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
        if (res.status === 'mfa_required') {
          setView({
            phase: 'mfa',
            token: res.challengeToken,
            expiresAt: Date.now() + res.expiresInSeconds * 1000,
          });
          return;
        }
        completeSignIn(res);
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
        className="flex items-center justify-center gap-3 py-8 text-sm text-muted-foreground"
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
        remember={false}
        onBack={backToSignIn}
      />
    );
  }

  const message = view.cancelled
    ? t('cancelled')
    : view.expired
      ? te('socialExpired')
      : view.error
        ? te(view.error.key, view.error.params)
        : te('unexpected');
  return (
    <div className="space-y-4">
      <div
        role="alert"
        className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
      >
        <p className="font-medium">{t('failedTitle')}</p>
        <p>{message}</p>
      </div>
      <div className="flex flex-col items-center gap-2 text-sm">
        <Link
          href="/login"
          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 font-medium text-primary-foreground hover:opacity-90"
        >
          {t('backToSignIn')}
        </Link>
        <Link href="/signup" className="text-muted-foreground underline-offset-2 hover:underline">
          {t('createAccount')}
        </Link>
      </div>
    </div>
  );
}
