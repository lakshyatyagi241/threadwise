'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, Button, Checkbox, Modal, Spinner } from '@crm/ui';
import type { Appointment } from '../api/schemas';
import { appointmentsApi } from '../api/service';
import { errorKind } from '../lib/errors';
import { formatDayLong, formatTimeRange, zoneName } from '../lib/format';
import type { Slot } from '../lib/slots';
import { safeZone } from '../lib/zone';
import { useErrorText } from './parts';
import { SlotPicker } from './slot-picker';
import { useAppointmentActions } from './use-appointment-actions';

/**
 * Moves a booking to another time of the same booking type (WaDesk's reschedule: the same booking keeps its id and its
 * manage link, the status goes back to confirmed, and the customer is told unless "Tell the customer" is off). The open times
 * are the type's own, so a taken time cannot be picked; if the race is lost anyway the dialog says so and reloads them.
 */
export function RescheduleDialog({
  appointment: a,
  zone: initialZone,
  onClose,
}: {
  appointment: Appointment;
  /** The staff display zone, the picker's first zone. */
  zone: string;
  onClose: () => void;
}) {
  const t = useTranslations('appointments.reschedule');
  const locale = useLocale();
  const qc = useQueryClient();
  const actions = useAppointmentActions();
  const errorText = useErrorText();
  const [zone, setZone] = useState(safeZone(initialZone));
  const [slot, setSlot] = useState<Slot | null>(null);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const typeId = a.bookingType?.id ?? null;

  async function submit() {
    if (!slot) return;
    setBusy(true);
    setProblem(null);
    try {
      await actions.reschedule(a, slot.start, notify);
      onClose();
    } catch (e) {
      setProblem(errorKind(e) === 'slotTaken' ? t('taken') : errorText(e));
      if (errorKind(e) === 'slotTaken') {
        setSlot(null);
        void qc.invalidateQueries({ queryKey: ['appointments', 'picker'] });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      onClose={() => {
        if (!busy) onClose();
      }}
      eyebrow={t('eyebrow')}
      title={a.bookingType?.name ?? a.title}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button variant="brand" onClick={() => void submit()} disabled={!slot || busy}>
            {busy && <Spinner />}
            {t('confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t('current', {
            day: formatDayLong(a.startsAt, locale, zone),
            time: formatTimeRange(a.startsAt, a.endsAt, locale, zone),
            zone: zoneName(a.startsAt, locale, zone),
          })}
        </p>
        {typeId === null ? (
          <Alert tone="warning">{t('noType')}</Alert>
        ) : (
          <SlotPicker
            scope={`staff:${typeId}:${a.id}`}
            load={async (range, signal) =>
              (await appointmentsApi.typeSlots(typeId, range, signal)).slots
            }
            zone={zone}
            onZoneChange={setZone}
            value={slot?.start ?? null}
            onChange={setSlot}
            typeZone={a.timezone}
            disabledStart={a.startsAt}
          />
        )}
        {slot && (
          <p className="rounded-md bg-muted px-3 py-2 text-sm" aria-live="polite">
            {t('newTime', {
              day: formatDayLong(slot.start, locale, zone),
              time: formatTimeRange(slot.start, slot.end, locale, zone),
            })}
          </p>
        )}
        <Checkbox
          id="reschedule-notify"
          checked={notify}
          onChange={(e) => setNotify(e.target.checked)}
          label={t('notify')}
        />
        {problem && <Alert tone="danger">{problem}</Alert>}
      </div>
    </Modal>
  );
}
