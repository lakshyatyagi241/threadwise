import { describe, expect, it } from 'vitest';
import { isKnownTimeZone, wallTimeToUtc } from '../../../src/modules/broadcasts/schedule';

describe('wallTimeToUtc (WD-BCAST-015)', () => {
  it('reads the wall time in the chosen zone, not in UTC', () => {
    // WaDesk fired this at 09:00 UTC; the port fires it at 03:30 UTC, which is 09:00 in Kolkata.
    expect(wallTimeToUtc('2026-10-05', '09:00', 'Asia/Kolkata').toISOString()).toBe(
      '2026-10-05T03:30:00.000Z',
    );
  });

  it('is the identity for UTC', () => {
    expect(wallTimeToUtc('2026-10-05', '09:00', 'UTC').toISOString()).toBe(
      '2026-10-05T09:00:00.000Z',
    );
  });

  it('follows daylight saving', () => {
    expect(wallTimeToUtc('2026-07-01', '12:00', 'America/New_York').toISOString()).toBe(
      '2026-07-01T16:00:00.000Z',
    );
    expect(wallTimeToUtc('2026-12-01', '12:00', 'America/New_York').toISOString()).toBe(
      '2026-12-01T17:00:00.000Z',
    );
  });

  it('handles a zone ahead of UTC across midnight', () => {
    expect(wallTimeToUtc('2026-10-05', '00:30', 'Pacific/Auckland').toISOString()).toBe(
      '2026-10-04T11:30:00.000Z',
    );
  });
});

describe('isKnownTimeZone', () => {
  it('accepts IANA names and rejects junk', () => {
    expect(isKnownTimeZone('Asia/Kolkata')).toBe(true);
    expect(isKnownTimeZone('UTC')).toBe(true);
    expect(isKnownTimeZone('Mars/Olympus')).toBe(false);
  });
});
