'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useToast } from '@crm/ui';
import { invalidateAppointments } from '../api/hooks';
import type { Appointment } from '../api/schemas';
import { appointmentsApi } from '../api/service';
import { errorKind } from '../lib/errors';
import { useErrorText } from './parts';

/**
 * Every write the bookings screens make, with the same behaviour everywhere: the cached lists change at once, the lists and the
 * badges refetch, the person gets a toast, and a 409 says "reload" instead of retrying (the booking moved underneath them).
 * Each action resolves to the booking as the server has it, or null when it failed.
 */
export function useAppointmentActions() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const t = useTranslations('appointments.toast');
  const errorText = useErrorText();

  const failed = (e: unknown) => {
    toast(errorKind(e) === 'conflict' ? t('conflict') : `${t('failed')} ${errorText(e)}`, 'danger');
    void invalidateAppointments(qc);
  };

  async function run(
    fn: () => Promise<Appointment>,
    message: 'confirmed' | 'declined' | 'cancelled' | 'completed' | 'noShow' | 'notesSaved',
  ): Promise<Appointment | null> {
    try {
      const next = await fn();
      void invalidateAppointments(qc, next);
      toast(t(message), 'success');
      return next;
    } catch (e) {
      failed(e);
      return null;
    }
  }

  return {
    confirm: (a: Pick<Appointment, 'id'>) => run(() => appointmentsApi.confirm(a.id), 'confirmed'),
    decline: (a: Pick<Appointment, 'id'>) => run(() => appointmentsApi.decline(a.id), 'declined'),
    cancel: (a: Pick<Appointment, 'id'>) => run(() => appointmentsApi.cancel(a.id), 'cancelled'),
    complete: (a: Pick<Appointment, 'id'>) =>
      run(() => appointmentsApi.complete(a.id), 'completed'),
    noShow: (a: Pick<Appointment, 'id'>) => run(() => appointmentsApi.noShow(a.id), 'noShow'),
    saveNotes: (a: Pick<Appointment, 'id' | 'rowVersion'>, notes: string | null) =>
      run(() => appointmentsApi.saveNotes(a, notes), 'notesSaved'),

    /** A reschedule keeps its error for the dialog (a lost race is shown there, not as a toast). */
    async reschedule(
      a: Pick<Appointment, 'id'>,
      startsAt: string,
      notify: boolean,
    ): Promise<Appointment> {
      const next = await appointmentsApi.reschedule(a.id, startsAt, notify);
      void invalidateAppointments(qc, next);
      toast(t('rescheduled'), 'success');
      return next;
    },

    /** Copies the booking's public manage link. */
    async copyManageLink(a: Pick<Appointment, 'manageUrl'>): Promise<boolean> {
      if (!a.manageUrl) return false;
      try {
        await navigator.clipboard.writeText(a.manageUrl);
        toast(t('linkCopied'), 'success');
        return true;
      } catch {
        toast(t('copyFailed'), 'danger');
        return false;
      }
    },
  };
}
