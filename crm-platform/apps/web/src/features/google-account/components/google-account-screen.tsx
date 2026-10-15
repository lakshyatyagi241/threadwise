'use client';

import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  GOOGLE_CAPABILITIES,
  type GoogleAccountResponse,
  type GoogleCapability,
} from '@crm/contracts';
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Spinner, cn, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import {
  KEYS,
  googleAccountApi,
  useGoogleAccount,
  useGoogleCalendars,
} from '../api/google-account';
import {
  actions,
  calendarName,
  defaultTicks,
  failureOf,
  lastErrorKey,
  readOutcome,
  relativeTime,
  safeConsentUrl,
  viewState,
  wanted,
  withoutOutcome,
  type Outcome,
} from '../lib/model';

const CARD = 'rounded-2xl border border-border bg-background p-4 shadow-sm sm:p-5';
const RETURN_TO = '/google-account';
const TONE = {
  connected: 'success',
  needs_reconnect: 'danger',
  unavailable: 'warning',
  disconnected: 'neutral',
} as const;

/**
 * `/google-account` (TW-GACC-001 to 006): the workspace's one Google account, shared by the booking calendar and the Google steps of
 * the flow builder. An admin ticks what Google may be used for and presses Connect (or Add permissions later: Google then asks only for
 * the new ones and the account keeps what it had); Reconnect restores a grant Google stopped honouring; Disconnect withdraws it.
 *
 * Google sends the browser back here with `?calendar=<outcome>`; it is shown once and then taken out of the address.
 */
export function GoogleAccountScreen() {
  const t = useTranslations('google-account.page');
  const canRead = useCan('google.account.read');
  const canManage = useCan('google.account.manage');
  const q = useGoogleAccount(canRead);
  const view = viewState({
    canRead,
    isPending: q.isPending,
    isError: q.isError,
    data: q.data,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      {view === 'noPermission' && (
        <Alert tone="danger">
          <p className="font-semibold">{t('forbidden.title')}</p>
          <p>{t('forbidden.body')}</p>
        </Alert>
      )}
      {view === 'loading' && (
        <div className={cn(CARD, 'flex justify-center p-10')}>
          <Spinner label={t('loading')} />
        </div>
      )}
      {view === 'error' && (
        <Alert tone="danger">
          <p>{q.error instanceof ApiError ? q.error.message : t('failure.generic')}</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => void q.refetch()}>
            {t('actions.retry')}
          </Button>
        </Alert>
      )}
      {view === 'ready' && q.data && <Body account={q.data} canManage={canManage} />}
    </div>
  );
}

