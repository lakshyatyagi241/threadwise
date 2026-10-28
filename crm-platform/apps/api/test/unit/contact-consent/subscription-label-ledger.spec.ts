import { describe, expect, it } from 'vitest';
import { shownSubscriptionLabel } from '../../../src/modules/contact-consent/consent-intake.rules';
import { toContactResponse } from '../../../src/modules/crm/contacts/contacts.mapper';
import type { ContactRow } from '../../../src/modules/crm/contacts/contacts.repository';

/**
 * A legacy contact (set before the consent ledger existed) can carry the label `subscribed` with no marketing grant in the ledger. The
 * migration never invents consent. With "Require recorded consent" on, the send gate refuses marketing to such a contact, so the label
 * must not read `subscribed`. With it off, the gate allows the contact, so the stored label stays.
 */
const row = (over: Partial<ContactRow>): ContactRow =>
  ({
    uuid: '00000000-0000-4000-8000-000000000001',
    displayId: 'CON-1',
    name: 'Legacy Contact',
    phone: null,
    whatsappSubscriptionStatus: null,
    smsSubscriptionStatus: null,
    emailSubscriptionStatus: null,
    isUnsubscribed: false,
    whatsappMarketingGranted: false,
    whatsappRequiresConsent: true,
    rowVersion: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  }) as unknown as ContactRow;

describe('WhatsApp label matches what the send gate allows', () => {
  it('with the switch on, a legacy label of Yes and no ledger grant reads as no label', () => {
    const res = toContactResponse(
      row({
        whatsappSubscriptionStatus: 'subscribed',
        whatsappMarketingGranted: false,
        whatsappRequiresConsent: true,
      }),
    );
    expect(res.whatsappSubscriptionStatus).toBeNull();
  });

  it('with the switch off, the stored label stays, because the gate allows the contact', () => {
    const res = toContactResponse(
      row({
        whatsappSubscriptionStatus: 'subscribed',
        whatsappMarketingGranted: false,
        whatsappRequiresConsent: false,
      }),
    );
    expect(res.whatsappSubscriptionStatus).toBe('subscribed');
  });

  it('a recorded marketing grant reads subscribed, even when the stored label is empty', () => {
    const res = toContactResponse(
      row({
        whatsappSubscriptionStatus: null,
        whatsappMarketingGranted: true,
        whatsappRequiresConsent: true,
      }),
    );
    expect(res.whatsappSubscriptionStatus).toBe('subscribed');
  });

  it('a label that is not subscribed is shown as stored when the switch is on', () => {
    const res = toContactResponse(
      row({
        whatsappSubscriptionStatus: 'unsubscribed',
        whatsappMarketingGranted: false,
        whatsappRequiresConsent: true,
      }),
    );
    expect(res.whatsappSubscriptionStatus).toBe('unsubscribed');
  });

  it('the rule ignores case and spaces in the label', () => {
    expect(shownSubscriptionLabel('  Subscribed ', false, true)).toBeNull();
    expect(shownSubscriptionLabel('SUBSCRIBED', false, true)).toBeNull();
    expect(shownSubscriptionLabel('  Subscribed ', false, false)).toBe('  Subscribed ');
    expect(shownSubscriptionLabel(null, false, true)).toBeNull();
    expect(shownSubscriptionLabel(null, true, true)).toBe('subscribed');
  });

  it('a grant reads subscribed with the switch off too, so the card and the list agree', () => {
    expect(shownSubscriptionLabel(null, true, false)).toBe('subscribed');
  });

  it('a row missing the consent fields fails loudly instead of showing a wrong label', () => {
    const partial = { ...row({}), whatsappRequiresConsent: undefined } as unknown as ContactRow;
    expect(() => toContactResponse(partial)).toThrow('missing the WhatsApp consent fields');
  });
});
