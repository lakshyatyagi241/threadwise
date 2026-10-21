'use client';

import type { WorkspaceChoice } from '@crm/contracts';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { postBff } from './bff';
import { mapAuthError, type MappedError } from './errors';
import { FormError } from './form-error';
import { bffLoginResponseSchema, type BffLoginResponse } from './schemas';
import { Spinner, cn } from './ui';
import { useCountdown } from './use-countdown';

/**
 * After a sign-in whose email and password opened several workspaces: one card each, centred, and the
 * person picks which to enter. The password was already checked, so a pick goes straight to the second
 * factor or the session. The choice lives about five minutes, then the visitor signs in again.
 */
export function WorkspacePicker({
  selectionToken,
  expiresAt,
  workspaces,
  onPicked,
  onBack,
}: {
  selectionToken: string;
  /** Epoch ms when the choice stops being valid. */
  expiresAt: number;
  workspaces: WorkspaceChoice[];
  onPicked: (res: BffLoginResponse, slug: string) => void;
  /** Back to the credentials step; `expired` explains why the choice lapsed. */
  onBack: (reason?: 'expired') => void;
}) {
  const t = useTranslations('auth-registration-security.guest.login');
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [error, setError] = useState<MappedError | null>(null);
  const left = useCountdown(expiresAt);

  useEffect(() => {
    if (left === 0) onBack('expired');
  }, [left, onBack]);

  async function pick(slug: string) {
    if (pendingSlug) return;
    setError(null);
    setPendingSlug(slug);
    try {
      const res = await postBff(
        'login-workspace',
        { selectionToken, orgSlug: slug },
        bffLoginResponseSchema,
      );
      onPicked(res, slug);
    } catch (err) {
      const mapped = mapAuthError(err);
      // The token is spent or expired: nothing left to pick from.
      if (mapped.key === 'mfaExpired') {
        onBack('expired');
        return;
      }
      setError(mapped);
      setPendingSlug(null);
    }
  }

  return (
    <div className="text-center">
      <h2 className="text-[18px] font-semibold text-(--auth-ink-900)">{t('chooseTitle')}</h2>
      <p className="mt-1 text-[13px] text-(--auth-ink-600)">{t('chooseSubtitle')}</p>
      <div className="mt-4 text-start empty:hidden">
        <FormError error={error} skipFieldMessage={false} />
      </div>
      <ul className="mx-auto mt-5 grid max-w-md grid-cols-1 gap-3" aria-label={t('chooseTitle')}>
        {workspaces.map((w) => {
          const busy = pendingSlug === w.slug;
          return (
            <li key={w.slug} className="min-w-0">
              <button
                type="button"
                onClick={() => void pick(w.slug)}
                disabled={pendingSlug !== null}
                aria-busy={busy}
                className={cn(
                  'flex w-full min-w-0 items-center gap-3 rounded-xl border border-(--border) bg-(--auth-paper-0) p-3.5 text-start',
                  'transition hover:border-(--auth-link) hover:shadow-sm focus-visible:outline-2 focus-visible:outline-(--auth-link)',
                  'disabled:cursor-not-allowed disabled:opacity-60',
                )}
              >
                <span
                  aria-hidden="true"
                  className="grid size-10 shrink-0 place-items-center rounded-lg bg-(--auth-link)/10 text-[15px] font-semibold text-(--auth-link)"
                >
                  {w.name.trim().charAt(0).toUpperCase() || '?'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-(--auth-ink-900)">
                    {w.name}
                  </span>
                  <span className="block truncate text-[12px] text-(--auth-ink-600)">
                    {w.slug}
                    {w.role ? ` · ${w.role}` : ''}
                    {` · ${t('chooseMembers', { count: w.memberCount })}`}
                  </span>
                </span>
                {busy ? (
                  <Spinner label={t('submitting')} />
                ) : (
                  <span className="text-[12px] font-semibold text-(--auth-link)">
                    {t('chooseOpen')}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => onBack()}
        disabled={pendingSlug !== null}
        className="mt-2 text-[12.5px] font-semibold text-(--auth-link) hover:underline underline-offset-2"
      >
        {t('chooseBack')}
      </button>
    </div>
  );
}
