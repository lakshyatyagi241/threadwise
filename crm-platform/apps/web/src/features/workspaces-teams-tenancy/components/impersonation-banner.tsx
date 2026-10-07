'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { IMPERSONATION_KEY, impersonationApi, stopImpersonation } from '../api/impersonation';
import { minutesLeft } from '../lib/impersonation';

const NS = 'workspaces-teams-tenancy.impersonation';

/**
 * The strip across the top of the workspace app while an operator is acting as its owner (TW-WSP-033): who and where, why, how long
 * is left, read-only or not, and the way out. Non-dismissible: it renders for as long as the API says the session is active and has
 * no close button, only Stop. An ordinary session gets nothing (one cheap status call).
 */
export function ImpersonationBanner() {
  const t = useTranslations(NS);
  const { org, user } = useSession();
  const q = useQuery({
    queryKey: IMPERSONATION_KEY,
    queryFn: ({ signal }) => impersonationApi.status(signal),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  // The countdown ticks on its own; the status call only corrects it.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!q.data?.active) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [q.data?.active]);
  const [state, setState] = useState<'idle' | 'stopping' | 'failed'>('idle');

  if (!q.data?.active) return null;
  const left = minutesLeft(q.data.expiresAt, now);

  async function stop() {
    setState('stopping');
    try {
      window.location.assign(await stopImpersonation());
    } catch {
      setState('failed');
    }
  }

  return (
    <div
      role="status"
      data-testid="impersonation-banner"
      data-read-only={q.data.readOnly ? 'true' : 'false'}
      className="sticky top-0 z-40 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-amber-400 px-4 py-2 text-sm font-medium text-black"
    >
      <span className="rounded bg-black px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-300">
        {t('label')}
      </span>
      <span>{t('viewing', { workspace: org.name, owner: user.displayName ?? user.fullName })}</span>
      {q.data.reason && (
        <span className="hidden md:inline">{t('reason', { reason: q.data.reason })}</span>
      )}
      {q.data.readOnly && (
        <span
          data-testid="impersonation-read-only"
          className="rounded border border-black px-2 py-0.5 text-xs font-semibold"
        >
          {t('readOnly')}
        </span>
      )}
      <span data-testid="impersonation-time-left">
        {left > 0 ? t('timeLeft', { minutes: left }) : t('endsSoon')}
      </span>
      <button
        type="button"
        onClick={() => void stop()}
        disabled={state === 'stopping'}
        className="inline-flex h-7 items-center rounded-md bg-black px-3 text-xs font-semibold text-amber-300 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-black disabled:opacity-60"
      >
        {state === 'stopping' ? t('stopping') : t('stop')}
      </button>
      {state === 'failed' && (
        <span role="alert" className="text-xs">
          {t('stopFailed')}
        </span>
      )}
    </div>
  );
}
