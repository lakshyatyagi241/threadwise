import type { BusinessHours, SessionResponse } from '@crm/contracts';
import { session as baseSession } from './dashboard-fixtures';

/** Realistic answers of the business-hours endpoints, for tests. */

const weekday = { enabled: true, from: '09:00', to: '18:00' };
const closed = { enabled: false, from: '09:00', to: '18:00' };

export const workweek: BusinessHours = {
  timezone: 'Asia/Kolkata',
  canEditTimezone: false,
  days: {
    mon: weekday,
    tue: weekday,
    wed: weekday,
    thu: weekday,
    fri: weekday,
    sat: closed,
    sun: closed,
  },
  holidays: [{ date: '2026-12-25', label: 'Christmas' }],
};

/** The workspace owner's view: the time zone can be changed too. */
export const ownerWorkweek: BusinessHours = { ...workweek, canEditTimezone: true };

/** A schedule with a lunch break on Monday, set on the web: it must survive a save made here. */
export const withBreak: BusinessHours = {
  ...workweek,
  days: {
    ...workweek.days,
    mon: { ...weekday, to: '13:00', extra: [{ from: '14:00', to: '18:00' }] },
  },
};

const permissions = (...keys: string[]) => ({
  ...baseSession.permissions,
  ...Object.fromEntries(keys.map((k) => [k, 'all' as const])),
});

/** May change the hours. */
export const sessionManagesHours: SessionResponse = {
  ...baseSession,
  permissions: permissions('inbox.settings.read', 'inbox.routing.manage'),
};

/** May see the hours but not change them. */
export const sessionReadsHours: SessionResponse = {
  ...baseSession,
  permissions: permissions('inbox.settings.read'),
};
