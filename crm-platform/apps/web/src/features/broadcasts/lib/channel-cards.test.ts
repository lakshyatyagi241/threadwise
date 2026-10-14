import { describe, expect, it } from 'vitest';
import { channelCards } from './channel-cards';

const none = { telegram: false, facebook: false, instagram: false, sms: null };

describe('the channel chooser cards', () => {
  it('with only WhatsApp there is one card, the campaign builder', () => {
    expect(channelCards(none)).toEqual([{ id: 'whatsapp', href: '/campaigns/create' }]);
  });

  it('adds a card for every channel the workspace has on, in a fixed order', () => {
    const cards = channelCards({ telegram: true, facebook: true, instagram: true, sms: 'sms:abc' });
    expect(cards.map((c) => c.id)).toEqual([
      'whatsapp',
      'sms',
      'telegram',
      'facebook',
      'instagram',
    ]);
  });

  it('SMS opens the builder on its own sender; the social channels keep their own composers', () => {
    const byId = Object.fromEntries(
      channelCards({ telegram: true, facebook: true, instagram: true, sms: 'sms:abc' }).map((c) => [
        c.id,
        c.href,
      ]),
    );
    expect(byId.sms).toBe('/campaigns/create?sender=sms%3Aabc');
    expect(byId.telegram).toBe('/telegram/broadcasts');
    expect(byId.facebook).toBe('/facebook/broadcasts');
    expect(byId.instagram).toBe('/instagram/broadcast');
  });

  it('a channel that is off has no card', () => {
    expect(channelCards({ ...none, facebook: true }).map((c) => c.id)).toEqual([
      'whatsapp',
      'facebook',
    ]);
  });
});
