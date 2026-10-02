import { describe, expect, it } from 'vitest';
import { APPOINTMENT_STATUSES } from '../api/schemas';
import { actionsFor, isOpen, STATUS_TONE, visitorCan } from './status';

const NOW = new Date('2026-10-05T12:00:00Z');
const FUTURE = '2026-10-06T09:00:00Z';
const PAST = '2026-10-05T09:00:00Z';

describe('what can be done to an appointment', () => {
  it('lets a pending booking be confirmed, declined, cancelled or moved', () => {
    expect(actionsFor({ status: 'pending', startsAt: FUTURE }, NOW)).toEqual({
      confirm: true,
      decline: true,
      complete: false,
      noShow: false,
      cancel: true,
      reschedule: true,
    });
  });

  it('lets a confirmed booking be completed, and marked no-show only once it has started', () => {
    expect(actionsFor({ status: 'confirmed', startsAt: FUTURE }, NOW)).toEqual({
      confirm: false,
      decline: false,
      complete: true,
      noShow: false,
      cancel: true,
      reschedule: true,
    });
    expect(actionsFor({ status: 'confirmed', startsAt: PAST }, NOW).noShow).toBe(true);
  });

  it('offers nothing on a booking that is over', () => {
    for (const status of ['cancelled', 'declined', 'completed', 'no_show'] as const) {
      expect(Object.values(actionsFor({ status, startsAt: PAST }, NOW)).some(Boolean), status).toBe(
        false,
      );
    }
  });

  it('knows which statuses are open', () => {
    expect(APPOINTMENT_STATUSES.filter(isOpen)).toEqual(['pending', 'confirmed']);
  });

  it('gives every status a tone', () => {
    for (const s of APPOINTMENT_STATUSES) expect(STATUS_TONE[s]).toBeTruthy();
  });
});

describe('what a visitor can do from the manage link', () => {
  it('can move or cancel an open booking that has not started', () => {
    expect(visitorCan({ status: 'confirmed', startsAt: FUTURE }, NOW)).toEqual({
      reschedule: true,
      cancel: true,
    });
    expect(visitorCan({ status: 'pending', startsAt: FUTURE }, NOW)).toEqual({
      reschedule: true,
      cancel: true,
    });
  });

  it('cannot once it has started or is closed', () => {
    expect(visitorCan({ status: 'confirmed', startsAt: PAST }, NOW)).toEqual({
      reschedule: false,
      cancel: false,
    });
    expect(visitorCan({ status: 'cancelled', startsAt: FUTURE }, NOW)).toEqual({
      reschedule: false,
      cancel: false,
    });
    expect(visitorCan({ status: 'completed', startsAt: FUTURE }, NOW)).toEqual({
      reschedule: false,
      cancel: false,
    });
    expect(visitorCan({ status: 'declined', startsAt: FUTURE }, NOW)).toEqual({
      reschedule: false,
      cancel: false,
    });
  });
});
