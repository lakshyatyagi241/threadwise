'use client';

import { neutralAckSchema } from '@crm/contracts';
import { Spinner } from '@crm/ui';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { callApi } from './bff';
import { ApiError } from '@/lib/api/errors';
import { mapAuthError, type MappedError } from './errors';

type Kind = 'verifyEmail' | 'confirmEmailChange';

const ENDPOINT: Record<Kind, string> = {
  verifyEmail: '/auth/verify-email',
  confirmEmailChange: '/account/email-change/confirm',
};

type State = { phase: 'working' } | { phase: 'done' } | { phase: 'failed'; error: MappedError };

/**
 * The links are single use. React runs effects twice in development, so one call per token is
 * shared: the second render awaits the first one's result instead of burning the token again.
 */
const inflight = new Map<string, Promise<void>>();

function consume(kind: Kind, org: string, token: string): Promise<void> {
  const key = `${kind}:${org}:${token}`;
  let p = inflight.get(key);
  if (!p) {
    p = callApi(ENDPOINT[kind], {
      method: 'POST',
      body: { orgSlug: org, token },
      schema: neutralAckSchema,
    }).then(() => undefined);
    inflight.set(key, p);
  }
  return p;
}

/**
 * Landing page for an emailed link (email verification WD-AUTH-015, email change). Posts the token once and
 * shows the outcome. It never signs anyone in: it offers the sign-in link instead.
 */
export function LinkLanding({
  kind,
  org,
  token,
  usable = true,
}: {
  kind: Kind;
  org: string;
  token: string;
  /** False when the address had no workspace or token: show the failure without calling the API. */
  usable?: boolean;
}) {
  const t = useTranslations(`auth-registration-security.guest.${kind}`);
  const te = useTranslations('auth-registration-security.guest.errors');
  const [state, setState] = useState<State>(
    usable
      ? { phase: 'working' }
      : {
          phase: 'failed',
          error: { ...mapAuthError(new ApiError(400, 'AUTH_TOKEN_INVALID', 'invalid')) },
        },
  );

  useEffect(() => {
    if (!usable) return;
    let cancelled = false;
    consume(kind, org, token).then(
      () => !cancelled && setState({ phase: 'done' }),
      (err: unknown) => !cancelled && setState({ phase: 'failed', error: mapAuthError(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [kind, org, token, usable]);

  const signIn = (
    <Link
      href={org ? `/login?org=${encodeURIComponent(org)}` : '/login'}
      className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
    >
      {t('signIn')}
    </Link>
  );

  if (state.phase === 'working') {
    return (
      <div
        className="flex items-center justify-center gap-3 py-6 text-sm text-muted-foreground"
        role="status"
      >
        <Spinner label={t('working')} />
        <span>{t('working')}</span>
      </div>
    );
  }

  if (state.phase === 'done') {
    return (
      <div className="space-y-4">
        <div
          role="status"
          className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success"
        >
          <p className="font-medium">{t('doneTitle')}</p>
          <p>{t('doneBody')}</p>
        </div>
        {signIn}
      </div>
    );
  }

  const { error } = state;
  return (
    <div className="space-y-4">
      <div
        role="alert"
        className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
      >
        <p className="font-medium">{t('failedTitle')}</p>
        <p>
          {error.key === 'tokenInvalid' ||
          error.key === 'emailTaken' ||
          error.key === 'sessionExpired'
            ? te(error.key === 'sessionExpired' ? 'tokenInvalid' : error.key)
            : te(error.key, error.params)}
        </p>
        <p className="mt-1 text-xs">{t('failedHint')}</p>
      </div>
      {signIn}
    </div>
  );
}
