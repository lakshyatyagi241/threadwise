'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Alert, Button, ConfirmDialog, Field, Select, Spinner, useToast } from '@crm/ui';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { KEYS, useCalendarOverview, useOutlookCalendars } from '../api/hooks';
import { calendarsApi } from '../api/calendars-service';
import { calendarActions, calendarName, safeConsentUrl } from '../lib/calendar';
import {
  outlookFailure,
  readOutlookReturn,
  withoutOutlookParams,
  type OutlookOutcome,
} from '../lib/calendars';
import { relativeTime } from '../lib/relative';
import { CalendarIcon, CheckIcon } from './icons';
import { ErrorLine, ToneChip, useAppointmentsCan, useNow } from './parts';
import { SettingsCard } from './settings-parts';

const RETURN_TO = '/appointments/settings';
const TONE = {
  connected: 'success',
  needs_reconnect: 'danger',
  unavailable: 'warning',
  disconnected: 'neutral',
} as const;
const BENEFITS = ['freeBusy', 'writeBack', 'teams'] as const;
const HEALTH = [
  'MICROSOFT_RATE_LIMITED',
  'MICROSOFT_ACCESS_DENIED',
  'MICROSOFT_UNAVAILABLE',
] as const;

/**
 * The workspace's Outlook / Microsoft 365 link (BL-035), as the server reports it, with what an admin can do about it: Connect (Microsoft's consent
 * screen), Choose calendar, Disconnect, Reconnect. The platform operator registers the Microsoft app; when there is none the card says so.
 *
 * Microsoft sends the browser back here with `?outlook=confirm&ticket=...`. The ticket is taken out of the address at once (it is one-time and
 * about a person's account) and kept in memory; nothing is connected until the same signed-in admin presses Confirm, so a forwarded link goes
 * nowhere. Any other `?outlook=<outcome>` is shown once.
 */