function Body({ account, canManage }: { account: GoogleAccountResponse; canManage: boolean }) {
  const t = useTranslations('google-account.page');
  const locale = useLocale();
  const qc = useQueryClient();
  const { toast } = useToast();
  const params = useSearchParams();
  const [outcome, setOutcome] = useState<Outcome | null>(() =>
    readOutcome(`?${params.toString()}`),
  );
  const [ticked, setTicked] = useState<GoogleCapability[]>(() => defaultTicks(account));
  const [busy, setBusy] = useState<'connect' | 'disconnect' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [now] = useState(() => new Date());

  const can = actions(account.status, canManage);
  const connected = account.status === 'connected';
  const granted = account.capabilities.filter((c) => c.granted).length;
  const hasCalendar =
    connected && account.capabilities.some((c) => c.key === 'calendar' && c.granted);
  const calendars = useGoogleCalendars(hasCalendar);

  useEffect(() => {
    if (!readOutcome(window.location.search)) return;
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${withoutOutcome(window.location.search)}${window.location.hash}`,
    );
    void qc.invalidateQueries({ queryKey: KEYS.account });
  }, [qc]);

  const toggle = (key: GoogleCapability, on: boolean) =>
    setTicked((cur) => (on ? [...cur, key] : cur.filter((k) => k !== key)));

  const asked = wanted(account, ticked);
  // A first connection or an added permission needs something ticked; a reconnect restores what the account held and needs nothing more.
  const canPress = asked.length > 0;

  async function press() {
    setBusy('connect');
    setError(null);
    setOutcome(null);
    try {
      const { url } = await googleAccountApi.connect(asked, RETURN_TO);
      const target = safeConsentUrl(url, window.location.origin);
      if (!target) throw new Error('unsafe consent address');
      window.location.assign(target);
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy('disconnect');
    setError(null);
    try {
      const next = await googleAccountApi.disconnect();
      qc.setQueryData(KEYS.account, next);
      void qc.invalidateQueries({ queryKey: KEYS.calendars });
      setConfirmOff(false);
      toast(t('disconnected'));
    } catch (e) {
      setConfirmOff(false);
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  const ago = relativeTime(account.connectedAt, now, locale);
  const lastUsed = relativeTime(account.lastUsedAt, now, locale);
  const name = calendarName(account);
  const primaryAction = can.connect
    ? 'connect'
    : can.reconnect
      ? 'reconnect'
      : can.add
        ? 'addPermissions'
        : null;
  const failure = error ? failureOf(error) : null;

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('eyebrow')}
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={TONE[account.status]}>{t(`status.${account.status}`)}</Badge>
          {can.disconnect && (
            <Button
              variant="secondary"
              onClick={() => setConfirmOff(true)}
              disabled={busy !== null}
            >
              {t('actions.disconnect')}
            </Button>
          )}
        </div>
      </header>

      {outcome && (
        <Alert
          tone={outcome === 'connected' ? 'success' : outcome === 'cancelled' ? 'info' : 'danger'}
        >
          <p>{t(`outcome.${outcome}`)}</p>
        </Alert>
      )}
      {failure && (
        <Alert tone="danger">
          <p>{failure === 'notConfigured' ? t('failure.notConfigured') : t('failure.generic')}</p>
        </Alert>
      )}
      {account.status === 'unavailable' && (
        <Alert tone="warning">
          <p className="font-medium">{t('unavailable.title')}</p>
          <p className="mt-0.5 text-xs">{t('unavailable.body')}</p>
        </Alert>
      )}
      {account.status === 'needs_reconnect' && (
        <Alert tone="danger">
          <p className="font-medium">{t('reconnect.title')}</p>
          <p className="mt-0.5 text-xs">
            {account.account
              ? t('reconnect.bodyAccount', { account: account.account })
              : t('reconnect.body')}
          </p>
        </Alert>
      )}
      {account.lastError && account.status === 'connected' && (
        <Alert tone="warning">
          <p className="font-medium">{t('lastError.title')}</p>
          <p className="mt-0.5 text-xs">{t(`lastError.${lastErrorKey(account.lastError.code)}`)}</p>
          <p className="mt-0.5 text-xs opacity-80">
            {relativeTime(account.lastError.at, now, locale)}
          </p>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('stats.status')} value={connected ? t('stats.live') : t('stats.idle')} />
        <Stat
          label={t('stats.calendars')}
          value={
            calendars.data
              ? t('stats.calendarsValue', { count: calendars.data.data.length })
              : t('stats.calendarsNone')
          }
        />
        <Stat
          label={t('stats.permissions')}
          value={t('stats.permissionsValue', { granted, total: GOOGLE_CAPABILITIES.length })}
        />
        <Stat label={t('stats.lastUsed')} value={lastUsed || t('stats.never')} />
      </div>

      <section className={CARD} aria-labelledby="ga-account">
        <h2 id="ga-account" className="text-base font-semibold">
          {t('account.title')}
        </h2>
        {account.account ? (
          <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">{t('account.email')}</dt>
              <dd className="break-all" dir="ltr">
                {account.account}
              </dd>
            </div>
            {hasCalendar && (
              <div>
                <dt className="text-xs text-muted-foreground">{t('account.calendar')}</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <span>{name ?? t('account.primaryCalendar')}</span>
                  <Link
                    href="/appointments/settings"
                    className="text-xs text-primary underline-offset-2 hover:underline"
                  >
                    {t('account.changeCalendar')}
                  </Link>
                </dd>
              </div>
            )}
            {ago && (
              <div className="text-xs text-muted-foreground sm:col-span-2">
                {t('account.connectedAgo', { when: ago })}
              </div>
            )}
          </dl>
        ) : (
          <div className="mt-2 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{t('account.none')}</p>
            <p>{t('account.noneBody')}</p>
          </div>
        )}
      </section>

      <section className={CARD} aria-labelledby="ga-permissions">
        <h2 id="ga-permissions" className="text-base font-semibold">
          {t('permissions.title')}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{t('permissions.intro')}</p>
        <ul className="mt-3 divide-y divide-border">
          {account.capabilities.map((c) => (
            <li key={c.key} className="flex flex-wrap items-start gap-3 py-3">
              <div className="min-w-0 flex-1 basis-64">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{t(`permissions.${c.key}.name`)}</span>
                  {c.restricted && <Badge tone="warning">{t('permissions.restricted')}</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{t(`permissions.${c.key}.body`)}</p>
                <p className="text-xs text-muted-foreground">
                  {t('usedBy.title')}: {t(`permissions.${c.key}.usedBy`)}
                </p>
                {c.restricted && !c.granted && (
                  <p className="mt-1 text-xs text-warning">{t('permissions.restrictedNote')}</p>
                )}
              </div>
              <div className="shrink-0">
                {c.granted ? (
                  <Badge tone="success">{t('permissions.allowed')}</Badge>
                ) : can.connect || can.add || can.reconnect ? (
                  <Checkbox
                    id={`ga-cap-${c.key}`}
                    label={t('permissions.allow')}
                    aria-label={`${t('permissions.allow')}: ${t(`permissions.${c.key}.name`)}`}
                    checked={ticked.includes(c.key)}
                    onChange={(e) => toggle(c.key, e.target.checked)}
                  />
                ) : (
                  <Badge tone="neutral">{t('permissions.notAllowed')}</Badge>
                )}
              </div>
            </li>
          ))}
        </ul>
        {primaryAction && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button onClick={() => void press()} disabled={busy !== null || !canPress}>
              {busy === 'connect' ? t('actions.working') : t(`actions.${primaryAction}`)}
            </Button>
            {!canPress && (
              <span className="text-xs text-muted-foreground">
                {t('permissions.nothingTicked')}
              </span>
            )}
          </div>
        )}
      </section>

      <section className={CARD} aria-labelledby="ga-used">
        <h2 id="ga-used" className="text-base font-semibold">
          {t('usedBy.title')}
        </h2>
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {(['book', 'meet', 'sheets', 'docs', 'forms'] as const).map((k) => (
            <li key={k}>
              <Link
                href="/flows"
                className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-muted"
              >
                <span>{t(`usedBy.${k}`)}</span>
                <span className="text-xs text-muted-foreground">{t('usedBy.flow')}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <Alert tone="info">
        <p className="font-medium">{t('privacy.title')}</p>
        <p className="text-xs">{t('privacy.body')}</p>
      </Alert>

      {can.disconnect && (
        <ConfirmDialog
          open={confirmOff}
          title={t('disconnectConfirm.title')}
          message={t('disconnectConfirm.body')}
          confirmLabel={t('disconnectConfirm.confirm')}
          cancelLabel={t('disconnectConfirm.cancel')}
          tone="danger"
          busy={busy === 'disconnect'}
          onConfirm={() => void disconnect()}
          onClose={() => setConfirmOff(false)}
        />
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold leading-tight">{value}</div>
    </div>
  );
}
