import { z } from 'zod';

/**
 * The 33 gateway slugs (WD-PAYGW-001). The catalogue is code, not data: a gateway is never "installed" by an admin, only
 * configured and activated. Order here is the seeded sort order.
 */
export const PAYGW_GATEWAY_SLUGS = [
  'stripe',
  'paypal',
  'razorpay',
  'paytm',
  'mollie',
  'paystack',
  'flutterwave',
  'square',
  'braintree',
  'twocheckout',
  'coinbase',
  'mercadopago',
  'iyzico',
  'paddle',
  'authorize_net',
  'sslcommerz',
  'instamojo',
  'phonepe',
  'cashfree',
  'payu',
  'midtrans',
  'duitku',
  'xendit',
  'tap',
  'hyperpay',
  'paytr',
  'fondy',
  'skrill',
  'cinetpay',
  'bank_transfer',
  'offline',
  'lemonsqueezy',
  'ligdicash',
] as const;
export type PaygwGatewaySlug = (typeof PAYGW_GATEWAY_SLUGS)[number];

export const paygwModeSchema = z.enum(['sandbox', 'live']);
export type PaygwMode = z.infer<typeof paygwModeSchema>;

/** Region tags the admin screen filters on (WD-PAYGW-002). A gateway can carry several. */
export const PAYGW_REGIONS = [
  'popular',
  'india',
  'asia',
  'mena',
  'europe',
  'us',
  'africa',
  'latam',
  'crypto',
  'offline',
] as const;
export type PaygwRegion = (typeof PAYGW_REGIONS)[number];

export const PAYGW_FIELD_TYPES = ['text', 'password', 'textarea', 'select'] as const;
export type PaygwFieldType = (typeof PAYGW_FIELD_TYPES)[number];
