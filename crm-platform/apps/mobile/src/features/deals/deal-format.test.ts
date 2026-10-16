import { dueState, formatDay, todayText, whatsappLink } from './deal-format';

const NOON = new Date(2026, 9, 15, 12, 0, 0);

describe('formatDay', () => {
  it('shows the calendar day whatever the time zone of the phone is', () => {
    expect(formatDay('2026-10-31', 'en')).toBe('Oct 31, 2026');
    expect(formatDay('2026-10-31T23:30:00.000Z', 'en')).toBe('Oct 31, 2026');
  });

  it('is empty when there is no date', () => {
    expect(formatDay(null, 'en')).toBe('');
    expect(formatDay(undefined, 'en')).toBe('');
    expect(formatDay('soon', 'en')).toBe('');
  });
});

describe('todayText', () => {
  it('is today on the phone as YYYY-MM-DD', () => {
    expect(todayText(NOON)).toBe('2026-10-15');
    expect(todayText(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('dueState', () => {
  it('says where an expected close day stands against today', () => {
    expect(dueState('2026-10-14', NOON)).toBe('overdue');
    expect(dueState('2026-10-15', NOON)).toBe('today');
    expect(dueState('2026-10-16', NOON)).toBe('upcoming');
  });

  it('has nothing to say without a date', () => {
    expect(dueState(null, NOON)).toBeNull();
    expect(dueState('', NOON)).toBeNull();
  });
});

describe('whatsappLink', () => {
  it('uses the digits alone', () => {
    expect(whatsappLink('+91 98123-45678')).toBe('https://wa.me/919812345678');
  });

  it('has no link without a number', () => {
    expect(whatsappLink(null)).toBeNull();
    expect(whatsappLink('n/a')).toBeNull();
  });
});
