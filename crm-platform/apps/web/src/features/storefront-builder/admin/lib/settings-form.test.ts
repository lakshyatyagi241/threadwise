import { describe, expect, it } from 'vitest';
import { updateStorefrontSchema, type StorefrontResponse } from '@crm/contracts';
import {
  cnameHost,
  fromShop,
  isRazorpayApi,
  pickerColor,
  toInput,
  validate,
} from './settings-form';

const SHOP: StorefrontResponse = {
  id: '11111111-1111-4111-8111-111111111111',
  shopName: 'Acme',
  slug: 'acme',
  customDomain: 'shop.acme.com',
  customDomainVerified: false,
  themeKey: 'aurora',
  enabled: true,
  currencyCode: 'USD',
  deviceId: null,
  settings: {
    logoUrl: null,
    brandColor: null,
    heroText: null,
    footerText: 'Thanks',
    cartRecoveryEnabled: false,
    cartRecoveryDelayMin: 30,
    cartRecoveryMessage: null,
  },
  shipping: { flat: '49.50', freeAbove: '999.00', note: null },
  paymentProvider: 'razorpay_api',
  paymentHandle: null,
  razorpay: { keyId: 'rzp_test_1', hasKeySecret: true, hasWebhookSecret: true },
  publicUrl: 'https://app.test/s/acme',
  cnameTarget: 'app.test',
  sendingLabel: '+1 555',
  hasUsableConnection: true,
  rowVersion: 3,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
};

describe('fromShop', () => {
  it('fills the WaDesk defaults for empty settings', () => {
    const f = fromShop(SHOP);
    expect(f.brandColor).toBe('#075E54');
    expect(f.heroText).toBe('');
    expect(f.cartRecoveryDelayMin).toBe('30');
    expect(f.shippingFlat).toBe('49.50');
  });
  it('never carries a stored secret into the form', () => {
    const f = fromShop(SHOP);
    expect(f.rzpKeySecret).toBe('');
    expect(f.rzpWebhookSecret).toBe('');
    expect(f.rzpKeyId).toBe('rzp_test_1');
  });
});

describe('validate', () => {
  const base = fromShop(SHOP);
  it('accepts the starting values', () => {
    expect(validate(base)).toEqual({});
  });
  it('checks the slug', () => {
    expect(validate({ ...base, slug: '' }).slug?.key).toBe('required');
    expect(validate({ ...base, slug: 'My Shop' }).slug?.key).toBe('slugPattern');
    expect(validate({ ...base, slug: 'a'.repeat(65) }).slug?.key).toBe('tooLong');
  });
  it('checks domain, logo and colour', () => {
    expect(validate({ ...base, customDomain: 'https://x.com' }).customDomain?.key).toBe(
      'domainInvalid',
    );
    expect(validate({ ...base, customDomain: 'Shop.Example.com' }).customDomain?.key).toBe(
      'domainInvalid',
    );
    expect(validate({ ...base, customDomain: '' }).customDomain).toBeUndefined();
    expect(validate({ ...base, logoUrl: 'nope' }).logoUrl?.key).toBe('urlInvalid');
    expect(validate({ ...base, brandColor: 'red' }).brandColor?.key).toBe('colorInvalid');
    expect(validate({ ...base, brandColor: '#12ab9' }).brandColor?.key).toBe('colorInvalid');
    expect(validate({ ...base, brandColor: '#12ab9F' }).brandColor).toBeUndefined();
  });
  it('checks text lengths', () => {
    expect(validate({ ...base, heroText: 'x'.repeat(281) }).heroText?.key).toBe('tooLong');
    expect(validate({ ...base, shippingNote: 'x'.repeat(161) }).shippingNote?.key).toBe('tooLong');
  });
  it('checks currency and shipping amounts', () => {
    expect(validate({ ...base, currencyCode: 'JPY' }).currencyCode?.key).toBe('currencyInvalid');
    expect(validate({ ...base, shippingFlat: '-1' }).shippingFlat?.key).toBe('amountInvalid');
    expect(validate({ ...base, shippingFlat: '1000001' }).shippingFlat?.key).toBe('amountTooBig');
    expect(validate({ ...base, shippingFlat: '', shippingFreeAbove: '' })).toEqual({});
  });
  it('checks the abandoned-cart delay (5..1440)', () => {
    expect(validate({ ...base, cartRecoveryDelayMin: '4' }).cartRecoveryDelayMin?.key).toBe(
      'delayRange',
    );
    expect(validate({ ...base, cartRecoveryDelayMin: '1441' }).cartRecoveryDelayMin?.key).toBe(
      'delayRange',
    );
    expect(validate({ ...base, cartRecoveryDelayMin: '5.5' }).cartRecoveryDelayMin?.key).toBe(
      'delayRange',
    );
    expect(
      validate({ ...base, cartRecoveryDelayMin: '1440' }).cartRecoveryDelayMin,
    ).toBeUndefined();
  });
});

describe('toInput', () => {
  it('produces a body the shared contract accepts', () => {
    const body = toInput(fromShop(SHOP), SHOP.rowVersion);
    const parsed = updateStorefrontSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(body.rowVersion).toBe(3);
  });
  it('sends blanks as null so they are cleared', () => {
    const body = toInput(
      { ...fromShop(SHOP), logoUrl: '', heroText: '  ', shippingFlat: '', customDomain: '' },
      1,
    );
    expect(body.logoUrl).toBeNull();
    expect(body.heroText).toBeNull();
    expect(body.shippingFlat).toBeNull();
    expect(body.customDomain).toBeNull();
  });
  it('leaves blank secrets out (keep) and sends typed ones', () => {
    const keep = toInput(fromShop(SHOP), 1);
    expect('rzpKeySecret' in keep).toBe(false);
    expect('rzpWebhookSecret' in keep).toBe(false);
    const typed = toInput({ ...fromShop(SHOP), rzpKeySecret: 's3cret', rzpWebhookSecret: 'wh' }, 1);
    expect(typed.rzpKeySecret).toBe('s3cret');
    expect(typed.rzpWebhookSecret).toBe('wh');
  });
  it('turns the delay into a number and the provider "none" into null', () => {
    const body = toInput({ ...fromShop(SHOP), cartRecoveryDelayMin: '45', paymentProvider: '' }, 1);
    expect(body.cartRecoveryDelayMin).toBe(45);
    expect(body.paymentProvider).toBeNull();
  });
});

describe('small helpers', () => {
  it('knows the Razorpay API provider', () => {
    expect(isRazorpayApi('razorpay_api')).toBe(true);
    expect(isRazorpayApi('razorpay_link')).toBe(false);
  });
  it('derives the CNAME host and the picker colour', () => {
    expect(cnameHost('shop.acme.com')).toBe('shop');
    expect(pickerColor('#ABCDEF')).toBe('#abcdef');
    expect(pickerColor('#abc')).toBeNull();
  });
});
