'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, Button, ConfirmDialog } from '@crm/ui';
import type { Appointment } from '../api/schemas';
import { acceptEffect, isOutOfSync } from '../lib/calendar-sync';
import { formatDateTime } from '../lib/format';
import { useAppointmentActions } from './use-appointment-actions';

/**
 * "Calendar out of sync" (TW-GACC-011): the Google event of this booking no longer matches it. The booking itself has NOT been changed; a
 * person with the appointment-update permission picks one of two ways to settle it. Accepting goes through the usual booking rules (a
 * moved event reschedules, a deleted one cancels, the customer is told), so it asks first.
 */
export function CalendarSyncPanel({
  appointment: a,
  zone,
  canUpdate,
}: {
  appointment: Appointment;
  zone: string;
  canUpdate: boolean;
}) {
  const t = useTranslations('appointments.sync');
  const locale = useLocale();
  const actions = useAppointmentActions();
  const [busy, setBusy] = useState<'push' | 'accept' | null>(null);
  const [confirm, setConfirm] = useState(false);
  if (!isOutOfSync(a)) return null;
  const { reason, googleStartsAt, detectedAt } = a.calendarSync;
  const effect = acceptEffect(reason);

  return (
    <Alert tone="warning" aria-label={t('title')}>
      <p className="font-medium">{t('title')}</p>
      <p className="mt-0.5 text-sm">{t(`reason.${reason}`)}</p>
      {reason === 'time_changed' && googleStartsAt && (
        <p className="mt-0.5 text-sm tabular-nums">
          {t('googleShows', { time: formatDateTime(googleStartsAt, locale, zone) })}
        </p>
      )}
      <p className="mt-1 text-xs">{t('notChanged')}</p>
      {detectedAt && (
        <p className="mt-0.5 text-xs">
          {t('found', { when: formatDateTime(detectedAt, locale, zone) })}
        </p>
      )}
      {canUpdate && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null}
            onClick={() => {
              setBusy('push');
              void actions.pushToGoogle(a).finally(() => setBusy(null));
            }}
          >
            {t('push')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null}
            onClick={() => setConfirm(true)}
          >
            {t('accept')}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        tone={effect === 'cancel' ? 'danger' : 'default'}
        busy={busy === 'accept'}
        title={t(`acceptTitle.${effect}`)}
        message={t(`acceptMessage.${effect}`, {
          time: googleStartsAt ? formatDateTime(googleStartsAt, locale, zone) : '',
        })}
        confirmLabel={t(`acceptConfirm.${effect}`)}
        cancelLabel={t('keep')}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setBusy('accept');
          void actions
            .acceptGoogle(a, true)
            .then(() => setConfirm(false))
            .finally(() => setBusy(null));
        }}
      />
    </Alert>
  );
}
