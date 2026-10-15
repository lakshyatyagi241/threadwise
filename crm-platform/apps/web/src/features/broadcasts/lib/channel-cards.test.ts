import { describe, expect, it } from 'vitest';
import { channelCards } from './channel-cards';

const none = {
  telegram: false,
  facebook: false,
  instagram: false,
  line: false,
  viber: false,
  sms: null,
  email: null,
};

describe('the channel chooser cards', () => {
  it('with only WhatsApp there is one card, the campaign builder', () => {
    expect(channelCards(none)).toEqual([{ id: 'whatsapp', href: '/campaigns/create' }]);
  });

  it('adds a card for every channel the workspace has on, in a fixed order', () => {
    const cards = channelCards({
      telegram: true,
      facebook: true,
      instagram: true,
      viber: true,
      line: true,
      sms: 'sms:abc',
      email: 'email:abc',
    });
    expect(cards.map((c) => c.id)).toEqual([
      'whatsapp',
      'sms',
      'email',
      'telegram',
      'facebook',
      'instagram',
      'line',
      'viber',
    ]);
  });

  it('SMS opens the builder on its own sender; the social channels keep their own composers', () => {
    const byId = Object.fromEntries(
      channelCards({
        telegram: true,
        facebook: true,
        instagram: true,
        viber: true,
        line: true,
        sms: 'sms:abc',
        email: 'email:abc',
      }).map((c) => [c.id, c.href]),
    );
    expect(byId.sms).toBe('/campaigns/create?sender=sms%3Aabc');
    expect(byId.email).toBe('/campaigns/create?sender=email%3Aabc');
    expect(byId.telegram).toBe('/telegram/broadcasts');
    expect(byId.facebook).toBe('/facebook/broadcasts');
    expect(byId.instagram).toBe('/instagram/broadcast');
    expect(byId.viber).toBe('/viber/broadcasts');
    expect(byId.line).toBe('/line/broadcasts');
  });

  it('Email has a card only with a sender, and sits after SMS', () => {
    expect(channelCards({ ...none, email: 'email:abc' }).map((c) => c.id)).toEqual([
      'whatsapp',
      'email',
    ]);
    expect(channelCards({ ...none, sms: 'sms:abc', email: 'email:abc' }).map((c) => c.id)).toEqual([
      'whatsapp',
      'sms',
      'email',
    ]);
  });

  it('a channel that is off has no card', () => {
    expect(channelCards({ ...none, facebook: true }).map((c) => c.id)).toEqual([
      'whatsapp',
      'facebook',
    ]);
  });
});
