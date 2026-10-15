import { describe, expect, it } from 'vitest';
import { CONSENT_EVIDENCE_KEYS, CONSENT_SOURCES, saveConsentNoticeSchema } from '@crm/contracts';
import {
  shopifyCustomer,
  shopifyMarketing,
  wooCustomer,
  wooMarketing,
} from '../../../src/modules/shopify-woocommerce/mirror-rules';

/** The consent notice contract (BL-167) and the store marketing flags it is paired with. */
describe('saveConsentNoticeSchema', () => {
  it('an enabled line needs its wording; a disabled one may keep an empty one', () => {
    expect(saveConsentNoticeSchema.safeParse({ enabled: true, text: '   ' }).success).toBe(false);
    expect(saveConsentNoticeSchema.safeParse({ enabled: false, text: '' }).success).toBe(true);
    const ok = saveConsentNoticeSchema.parse({ enabled: true, text: ' I agree ' });
    expect(ok).toMatchObject({ text: 'I agree', url: null, channels: [] });
  });

  it('the link must be https', () => {
    expect(
      saveConsentNoticeSchema.safeParse({ enabled: false, text: 'x', url: 'http://a.test' })
        .success,
    ).toBe(false);
    expect(
      saveConsentNoticeSchema.safeParse({ enabled: false, text: 'x', url: 'javascript:alert(1)' })
        .success,
    ).toBe(false);
    expect(
      saveConsentNoticeSchema.parse({ enabled: false, text: 'x', url: 'https://a.test/p' }).url,
    ).toBe('https://a.test/p');
  });

  it('the wording is capped and the channels are the three intake channels', () => {
    expect(
      saveConsentNoticeSchema.safeParse({ enabled: false, text: 'x'.repeat(1001) }).success,
    ).toBe(false);
    expect(
      saveConsentNoticeSchema.safeParse({ enabled: false, text: 'x', channels: ['voice'] }).success,
    ).toBe(false);
  });
});

describe('the ledger vocabulary of intake', () => {
  it('knows the sources and the evidence keys the intake paths write', () => {
    for (const s of ['widget', 'booking', 'commerce']) expect(CONSENT_SOURCES).toContain(s);
    for (const k of [
      'noticeVersion',
      'noticeUrl',
      'widgetId',
      'bookingTypeId',
      'integrationId',
      'storeFlag',
    ]) {
      expect(CONSENT_EVIDENCE_KEYS).toContain(k);
    }
  });
});

describe("Shopify's own marketing consent", () => {
  it('reads subscribed email and sms with the time of the choice', () => {
    const m = shopifyMarketing({
      email_marketing_consent: { state: 'subscribed', consent_updated_at: '2026-09-01T10:00:00Z' },
      sms_marketing_consent: { state: 'subscribed', consent_updated_at: '2026-09-02T10:00:00Z' },
    });
    expect(m).toEqual({
      flag: 'email_marketing_consent',
      email: true,
      sms: true,
      at: '2026-09-01T10:00:00.000Z',
    });
  });

  it('sms alone reads as the sms flag', () => {
    expect(shopifyMarketing({ sms_marketing_consent: { state: 'subscribed' } })).toMatchObject({
      flag: 'sms_marketing_consent',
      email: false,
      sms: true,
    });
  });

  it('pending, unsubscribed, not_subscribed and invalid are NOT consent', () => {
    for (const state of ['pending', 'unsubscribed', 'not_subscribed', 'invalid', 'redacted']) {
      expect(shopifyMarketing({ email_marketing_consent: { state } })).toBeUndefined();
    }
    expect(shopifyMarketing({})).toBeUndefined();
  });

  it('the older boolean counts only when the consent object is absent', () => {
    expect(shopifyMarketing({ accepts_marketing: true })).toMatchObject({
      flag: 'accepts_marketing',
      email: true,
    });
    expect(
      shopifyMarketing({
        accepts_marketing: true,
        email_marketing_consent: { state: 'unsubscribed' },
      }),
    ).toBeUndefined();
    expect(shopifyMarketing({ accepts_marketing: false })).toBeUndefined();
  });

  it('is part of the mirrored customer only when the customer said yes', () => {
    const yes = shopifyCustomer({
      id: 1,
      phone: '+91 98100 00011',
      email_marketing_consent: { state: 'subscribed' },
    });
    expect(yes?.marketing?.email).toBe(true);
    const no = shopifyCustomer({ id: 2, phone: '+91 98100 00012' });
    expect(no && 'marketing' in no).toBe(false);
  });
});

describe('WooCommerce marketing consent', () => {
  it('core WooCommerce has none: nothing is inferred', () => {
    expect(wooMarketing({ email: 'a@x.test', billing: { phone: '1' } })).toBeUndefined();
    expect(wooMarketing({ meta_data: [{ key: 'something_else', value: 'yes' }] })).toBeUndefined();
  });

  it("reads a checkout plugin's meta entry, and only a truthy value", () => {
    expect(wooMarketing({ meta_data: [{ key: 'marketing_consent', value: 'yes' }] })).toMatchObject(
      {
        flag: 'meta:marketing_consent',
        email: true,
        sms: false,
      },
    );
    expect(wooMarketing({ meta_data: [{ key: 'accepts_marketing', value: true }] })).toBeDefined();
    expect(wooMarketing({ meta_data: [{ key: 'accepts_marketing', value: '0' }] })).toBeUndefined();
    expect(
      wooMarketing({ meta_data: [{ key: 'accepts_marketing', value: 'no' }] }),
    ).toBeUndefined();
  });

  it('is part of the mirrored customer only when present', () => {
    const c = wooCustomer({
      id: 3,
      billing: { phone: '9876543210', country: 'IN' },
      meta_data: [{ key: 'marketing_consent', value: '1' }],
    });
    expect(c?.marketing?.flag).toBe('meta:marketing_consent');
  });
});
