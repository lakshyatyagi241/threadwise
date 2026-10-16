'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, Button, Field, Select, useToast } from '@crm/ui';
import type { CalendarProvider } from '@crm/contracts';
import { KEYS, useCalendarOverview } from '../api/hooks';
import { calendarsApi } from '../api/calendars-service';
import { hasWriteChoice, writeTargetChoices, writeTargetValue } from '../lib/calendars';
import { ErrorLine, useAppointmentsCan } from './parts';
import { SettingsCard } from './settings-parts';

/**
 * Where a booking's event is written, and the back-fill (BL-035). Busy times are read from every connected calendar; each booking is written to one.
 * The choice only means something with two connected calendars, so the card stays out of the way until then. The back-fill row is shown whenever
 * upcoming confirmed bookings are missing from the calendar they go to (made while nothing was connected, or lost with a replaced account); a
 * connect or a change of calendar queues it by itself, and the button is for the impatient or the unlucky.
 */
export function WriteTargetCard() {
  const t = useTranslations('appointments.settings.writeTarget');
  const can = useAppointmentsCan();
  const qc = useQueryClient();
  const { toast } = useToast();
  const query = useCalendarOverview();
  const [busy, setBusy] = useState<'choose' | 'backfill' | null>(null);
  const [error, setError] = useState<unknown>(null);

  const overview = query.data;
  const choice = overview ? hasWriteChoice(overview) : false;
  const pending = overview?.backfillPending ?? 0;
  const anyConnected = overview?.providers.some((p) => p.status === 'connected') ?? false;
  if (!overview || (!choice && pending === 0)) return null;

  async function pick(value: string) {
    setBusy('choose');
    setError(null);
    try {
      const next = await calendarsApi.setWriteProvider(
        value === 'auto' ? null : (value as CalendarProvider),
      );
      qc.setQueryData(KEYS.overview, next);
      toast(t('saved'));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  async function backfill() {
    setBusy('backfill');
    setError(null);
    try {
      const r = await calendarsApi.backfill();
      toast(r.queued ? t('backfill.queued') : t('backfill.notConnected'));
      // The count falls as the worker writes; look again in a few seconds and once more later.
      window.setTimeout(() => void qc.invalidateQueries({ queryKey: KEYS.overview }), 4_000);
      window.setTimeout(() => void qc.invalidateQueries({ queryKey: KEYS.overview }), 20_000);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <SettingsCard id="write-target" title={t('title')} description={t('description')}>
      {choice && (
        <Field label={t('label')} htmlFor="write-target-pick" hint={t('hint')}>
          <Select
            id="write-target-pick"
            value={writeTargetValue(overview)}
            disabled={!can.updateTypes || busy !== null}
            onChange={(e) => void pick(e.target.value)}
          >
            {writeTargetChoices(overview).map((c) => (
              <option key={c.value} value={c.value} disabled={!c.enabled}>
                {c.value === 'auto'
                  ? t('auto')
                  : `${t(`provider.${c.value}`)}${c.enabled ? '' : ` (${t('notConnected')})`}`}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {pending > 0 && (
        <Alert tone="info" className="space-y-2">
          <p>{t('backfill.body', { count: pending })}</p>
          {can.updateTypes && anyConnected && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => void backfill()}
            >
              {busy === 'backfill' ? t('backfill.working') : t('backfill.action')}
            </Button>
          )}
        </Alert>
      )}

      {error !== null && <ErrorLine error={error} />}
    </SettingsCard>
  );
}
