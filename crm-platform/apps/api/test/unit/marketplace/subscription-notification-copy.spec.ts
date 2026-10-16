import { describe, expect, it } from 'vitest';
import {
  plainDate,
  reminderCopy,
  type ReminderFacts,
} from '../../../src/modules/marketplace/subscription-notification-copy';

const facts = (over: Partial<ReminderFacts> = {}): ReminderFacts => ({
  name: 'Quote Pro',
  date: '2026-11-13T10:00:00.000Z',
  autoRenew: false,
  canceling: false,
  graceEnds: null,
  ...over,
});

describe('the wording of the paid-app notices', () => {
  it('formats a date in English, in UTC, and tolerates nothing', () => {
    expect(plainDate('2026-11-13T23:59:00.000Z')).toBe('13 Nov 2026');
    expect(plainDate(null)).toBeNull();
    expect(plainDate('not a date')).toBeNull();
  });

  it('says what will really happen: the card renews it, a prepaid month ends, a cancelled app ends', () => {
    const auto = reminderCopy('renewal_due', facts({ autoRenew: true }));
    expect(auto).toMatchObject({ type: 'marketplace_renewal_due' });
    expect(auto.title).toBe('Quote Pro renews on 13 Nov 2026');
    expect(auto.body).toContain('charged automatically');
    const manual = reminderCopy('renewal_due', facts());
    expect(manual.title).toBe('Quote Pro is paid until 13 Nov 2026');
    expect(manual.body).toContain('does not renew by itself');
    expect(manual.body).not.toContain('charged');
    const ending = reminderCopy('renewal_due', facts({ canceling: true, autoRenew: true }));
    expect(ending.title).toBe('Quote Pro ends on 13 Nov 2026');
    expect(ending.body).toContain('You cancelled');
  });

  it('a failed payment says how long the app keeps working; the end says the data is kept', () => {
    const failed = reminderCopy('payment_failed', facts({ graceEnds: '2026-11-20T00:00:00.000Z' }));
    expect(failed.type).toBe('marketplace_payment_failed');
    expect(failed.body).toContain('until 20 Nov 2026');
    expect(reminderCopy('payment_failed', facts({ date: null })).body).not.toContain('until');
    const ended = reminderCopy('ended', facts());
    expect(ended.type).toBe('marketplace_subscription_ended');
    expect(ended.body).toContain('data and settings are kept');
  });

  it('copes with a missing date', () => {
    expect(reminderCopy('renewal_due', facts({ date: null, autoRenew: true })).title).toBe(
      'Quote Pro renews on the end of the period',
    );
  });
});
