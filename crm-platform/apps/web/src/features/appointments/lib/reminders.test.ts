import { describe, expect, it } from 'vitest';
import { deriveReminders } from './reminders';

const NOW = new Date('2026-10-05T12:00:00Z');
const OFFSETS = [
  { offsetMinutes: 180, label: '3h' },
  { offsetMinutes: 1440, label: '24h' },
];

describe('deriveReminders', () => {
  it('lists the furthest first with the moment each goes out', () => {
    const rows = deriveReminders(
      { startsAt: '2026-10-07T09:00:00Z', status: 'confirmed', createdAt: '2026-10-01T00:00:00Z' },
      OFFSETS,
      NOW,
    );
    expect(rows.map((r) => [r.label, r.at, r.state])).toEqual([
      ['24h', '2026-10-06T09:00:00.000Z', 'scheduled'],
      ['3h', '2026-10-07T06:00:00.000Z', 'scheduled'],
    ]);
  });

  it('marks a reminder whose moment has passed as due', () => {
    const rows = deriveReminders(
      { startsAt: '2026-10-06T09:00:00Z', status: 'confirmed', createdAt: '2026-10-01T00:00:00Z' },
      OFFSETS,
      NOW,
    );
    expect(rows.map((r) => r.state)).toEqual(['due', 'scheduled']);
  });

  it('skips what a late booking or a closed booking never sends', () => {
    // Booked at 10:00 on the 5th for 11:00 the same day: both moments are before the booking.
    const late = deriveReminders(
      { startsAt: '2026-10-05T13:00:00Z', status: 'confirmed', createdAt: '2026-10-05T10:00:00Z' },
      OFFSETS,
      NOW,
    );
    expect(late.map((r) => r.state)).toEqual(['skipped', 'skipped']);
    const closed = deriveReminders(
      { startsAt: '2026-10-09T09:00:00Z', status: 'cancelled', createdAt: '2026-10-01T00:00:00Z' },
      OFFSETS,
      NOW,
    );
    expect(closed.every((r) => r.state === 'skipped')).toBe(true);
  });

  it('is empty without offsets', () => {
    expect(
      deriveReminders(
        {
          startsAt: '2026-10-09T09:00:00Z',
          status: 'confirmed',
          createdAt: '2026-10-01T00:00:00Z',
        },
        [],
        NOW,
      ),
    ).toEqual([]);
  });
});
