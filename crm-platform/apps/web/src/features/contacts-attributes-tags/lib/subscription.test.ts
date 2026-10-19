import { describe, expect, it } from 'vitest';
import { channelOptIn, optInOf, subscriptionRows } from './subscription';

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
