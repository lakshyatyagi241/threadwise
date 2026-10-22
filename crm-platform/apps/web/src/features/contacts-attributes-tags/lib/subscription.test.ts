import { describe, expect, it } from 'vitest';
import { channelOptIn, channelOptInWithLedger, optInOf, subscriptionRows } from './subscription';

const contact = (over: Partial<Parameters<typeof channelOptIn>[0]> = {}) => ({
  whatsappSubscriptionStatus: null,
  smsSubscriptionStatus: null,
  emailSubscriptionStatus: null,
  isUnsubscribed: false,
  ...over,
});

describe('opt-in', () => {
  it('is yes only for a "subscribed" label of a contact who has not opted out', () => {
    expect(optInOf('subscribed', false)).toBe('yes');
    expect(optInOf(' Subscribed ', false)).toBe('yes');
    expect(optInOf('unsubscribed', false)).toBe('no');
    expect(optInOf(null, false)).toBe('no');
    expect(optInOf('', false)).toBe('no');
  });

  it('lets the marketing opt-out beat any label', () => {
    expect(optInOf('subscribed', true)).toBe('out');
    expect(optInOf(null, true)).toBe('out');
  });

  it('reads each channel from its own label', () => {
    const c = contact({ whatsappSubscriptionStatus: 'subscribed', smsSubscriptionStatus: 'x' });
    expect(channelOptIn(c, 'whatsapp')).toBe('yes');
    expect(channelOptIn(c, 'sms')).toBe('no');
    expect(channelOptIn(c, 'email')).toBe('no');
  });

  it('lists WhatsApp, email and SMS in the card order', () => {
    expect(subscriptionRows(contact()).map((r) => r.channel)).toEqual(['whatsapp', 'email', 'sms']);
    expect(
      subscriptionRows(contact({ isUnsubscribed: true })).every((r) => r.optIn === 'out'),
    ).toBe(true);
  });
});

describe('opt-in with the consent ledger', () => {
  const granted = [{ channel: 'whatsapp', purpose: 'marketing', state: 'granted' }];
  const withdrawn = [{ channel: 'whatsapp', purpose: 'marketing', state: 'withdrawn' }];

  it('reads Yes for a recorded grant even when the label does not say subscribed', () => {
    const c = contact({ whatsappSubscriptionStatus: 'unsubscribed' });
    expect(channelOptIn(c, 'whatsapp')).toBe('no');
    expect(channelOptInWithLedger(c, 'whatsapp', granted)).toBe('yes');
    expect(channelOptInWithLedger(c, 'whatsapp', [])).toBe('no');
  });

  it('reads No (opted out) for a withdrawal even when the label says subscribed', () => {
    const c = contact({ whatsappSubscriptionStatus: 'subscribed' });
    expect(channelOptInWithLedger(c, 'whatsapp', withdrawn)).toBe('out');
  });

  it('only looks at the channel and the marketing purpose it is asked about', () => {
    const c = contact();
    expect(channelOptInWithLedger(c, 'email', granted)).toBe('no');
    const utility = [{ channel: 'whatsapp', purpose: 'utility', state: 'granted' }];
    expect(channelOptInWithLedger(c, 'whatsapp', utility)).toBe('no');
  });

  it('falls back to the label with no ledger, and lets the contact opt-out beat both', () => {
    const labelled = contact({ whatsappSubscriptionStatus: 'subscribed' });
    expect(channelOptInWithLedger(labelled, 'whatsapp', undefined)).toBe('yes');
    expect(channelOptInWithLedger(contact({ isUnsubscribed: true }), 'whatsapp', granted)).toBe(
      'out',
    );
  });

  it('feeds the card rows', () => {
    const rows = subscriptionRows(contact(), granted);
    expect(rows.find((r) => r.channel === 'whatsapp')?.optIn).toBe('yes');
    expect(rows.find((r) => r.channel === 'email')?.optIn).toBe('no');
  });
});
