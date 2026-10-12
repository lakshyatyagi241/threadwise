import { i18n } from '@/lib/i18n';
import { formatClock, formatConversationTime } from './time';

const t = i18n.t.bind(i18n);
// Local-time dates, so the test says the same in every time zone.
const at = (y: number, month: number, d: number, h = 12, min = 0) =>
  new Date(y, month - 1, d, h, min).toISOString();
const now = new Date(2026, 9, 12, 18, 0);

describe('formatConversationTime', () => {
  it('shows the clock for a message from today', () => {
    expect(formatConversationTime(at(2026, 10, 12, 14, 5), now, t)).toBe('2:05 PM');
    expect(formatConversationTime(at(2026, 10, 12, 9, 30), now, t)).toBe('9:30 AM');
  });

  it('reads midnight and noon as 12', () => {
    expect(formatClock(at(2026, 10, 12, 0, 7), t)).toBe('12:07 AM');
    expect(formatClock(at(2026, 10, 12, 12, 0), t)).toBe('12:00 PM');
  });

  it('says Yesterday for the day before, even across a month end', () => {
    expect(formatConversationTime(at(2026, 10, 11, 23, 59), now, t)).toBe('Yesterday');
    const firstOfMonth = new Date(2026, 10, 1, 8, 0);
    expect(formatConversationTime(at(2026, 10, 31, 20, 0), firstOfMonth, t)).toBe('Yesterday');
  });

  it('shows day/month/year for anything older', () => {
    expect(formatConversationTime(at(2026, 10, 9, 10, 0), now, t)).toBe('09/10/26');
    expect(formatConversationTime(at(2025, 1, 2, 10, 0), now, t)).toBe('02/01/25');
  });

  it('shows nothing for a thread with no message or an unreadable time', () => {
    expect(formatConversationTime(null, now, t)).toBe('');
    expect(formatConversationTime('not a date', now, t)).toBe('');
  });
});
