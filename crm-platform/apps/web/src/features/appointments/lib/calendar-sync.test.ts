import { describe, expect, it } from 'vitest';
import { acceptEffect, isOutOfSync } from './calendar-sync';

const sync = (over: object = {}) => ({
  state: 'drifted' as const,
  reason: 'time_changed' as const,
  detectedAt: '2027-01-01T00:00:00.000Z',
  googleStartsAt: null,
  googleEndsAt: null,
  checkedAt: null,
  ...over,
});

describe('the Calendar out of sync badge', () => {
  it('shows only for a confirmed booking that the reconcile found different', () => {
    expect(isOutOfSync({ status: 'confirmed', calendarSync: sync() })).toBe(true);
    expect(
      isOutOfSync({ status: 'confirmed', calendarSync: sync({ state: 'in_sync', reason: null }) }),
    ).toBe(false);
    expect(isOutOfSync({ status: 'confirmed', calendarSync: null })).toBe(false);
    expect(isOutOfSync({ status: 'confirmed' })).toBe(false);
  });

  it('never shows for a booking that is over or turned down', () => {
    for (const status of ['cancelled', 'declined', 'completed', 'no_show', 'pending'] as const) {
      expect(isOutOfSync({ status, calendarSync: sync() })).toBe(false);
    }
  });

  it('says what accepting will do for each reason', () => {
    expect(acceptEffect('event_deleted')).toBe('cancel');
    expect(acceptEffect('event_missing')).toBe('cancel');
    expect(acceptEffect('time_changed')).toBe('reschedule');
    expect(acceptEffect('attendees_changed')).toBe('acknowledge');
  });
});
