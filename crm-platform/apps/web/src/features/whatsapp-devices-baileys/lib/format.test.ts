import { describe, expect, it } from 'vitest';
import { formatWhen } from './format';

describe('formatWhen', () => {
  it('is null for no time and for an unreadable one', () => {
    expect(formatWhen(null, 'en')).toBeNull();
    expect(formatWhen('not a date', 'en')).toBeNull();
  });

  it('reads the same instant in the zone it is given', () => {
    const iso = '2026-10-02T20:30:00Z';
    expect(formatWhen(iso, 'en-US', 'Asia/Kolkata')).toBe('Oct 3, 2026, 2:00 AM');
    expect(formatWhen(iso, 'en-US', 'America/New_York')).toBe('Oct 2, 2026, 4:30 PM');
  });
});
