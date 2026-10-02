'use client';

import { useTranslations } from 'next-intl';
import { Fragment } from 'react';
import { MenuItem, MenuSeparator } from '@crm/ui';
import type { Appointment } from '../api/schemas';
import { actionsFor } from '../lib/status';
import { CalendarIcon, CheckIcon, EyeIcon, LinkIcon, UserIcon, XCircleIcon } from './icons';
import { RowMenu } from './row-menu';

export type AppointmentAction =
  'open' | 'confirm' | 'decline' | 'complete' | 'noShow' | 'reschedule' | 'copyLink' | 'cancel';

/** The "..." menu of one booking: open, then only the actions its status allows, then cancel. */
export function AppointmentRowMenu({
  appointment: a,
  now,
  canUpdate,
  onAction,
}: {
  appointment: Appointment;
  now: Date;
  canUpdate: boolean;
  onAction: (action: AppointmentAction, appointment: Appointment) => void;
}) {
  const t = useTranslations('appointments.row');
  const can = actionsFor(a, now);
  return (
    <RowMenu label={t('moreFor', { title: a.title })}>
      {(close) => {
        const run = (action: AppointmentAction) => () => {
          close();
          onAction(action, a);
        };
        return (
          <>
            <MenuItem onSelect={run('open')}>
              <EyeIcon /> {t('open')}
            </MenuItem>
            {canUpdate && can.confirm && (
              <MenuItem onSelect={run('confirm')}>
                <CheckIcon /> {t('confirm')}
              </MenuItem>
            )}
            {canUpdate && can.decline && (
              <MenuItem onSelect={run('decline')}>
                <XCircleIcon /> {t('decline')}
              </MenuItem>
            )}
            {canUpdate && can.complete && (
              <MenuItem onSelect={run('complete')}>
                <CheckIcon /> {t('complete')}
              </MenuItem>
            )}
            {canUpdate && can.noShow && (
              <MenuItem onSelect={run('noShow')}>
                <UserIcon /> {t('noShow')}
              </MenuItem>
            )}
            {canUpdate && can.reschedule && (
              <MenuItem onSelect={run('reschedule')}>
                <CalendarIcon /> {t('reschedule')}
              </MenuItem>
            )}
            {a.manageUrl && (
              <MenuItem onSelect={run('copyLink')}>
                <LinkIcon /> {t('copyLink')}
              </MenuItem>
            )}
            {canUpdate && can.cancel && (
              <Fragment>
                <MenuSeparator />
                <MenuItem danger onSelect={run('cancel')}>
                  <XCircleIcon /> {t('cancel')}
                </MenuItem>
              </Fragment>
            )}
          </>
        );
      }}
    </RowMenu>
  );
}