export function OutlookCard() {
  const t = useTranslations('appointments.settings.outlook');
  const locale = useLocale();
  const now = useNow();
  const can = useAppointmentsCan();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { org } = useSession();
  const query = useCalendarOverview();
  // What Microsoft's redirect left in the address, read once: the one-time ticket stays in memory, the address is cleaned below.
  const params = useSearchParams();
  const [back] = useState(() => readOutlookReturn(`?${params.toString()}`));
  const [ticket, setTicket] = useState<string | null>(
    back?.kind === 'confirm' ? back.ticket : null,
  );
  const [outcome, setOutcome] = useState<OutlookOutcome | 'cancelled' | null>(
    back?.kind === 'outcome' ? back.outcome : null,
  );
  const [busy, setBusy] = useState<'connect' | 'confirm' | 'disconnect' | 'select' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [picked, setPicked] = useState('');

  const card = query.data?.providers.find((p) => p.provider === 'microsoft');
  const connected = card?.status === 'connected';
  const options = useOutlookCalendars(choosing && connected);

  // Take the ticket and the outcome out of the address, so a reload or a shared link does not carry them along.
  useEffect(() => {
    if (!readOutlookReturn(window.location.search)) return;
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${withoutOutlookParams(window.location.search)}${window.location.hash}`,
    );
    void qc.invalidateQueries({ queryKey: KEYS.overview });
  }, [qc]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KEYS.overview });
    void qc.invalidateQueries({ queryKey: KEYS.calendar });
  };

  async function connect() {
    setBusy('connect');
    setError(null);
    setOutcome(null);
    try {
      const url = await calendarsApi.startOutlookConnect(RETURN_TO);
      const target = safeConsentUrl(url, window.location.origin);
      if (!target) throw new Error('unsafe consent address');
      window.location.assign(target);
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  }

  async function confirm() {
    if (!ticket) return;
    setBusy('confirm');
    setError(null);
    try {
      const done = await calendarsApi.confirmOutlook(ticket);
      setTicket(null);
      setOutcome(done.outcome);
      refresh();
    } catch (e) {
      // A ticket that can no longer be used is not retried: the person starts again.
      if (outlookFailure(e) === 'invalidTicket' || outlookFailure(e) === 'notYours')
        setTicket(null);
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy('disconnect');
    setError(null);
    try {
      await calendarsApi.disconnectOutlook();
      refresh();
      void qc.invalidateQueries({ queryKey: KEYS.outlookCalendars });
      setChoosing(false);
      setConfirmOff(false);
      toast(t('disconnected'));
    } catch (e) {
      setConfirmOff(false);
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  async function choose() {
    if (!picked) return;
    setBusy('select');
    setError(null);
    try {
      await calendarsApi.selectOutlookCalendar(picked);
      refresh();
      setChoosing(false);
      toast(t('calendarSaved'));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  const actions = card ? calendarActions(card, can.updateTypes) : null;
  const ago = card ? relativeTime(card.connectedAt, now, locale) : '';
  const name = card ? calendarName(card) : null;
  const failure = outlookFailure(error);
  const health = HEALTH.find((c) => c === card?.lastErrorCode);

  return (
    <SettingsCard id="outlook" title={t('title')} description={t('description')}>
      {outcome && (
        <Alert
          tone={outcome === 'connected' ? 'success' : outcome === 'cancelled' ? 'info' : 'danger'}
        >
          <p>{t(`outcome.${outcome}`)}</p>
        </Alert>
      )}

      {ticket && (
        <Alert tone="info" className="space-y-3">
          <p className="font-medium">{t('confirm.title')}</p>
          <p className="text-xs">{t('confirm.body', { workspace: org.name })}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="brand"
              size="sm"
              disabled={busy !== null}
              onClick={() => void confirm()}
            >
              {busy === 'confirm' ? t('confirm.working') : t('confirm.confirm')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => {
                setTicket(null);
                setOutcome('cancelled');
              }}
            >
              {t('confirm.cancel')}
            </Button>
          </div>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
        >
          <CalendarIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{t('provider')}</div>
          <div className="text-xs text-muted-foreground">{t('providerSub')}</div>
        </div>
        {card && <ToneChip tone={TONE[card.status]} label={t(`status.${card.status}`)} />}
      </div>

      {query.isPending ? (
        <Spinner label={t('loading')} />
      ) : query.isError || !card ? (
        <ErrorLine error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {card.status === 'unavailable' && (
            <Alert tone="warning">
              <p className="font-medium">{t('unavailableTitle')}</p>
              <p className="mt-0.5 text-xs">{t('unavailableBody')}</p>
            </Alert>
          )}

          {card.status === 'disconnected' && (
            <p className="text-sm text-muted-foreground">
              {actions?.connect ? t('disconnectedBody') : t('disconnectedReadOnly')}
            </p>
          )}

          {card.status === 'needs_reconnect' && (
            <Alert tone="danger">
              <p className="font-medium">{t('reconnectTitle')}</p>
              <p className="mt-0.5 text-xs">
                {card.account
                  ? t('reconnectBodyAccount', { account: card.account })
                  : t('reconnectBody')}
              </p>
            </Alert>
          )}

          {connected && (
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">{t('account')}</dt>
                <dd className="break-all" dir="ltr">
                  {card.account ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('calendar')}</dt>
                <dd>{name ?? t('primaryCalendar')}</dd>
              </div>
              <div className="sm:col-span-2 text-xs text-muted-foreground">
                {card.active ? t('writesHere') : t('readsOnly')}
                {ago ? ` · ${t('connectedAgo', { when: ago })}` : ''}
              </div>
            </dl>
          )}

          {connected && health && <Alert tone="warning">{t(`health.${health}`)}</Alert>}

          {error !== null &&
            (failure ? (
              <Alert tone="danger">{t(`errors.${failure}`)}</Alert>
            ) : (
              <ErrorLine error={error} />
            ))}

          {choosing && connected && (
            <div className="rounded-lg border border-border p-3">
              {options.isPending ? (
                <Spinner label={t('loadingCalendars')} />
              ) : options.isError ? (
                <ErrorLine error={options.error} onRetry={() => void options.refetch()} />
              ) : (
                <Field
                  label={t('chooseLabel')}
                  htmlFor="outlook-calendar-pick"
                  hint={t('chooseHint')}
                >
                  <Select
                    id="outlook-calendar-pick"
                    value={picked}
                    onChange={(e) => setPicked(e.target.value)}
                  >
                    <option value="" disabled>
                      {t('choosePlaceholder')}
                    </option>
                    {options.data.data.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.primary ? t('chooseOptionPrimary', { name: c.name }) : c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="brand"
                  size="sm"
                  disabled={!picked || busy !== null || !options.isSuccess}
                  onClick={() => void choose()}
                >
                  {busy === 'select' ? t('saving') : t('chooseSave')}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setChoosing(false)}>
                  {t('chooseCancel')}
                </Button>
              </div>
            </div>
          )}

          {actions &&
            (actions.connect || actions.reconnect || actions.choose || actions.disconnect) && (
              <div className="flex flex-wrap gap-2">
                {(actions.connect || actions.reconnect) && (
                  <Button variant="brand" disabled={busy !== null} onClick={() => void connect()}>
                    {busy === 'connect'
                      ? t('redirecting')
                      : actions.reconnect
                        ? t('reconnect')
                        : t('connect')}
                  </Button>
                )}
                {actions.choose && !choosing && (
                  <Button
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() => {
                      setPicked(card.calendarId ?? '');
                      setChoosing(true);
                    }}
                  >
                    {t('choose')}
                  </Button>
                )}
                {actions.disconnect && (
                  <Button
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() => setConfirmOff(true)}
                  >
                    {t('disconnect')}
                  </Button>
                )}
              </div>
            )}
        </>
      )}

      <div>
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('whatTitle')}
        </h3>
        <ul className="mt-2 space-y-1.5 text-sm">
          {BENEFITS.map((b) => (
            <li key={b} className="flex items-start gap-2">
              <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
              <span>{t(`what.${b}`)}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-muted-foreground">{t('hint')}</p>

      <ConfirmDialog
        open={confirmOff}
        title={t('confirmOff.title')}
        message={t('confirmOff.message')}
        confirmLabel={t('confirmOff.confirm')}
        cancelLabel={t('confirmOff.cancel')}
        tone="danger"
        busy={busy === 'disconnect'}
        onConfirm={() => void disconnect()}
        onClose={() => setConfirmOff(false)}
      />
    </SettingsCard>
  );
}
