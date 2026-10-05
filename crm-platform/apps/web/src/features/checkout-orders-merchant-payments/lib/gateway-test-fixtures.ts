import type {
  StoreGateway,
  StoreGatewayDriver,
  StorePaymentRecord,
  WhatsappPayConfig,
} from '@crm/contracts';

/** Test data of the gateway and payments screens (unit and render tests only). */

export const WORKSPACE_ROW_ID = '11111111-1111-4111-8111-111111111111';
export const SHOP_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const SHOP_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export const razorpayDriver: StoreGatewayDriver = {
  slug: 'razorpay',
  name: 'Razorpay',
  description: 'Cards, UPI, netbanking and wallets in India.',
  regions: ['IN'],
  currencies: ['INR'],
  available: true,
  supportsPaymentLinks: true,
  fields: [
    {
      key: 'key_id',
      label: 'Key ID',
      type: 'text',
      required: true,
      hint: 'Starts with rzp_',
      options: null,
      webhook: false,
    },
    {
      key: 'key_secret',
      label: 'Key secret',
      type: 'password',
      required: true,
      hint: null,
      options: null,
      webhook: false,
    },
    {
      key: 'webhook_secret',
      label: 'Webhook secret',
      type: 'password',
      required: false,
      hint: 'Set the same value in the Razorpay dashboard.',
      options: null,
      webhook: true,
    },
  ],
};

export const stripeDriver: StoreGatewayDriver = {
  slug: 'stripe',
  name: 'Stripe',
  description: 'Cards and wallets worldwide.',
  regions: ['US', 'GB'],
  currencies: ['USD', 'GBP'],
  available: true,
  supportsPaymentLinks: true,
  fields: [
    {
      key: 'secret_key',
      label: 'Secret key',
      type: 'password',
      required: true,
      hint: null,
      options: null,
      webhook: false,
    },
    {
      key: 'region',
      label: 'Region',
      type: 'select',
      required: false,
      hint: null,
      options: ['us', 'eu'],
      webhook: false,
    },
  ],
};

export const comingDriver: StoreGatewayDriver = {
  slug: 'paystack',
  name: 'Paystack',
  description: 'Africa.',
  regions: ['NG'],
  currencies: ['NGN'],
  available: false,
  supportsPaymentLinks: false,
  fields: [],
};

export function savedGateway(over: Partial<StoreGateway> = {}): StoreGateway {
  return {
    id: WORKSPACE_ROW_ID,
    slug: 'razorpay',
    name: 'Razorpay',
    scope: 'workspace',
    storefrontId: null,
    storefrontName: null,
    mode: 'test',
    active: true,
    isDefault: true,
    configured: true,
    credentials: [
      { key: 'key_id', hasValue: true, masked: '••••••••cdef' },
      { key: 'key_secret', hasValue: true, masked: '••••••••9z9z' },
      { key: 'webhook_secret', hasValue: false, masked: null },
    ],
    webhookSecretMissing: true,
    webhookUrl: 'https://api.example.test/v2/store-public/webhooks/gateway/11111111',
    migratedFromStorefront: false,
    sortOrder: 0,
    rowVersion: 3,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
    ...over,
  };
}

export function payment(over: Partial<StorePaymentRecord> = {}): StorePaymentRecord {
  return {
    orderId: '22222222-2222-4222-8222-222222222222',
    orderNo: 1042,
    customerName: 'Asha Rao',
    customerPhone: '919800000001',
    status: 'paid',
    method: 'prepaid',
    paidVia: 'razorpay_link',
    reference: 'pay_QX12345',
    waPaymentStatus: null,
    paymentLink: null,
    amountMinor: 250000,
    currencyCode: 'INR',
    storefrontName: 'Main shop',
    createdAt: '2026-10-02T09:00:00.000Z',
    updatedAt: '2026-10-02T09:30:00.000Z',
    ...over,
  };
}

export function waPayConfig(over: Partial<WhatsappPayConfig> = {}): WhatsappPayConfig {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    configName: 'my-razorpay-pay',
    paymentType: 'razorpay',
    country: 'IN',
    currency: 'INR',
    isActive: true,
    autoCharge: false,
    rowVersion: 1,
    updatedAt: '2026-10-02T10:00:00.000Z',
    ...over,
  };
}
