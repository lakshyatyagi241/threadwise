'use client';

import { ERROR_CODES, type SessionItem } from '@crm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  const query = useQuery({ queryKey: keys.sessions, queryFn: authApi.sessions, staleTime: 0 });
  useGateRedirect(query.error);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sessions = query.data?.data ?? [];
  // Relative times are measured from when the list was fetched, so the render stays pure.
  const now = query.dataUpdatedAt;
  const others = sessions.filter((s) => !s.current);

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
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || others.length === 0}
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
        <ul className="divide-y divide-border rounded-md border border-border">
          {sessions.map((s) => {
            const Icon = DEVICE_ICON[s.deviceKind];
            const last = formatRelative(s.lastUsedAt, now, locale);
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-3 p-3">
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                >
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1 basis-48">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="truncate">{s.device}</span>
                    {s.current && <Badge tone="success">{t('thisDevice')}</Badge>}
                    {s.remember && <Badge>{t('remembered')}</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span dir="ltr">{s.ip ?? t('ipUnknown')}</span>
                    <span aria-hidden="true"> · </span>
                    <time
                      dateTime={s.lastUsedAt}
                      title={format.dateTime(new Date(s.lastUsedAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    >
                      {t('lastActive', { when: last })}
                    </time>
                  </p>
                </div>
                {!s.current && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setConfirm({ kind: 'one', session: s })}
                  >
                    {t('signOut')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
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
                {confirm.kind === 'one' ? t('signOut') : t('signOutOthers')}
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted-foreground">
            {confirm.kind === 'one'
              ? t('confirmOneBody', { device: confirm.session.device })
              : t('confirmOthersBody', { count: others.length })}
          </p>
        </Modal>
      )}
    </Card>
  );
}
