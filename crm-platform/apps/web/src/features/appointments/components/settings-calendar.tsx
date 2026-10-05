'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Alert, Button, ConfirmDialog, Field, Select, Spinner, useToast } from '@crm/ui';
import { KEYS, useCalendarConnection, useCalendarOptions } from '../api/hooks';
import { appointmentsApi } from '../api/service';
import {
  calendarActions,
  calendarFailure,
  calendarName,
  readOutcome,
  safeConsentUrl,
  withoutOutcome,
  type CalendarOutcome,
} from '../lib/calendar';
import { relativeTime } from '../lib/relative';
import { CalendarIcon, CheckIcon } from './icons';
import { ErrorLine, ToneChip, useAppointmentsCan, useNow } from './parts';
import { SettingsCard } from './settings-parts';

const BENEFITS = ['freeBusy', 'nextSlots', 'writeBack'] as const;
const RETURN_TO = '/appointments/settings';
const TONE = {
  connected: 'success',
  needs_reconnect: 'danger',
  unavailable: 'warning',
  disconnected: 'neutral',
} as const;

/**
 * The workspace's Google Calendar link, as the server reports it, with what an admin can do about it: Connect (Google's consent
 * screen), Choose calendar, Disconnect, and Reconnect when Google stopped honouring the grant. The platform operator supplies the
 * Google client; when there is none the card says so and who adds it. Bookings work without any of this.
 *
 * Google sends the browser back here with `?calendar=<outcome>`; it is shown once and then taken out of the address.
 */
export function CalendarCard() {
  const t = useTranslations('appointments.settings.calendar');
  const locale = useLocale();
  const now = useNow();
  const can = useAppointmentsCan();
  const qc = useQueryClient();
  const { toast } = useToast();
  const query = useCalendarConnection();
  // What Google's callback left in the address, read once (the address is cleaned below, the message stays until dismissed).
  const params = useSearchParams();
  const [outcome, setOutcome] = useState<CalendarOutcome | null>(() =>
    readOutcome(`?${params.toString()}`),
  );
  const [busy, setBusy] = useState<'connect' | 'disconnect' | 'select' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [picked, setPicked] = useState('');

  const calendar = query.data;
  const connected = calendar?.status === 'connected';
  const options = useCalendarOptions(choosing && connected);

  useEffect(() => {
    if (!readOutcome(window.location.search)) return;
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${withoutOutcome(window.location.search)}${window.location.hash}`,
    );
    void qc.invalidateQueries({ queryKey: KEYS.calendar });
  }, [qc]);

  async function connect() {
    setBusy('connect');
    setError(null);
    setOutcome(null);
    try {
      const url = await appointmentsApi.startCalendarConnect(RETURN_TO);
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
      const next = await appointmentsApi.disconnectCalendar();
      qc.setQueryData(KEYS.calendar, next);
      void qc.invalidateQueries({ queryKey: KEYS.calendars });
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
      const next = await appointmentsApi.selectCalendar(picked);
      qc.setQueryData(KEYS.calendar, next);
      setChoosing(false);
      toast(t('calendarSaved'));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  const actions = calendar ? calendarActions(calendar, can.updateTypes) : null;
  const ago = calendar ? relativeTime(calendar.connectedAt, now, locale) : '';
  const name = calendar ? calendarName(calendar) : null;
  const failure = calendarFailure(error);

  return (
    <SettingsCard id="calendar" title={t('title')} description={t('description')}>
      {outcome && (
        <Alert tone={outcome === 'connected' ? 'success' : 'danger'}>
          <p>{t(`outcome.${outcome}`)}</p>
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
        {calendar && (
          <ToneChip tone={TONE[calendar.status]} label={t(`status.${calendar.status}`)} />
        )}
      </div>

      {query.isPending ? (
        <Spinner label={t('loading')} />
      ) : query.isError || !calendar ? (
        <ErrorLine error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {calendar.status === 'unavailable' && (
            <Alert tone="warning">
              <p className="font-medium">{t('unavailableTitle')}</p>
              <p className="mt-0.5 text-xs">{t('unavailableBody')}</p>
            </Alert>
          )}

          {calendar.status === 'disconnected' && (
            <p className="text-sm text-muted-foreground">
              {actions?.connect ? t('disconnectedBody') : t('disconnectedReadOnly')}
            </p>
          )}

          {calendar.status === 'needs_reconnect' && (
            <Alert tone="danger">
              <p className="font-medium">{t('reconnectTitle')}</p>
              <p className="mt-0.5 text-xs">
                {calendar.account
                  ? t('reconnectBodyAccount', { account: calendar.account })
                  : t('reconnectBody')}
              </p>
            </Alert>
          )}

          {connected && (
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">{t('account')}</dt>
                <dd className="break-all" dir="ltr">
                  {calendar.account ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('calendar')}</dt>
                <dd>{name ?? t('primaryCalendar')}</dd>
              </div>
              {ago && (
                <div className="sm:col-span-2 text-xs text-muted-foreground">
                  {t('connectedAgo', { when: ago })}
                </div>
              )}
            </dl>
          )}

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
                <Field label={t('chooseLabel')} htmlFor="calendar-pick" hint={t('chooseHint')}>
                  <Select
                    id="calendar-pick"
                    value={picked}
                    onChange={(e) => setPicked(e.target.value)}
                  >
                    <option value="" disabled>
                      {t('choosePlaceholder')}
                    </option>
                    {options.data.map((c) => (
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
                      setPicked(calendar.calendarId ?? '');
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
