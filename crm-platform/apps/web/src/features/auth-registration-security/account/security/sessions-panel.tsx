'use client';

import { ERROR_CODES, type SessionItem } from '@crm/contracts';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Modal, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { ErrorNote } from '../../shared/error-note';
import { redirectOnGateError } from '../../shared/gate-errors';
import { GlobeIcon, MonitorIcon, PhoneIcon } from '../../shared/icons';
import { formatRelative } from '../../shared/relative-time';
import { useGateRedirect } from '../../shared/use-gate-redirect';
import { authApi, keys } from '../api';
import { SESSIONS_PER_PAGE, durationLabel, pageRange } from './session-page';

const DEVICE_ICON = { desktop: MonitorIcon, mobile: PhoneIcon, unknown: GlobeIcon } as const;

type Confirm = { kind: 'one'; session: SessionItem } | { kind: 'others' } | null;

/**
 * Where you are signed in (WD-AUTH-031): one row per session with its device,
 * address and last activity, the current one marked, a sign-out per row and
 * "sign out of all other devices". WaDesk grouped by a guess (IP + user agent);
 * here every row is a real server session.
 */
export function SessionsPanel() {
  const t = useTranslations('auth-registration-security.account.sessions');
  const c = useTranslations('auth-registration-security.account.common');
  const locale = useLocale();
  const format = useFormatter();
  const router = useRouter();
  const queryClient = useQueryClient();
  // Pages are by cursor: `trail` holds the cursors already followed, so "Prev" is one step back.
  const [trail, setTrail] = useState<string[]>([]);
  const cursor = trail.at(-1);
  const query = useQuery({
    queryKey: [...keys.sessions, cursor ?? 'first'],
    queryFn: () => authApi.sessions(cursor),
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
  useGateRedirect(query.error);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sessions = query.data?.data ?? [];
  const total = query.data?.total ?? 0;
  const meta = query.data?.meta;
  const nextCursor = query.data?.page.hasMore ? query.data.page.nextCursor : null;
  const range = pageRange(trail.length, sessions.length, total, SESSIONS_PER_PAGE);
  // Revoking the last row of a later page leaves it empty: step back (state adjusted while rendering).
  if (query.isSuccess && !query.isPlaceholderData && sessions.length === 0 && trail.length > 0) {
    setTrail(trail.slice(0, -1));
  }
  // Relative times are measured from when the list was fetched, so the render stays pure.
  const now = query.dataUpdatedAt;
  // The current device leads the first page, so the others are the total less one.
  const otherCount = Math.max(0, total - 1);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
      setConfirm(null);
    } catch (err) {
      if (redirectOnGateError(err, router.replace, '/account/security')) return;
      if (err instanceof ApiError && err.code === ERROR_CODES.AUTH_SESSION_NOT_FOUND) {
        // Already gone (signed out elsewhere): the refreshed list tells the truth.
        setConfirm(null);
      } else {
        setError(err);
        setConfirm(null);
      }
    } finally {
      await queryClient.invalidateQueries({ queryKey: keys.sessions });
      setBusy(false);
    }
  }

  const revokeOne = (s: SessionItem) =>
    run(async () => {
      await authApi.revokeSession(s.id);
      return t('revoked', { device: s.device });
    });
  const revokeOthers = () =>
    run(async () => {
      const { revoked } = await authApi.revokeOtherSessions();
      return t('revokedOthers', { count: revoked });
    });

  return (
    <Card id="devices" className="scroll-mt-20 space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('subtitle')}
            {meta && (
              <>
                {' '}
                {t('lifetimes', {
                  session: durationLabel(meta.sessionLifetimeSeconds, locale),
                  remembered: durationLabel(meta.rememberLifetimeSeconds, locale),
                })}
                {meta.idleTimeoutMinutes > 0 &&
                  ` ${t('idle', { idle: durationLabel(meta.idleTimeoutMinutes * 60, locale) })}`}
              </>
            )}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || otherCount === 0}
          onClick={() => setConfirm({ kind: 'others' })}
        >
          {t('signOutOthers')}
        </Button>
      </div>

      {notice && <Alert tone="success">{notice}</Alert>}
      <ErrorNote error={error} />

      {query.isPending && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner label={c('loading')} /> {c('loading')}
        </p>
      )}
      {query.isError && (
        <div className="space-y-3">
          <ErrorNote error={query.error} />
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {c('retry')}
          </Button>
        </div>
      )}
      {query.isSuccess && sessions.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      )}

      {sessions.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border">
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="border-b border-border bg-muted text-muted-foreground">
                <tr>
                  <th
                    scope="col"
                    className="px-4 py-2.5 text-start font-mono text-[10px] font-normal uppercase tracking-[0.14em]"
                  >
                    {t('columns.device')}
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2.5 text-start font-mono text-[10px] font-normal uppercase tracking-[0.14em]"
                  >
                    {t('columns.ip')}
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2.5 text-start font-mono text-[10px] font-normal uppercase tracking-[0.14em]"
                  >
                    {t('columns.lastActive')}
                  </th>
                  <th scope="col" className="w-24 px-4 py-2.5">
                    <span className="sr-only">{t('columns.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sessions.map((s) => {
                  const Icon = DEVICE_ICON[s.deviceKind];
                  const last = formatRelative(s.lastUsedAt, now, locale);
                  return (
                    <tr key={s.id} className={s.current ? 'bg-success/5' : undefined}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span
                            aria-hidden="true"
                            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                          >
                            <Icon className="size-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-semibold">{s.device}</p>
                            <p className="flex flex-wrap items-center gap-1.5">
                              {s.current && <Badge tone="success">{t('thisDevice')}</Badge>}
                              {s.remember && <Badge>{t('remembered')}</Badge>}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                        <span dir="ltr">{s.ip ?? t('ipUnknown')}</span>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                        <time
                          dateTime={s.lastUsedAt}
                          title={format.dateTime(new Date(s.lastUsedAt), {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        >
                          {last}
                        </time>
                      </td>
                      <td className="px-4 py-3 text-end">
                        {!s.current && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setConfirm({ kind: 'one', session: s })}
                            className="rounded text-xs font-semibold text-danger hover:underline focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                          >
                            {t('revoke')}
                            <span className="sr-only"> {s.device}</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {(range.pages > 1 || trail.length > 0) && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
              <p className="font-mono" aria-live="polite">
                {t('showing', { from: range.from, to: range.to, total })}
              </p>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={trail.length === 0 || query.isPlaceholderData}
                  onClick={() => setTrail((t) => t.slice(0, -1))}
                >
                  {t('prev')}
                </Button>
                <span className="px-2 font-mono" dir="ltr">
                  {range.page} / {range.pages}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!nextCursor || query.isPlaceholderData}
                  onClick={() => nextCursor && setTrail((t) => [...t, nextCursor])}
                >
                  {t('next')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {confirm && (
        <Modal
          open
          onClose={() => !busy && setConfirm(null)}
          title={confirm.kind === 'one' ? t('confirmOneTitle') : t('confirmOthersTitle')}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirm(null)} disabled={busy}>
                {c('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() =>
                  void (confirm.kind === 'one' ? revokeOne(confirm.session) : revokeOthers())
                }
              >
                {busy && <Spinner label={t('signingOut')} />}
                {confirm.kind === 'one' ? t('revoke') : t('signOutOthers')}
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted-foreground">
            {confirm.kind === 'one'
              ? t('confirmOneBody', { device: confirm.session.device })
              : t('confirmOthersBody', { count: otherCount })}
          </p>
        </Modal>
      )}
    </Card>
  );
}
