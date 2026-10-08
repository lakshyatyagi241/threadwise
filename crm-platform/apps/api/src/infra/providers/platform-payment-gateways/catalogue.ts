import type { PaygwFieldType, PaygwGatewaySlug, PaygwRegion } from '@crm/contracts';

/**
 * The gateway catalogue as code (WD-PAYGW-001/005/006): who they are, which credentials each needs, which currencies the
 * seeded whitelist allows. One schema drives the admin form, the credential merge whitelist, the activation guard and the
 * webhook-secret rule, so a new field needs no other change. Whitelists are starting values the operator can edit.
 */
export interface CredentialField {
  key: string;
  label: string;
  type: PaygwFieldType;
  required?: boolean;
  hint?: string;
  options?: string[];
  /** A value here authenticates provider notifications: when the gateway declares any, webhooks fail closed until one is set. */
  webhook?: boolean;
}

export interface GatewayMeta {
  slug: PaygwGatewaySlug;
  name: string;
  description: string;
  regions: PaygwRegion[];
  fields: CredentialField[];
  currencies: string[];
  sortOrder: number;
}

const t = (key: string, label: string, required = false, hint?: string): CredentialField => ({
  key,
  label,
  type: 'text',
  required,
  hint,
});
const p = (key: string, label: string, required = false, hint?: string): CredentialField => ({
  key,
  label,
  type: 'password',
  required,
  hint,
});
const w = (key: string, label: string, hint?: string): CredentialField => ({
  key,
  label,
  type: 'password',
  hint,
  webhook: true,
});
const a = (key: string, label: string, required = false, hint?: string): CredentialField => ({
  key,
  label,
  type: 'textarea',
  required,
  hint,
});

const split = (s: string): string[] => s.split(' ');
const CUR = {
  stripe: split(
    'USD EUR GBP JPY CAD AUD CHF INR BRL MXN SGD HKD NOK SEK DKK PLN CZK RON HUF NZD MYR THB PHP IDR TRY ZAR KES NGN AED SAR EGP ILS KRW TWD CNY',
  ),
  paypal: split(
    'USD EUR GBP CAD AUD JPY CHF SEK NOK DKK PLN CZK HUF NZD SGD HKD ILS MXN BRL PHP TWD THB MYR RUB TRY INR',
  ),
  braintree: split('USD EUR GBP CAD AUD JPY CHF SEK NOK DKK PLN CZK HUF NZD SGD HKD MXN THB'),
  twocheckout: split(
    'USD EUR GBP CAD AUD JPY CHF SEK NOK DKK PLN CZK HUF NZD SGD HKD INR BRL MXN TRY ZAR RON AED',
  ),
  paddle: split(
    'USD EUR GBP CAD AUD JPY CHF SEK NOK DKK PLN CZK HUF NZD SGD HKD TWD KRW CNY THB ZAR ARS BRL MXN TRY UAH',
  ),
  skrill: split('USD EUR GBP CAD AUD CHF SEK NOK DKK PLN CZK HUF RON BGN TRY'),
};

type Raw = Omit<GatewayMeta, 'sortOrder'>;

const RAW: Raw[] = [
  {
    slug: 'stripe',
    name: 'Stripe',
    description: 'Global cards + Apple Pay + Google Pay across 46+ countries.',
    regions: ['popular', 'europe', 'us'],
    currencies: CUR.stripe,
    fields: [
      t('publishable_key', 'Publishable key'),
      p('secret_key', 'Secret key', true),
      w(
        'webhook_secret',
        'Webhook signing secret',
        'The whsec_ value; the Stripe-Signature header is checked against it.',
      ),
    ],
  },
  {
    slug: 'paypal',
    name: 'PayPal',
    description: 'Worldwide PayPal balance + cards via PayPal Checkout.',
    regions: ['popular', 'us'],
    currencies: CUR.paypal,
    fields: [
      t('client_id', 'Client ID', true),
      p('client_secret', 'Client secret', true),
      w(
        'webhook_id',
        'Webhook ID',
        'The id of the webhook created in the PayPal dashboard; notifications are verified with it.',
      ),
    ],
  },
  {
    slug: 'razorpay',
    name: 'Razorpay',
    description: 'India — cards, UPI, netbanking, wallets, EMI.',
    regions: ['popular', 'india'],
    currencies: ['INR'],
    fields: [
      t('key_id', 'Key ID', true),
      p('key_secret', 'Key secret', true),
      w('webhook_secret', 'Webhook secret', 'Verifies the X-Razorpay-Signature header.'),
    ],
  },
  {
    slug: 'paytm',
    name: 'Paytm',
    description: 'India — Paytm wallet, UPI, cards, netbanking.',
    regions: ['india', 'asia'],
    currencies: ['INR'],
    fields: [
      t('merchant_id', 'Merchant ID', true),
      p('merchant_key', 'Merchant key', true),
      t('website', 'Website', true),
    ],
  },
  {
    slug: 'mollie',
    name: 'Mollie',
    description: 'European cards, iDEAL, Bancontact, SEPA, Klarna.',
    regions: ['popular', 'europe'],
    currencies: split('EUR USD GBP CHF SEK NOK DKK PLN CZK HUF RON'),
    fields: [p('api_key', 'API key', true, 'Starts with live_ or test_.')],
  },
  {
    slug: 'paystack',
    name: 'Paystack',
    description: 'Nigeria/Ghana/South Africa — cards, bank, USSD, mobile money.',
    regions: ['africa'],
    currencies: split('NGN GHS ZAR USD KES'),
    fields: [t('public_key', 'Public key', true), p('secret_key', 'Secret key', true)],
  },
  {
    slug: 'flutterwave',
    name: 'Flutterwave',
    description: 'Africa-wide — cards, mobile money, USSD, bank transfer.',
    regions: ['africa'],
    currencies: split('NGN USD KES EUR GBP GHS ZAR TZS UGX RWF XOF XAF'),
    fields: [
      t('public_key', 'Public key', true),
      p('secret_key', 'Secret key', true),
      p('encryption_key', 'Encryption key'),
      w('secret_hash', 'Secret hash', 'The verif-hash value set in the Flutterwave dashboard.'),
    ],
  },
  {
    slug: 'square',
    name: 'Square',
    description: 'US/CA/UK/AU/JP cards via Square Online Checkout.',
    regions: ['popular', 'us'],
    currencies: split('USD CAD GBP AUD JPY EUR'),
    fields: [
      t('application_id', 'Application ID', true),
      p('access_token', 'Access token', true),
      t('location_id', 'Location ID', true),
      w('webhook_signature_key', 'Webhook signature key'),
    ],
  },
  {
    slug: 'braintree',
    name: 'Braintree',
    description: 'PayPal-owned: cards, PayPal, Venmo, Apple Pay, Google Pay.',
    regions: ['popular', 'us'],
    currencies: CUR.braintree,
    fields: [
      t('merchant_id', 'Merchant ID', true),
      t('public_key', 'Public key', true),
      p('private_key', 'Private key', true),
      t('plan_id', 'Plan ID', false, 'Enables auto-renew.'),
    ],
  },
  {
    slug: 'twocheckout',
    name: '2Checkout (Verifone)',
    description: '200+ countries — global cards + local payment methods.',
    regions: ['us'],
    currencies: CUR.twocheckout,
    fields: [
      t('merchant_code', 'Merchant code', true),
      p('secret_key', 'Secret key', true),
      p('buy_link_secret', 'Buy-link secret', true),
    ],
  },
  {
    slug: 'coinbase',
    name: 'Coinbase Commerce',
    description: 'Crypto — BTC, ETH, USDC, DAI, LTC, BCH.',
    regions: ['crypto'],
    currencies: split('USD EUR GBP BTC ETH USDC'),
    fields: [p('api_key', 'API key', true), w('webhook_secret', 'Webhook shared secret')],
  },
  {
    slug: 'mercadopago',
    name: 'Mercado Pago',
    description: 'Latin America — cards, Pix, OXXO, Boleto, wallet.',
    regions: ['latam'],
    currencies: split('BRL ARS MXN CLP COP PEN UYU'),
    fields: [
      p('access_token', 'Access token', true),
      t('public_key', 'Public key', true),
      w('webhook_secret', 'Webhook secret'),
    ],
  },
  {
    slug: 'iyzico',
    name: 'iyzico',
    description: 'Turkey — cards with 3D Secure + installments.',
    regions: ['mena', 'europe'],
    currencies: split('TRY USD EUR GBP'),
    fields: [t('api_key', 'API key', true), p('secret_key', 'Secret key', true)],
  },
  {
    slug: 'paddle',
    name: 'Paddle',
    description: 'Merchant of record for SaaS — cards + global tax handling.',
    regions: ['popular', 'europe'],
    currencies: CUR.paddle,
    fields: [
      p('api_key', 'API key', true),
      t('product_id', 'Product ID', true),
      t('client_token', 'Client token'),
      w('webhook_secret', 'Webhook secret'),
    ],
  },
  {
    slug: 'authorize_net',
    name: 'Authorize.Net',
    description: 'US/CA cards via Accept Hosted payment page.',
    regions: ['popular', 'us'],
    currencies: split('USD CAD EUR GBP AUD'),
    fields: [
      t('api_login_id', 'API login ID', true),
      p('transaction_key', 'Transaction key', true),
      w('signature_key', 'Signature key'),
    ],
  },
  {
    slug: 'sslcommerz',
    name: 'SSLCommerz',
    description: 'Bangladesh — cards, bKash, Nagad, Rocket.',
    regions: ['asia'],
    currencies: ['BDT'],
    fields: [t('store_id', 'Store ID', true), p('store_password', 'Store password', true)],
  },
  {
    slug: 'instamojo',
    name: 'Instamojo',
    description: 'India — cards, UPI, netbanking, wallets via payment links.',
    regions: ['india'],
    currencies: ['INR'],
    fields: [
      t('api_key', 'API key', true),
      p('auth_token', 'Auth token', true),
      w('salt', 'Salt', 'Signs webhook notifications.'),
    ],
  },
  {
    slug: 'phonepe',
    name: 'PhonePe',
    description: 'India — UPI, cards, wallets via PhonePe Business.',
    regions: ['india', 'asia'],
    currencies: ['INR'],
    fields: [
      t('client_id', 'Client ID'),
      p('client_secret', 'Client secret'),
      t('client_version', 'Client version'),
      t('merchant_id', 'Merchant ID'),
      p('salt_key', 'Salt key'),
      t('salt_index', 'Salt index'),
    ],
  },
  {
    slug: 'cashfree',
    name: 'Cashfree',
    description: 'India — UPI, cards, netbanking, wallets, BNPL.',
    regions: ['india'],
    currencies: ['INR'],
    fields: [t('app_id', 'App ID', true), p('secret_key', 'Secret key', true)],
  },
  {
    slug: 'payu',
    name: 'PayU',
    description: 'India / LatAm — cards, UPI, netbanking, wallets.',
    regions: ['india'],
    currencies: ['INR'],
    fields: [t('merchant_key', 'Merchant key', true), p('merchant_salt', 'Merchant salt', true)],
  },
  {
    slug: 'midtrans',
    name: 'Midtrans',
    description: 'Indonesia — cards, GoPay, OVO, ShopeePay, bank transfer.',
    regions: ['asia'],
    currencies: ['IDR'],
    fields: [p('server_key', 'Server key', true), t('client_key', 'Client key', true)],
  },
  {
    slug: 'duitku',
    name: 'Duitku',
    description: 'Indonesia — VA banks, QRIS, OVO, DANA, ShopeePay, retail (Alfamart/Indomaret), cards.',
    regions: ['asia'],
    currencies: ['IDR'],
    fields: [t('merchant_code', 'Merchant code', true), p('api_key', 'API key', true)],
  },
  {
    slug: 'xendit',
    name: 'Xendit',
    description: 'SE Asia — cards, e-wallets, virtual accounts, OTC retail.',
    regions: ['asia'],
    currencies: split('IDR PHP USD VND MYR THB'),
    fields: [
      p('secret_key', 'Secret key', true),
      t('public_key', 'Public key', true),
      w('webhook_token', 'Webhook token'),
    ],
  },
  {
    slug: 'tap',
    name: 'Tap Payments',
    description: 'Middle East — KNET, mada, Benefit, cards in AED/SAR/KWD.',
    regions: ['asia', 'mena'],
    currencies: split('KWD SAR AED BHD QAR OMR JOD EGP USD EUR GBP'),
    fields: [p('secret_key', 'Secret key', true), t('publishable_key', 'Publishable key', true)],
  },
  {
    slug: 'hyperpay',
    name: 'HyperPay',
    description: 'Middle East / Africa — cards (mada, Visa/MC/Amex) + STC Pay.',
    regions: ['asia', 'mena'],
    currencies: split('SAR AED USD EUR GBP BHD KWD QAR OMR JOD EGP'),
    fields: [p('access_token', 'Access token', true), t('entity_id', 'Entity ID', true)],
  },
  {
    slug: 'paytr',
    name: 'PayTR',
    description: 'Turkey — cards with installments via secure iframe.',
    regions: ['mena', 'europe'],
    currencies: split('TRY USD EUR GBP'),
    fields: [
      t('merchant_id', 'Merchant ID', true),
      p('merchant_key', 'Merchant key', true),
      p('merchant_salt', 'Merchant salt', true),
    ],
  },
  {
    slug: 'fondy',
    name: 'Fondy',
    description: 'Eastern Europe — cards, Apple Pay, Google Pay, SEPA.',
    regions: ['mena', 'europe'],
    currencies: split('EUR USD GBP UAH PLN CZK RON HUF RUB'),
    fields: [t('merchant_id', 'Merchant ID', true), p('payment_key', 'Payment key', true)],
  },
  {
    slug: 'skrill',
    name: 'Skrill',
    description: 'Skrill wallet + 100+ local methods worldwide.',
    regions: [],
    currencies: CUR.skrill,
    fields: [t('merchant_id', 'Merchant email', true), p('secret_word', 'Secret word', true)],
  },
  {
    slug: 'cinetpay',
    name: 'CinetPay',
    description: 'Francophone West Africa — Orange Money, MTN, Moov, cards.',
    regions: ['africa'],
    currencies: split('XOF XAF CDF GNF USD'),
    fields: [
      t('api_key', 'API key', true),
      t('site_id', 'Site ID', true),
      w('secret_key', 'Secret key', 'Used to verify notifications.'),
    ],
  },
  {
    slug: 'bank_transfer',
    name: 'Bank Transfer',
    description: 'Show your bank details; mark order paid manually.',
    regions: ['offline'],
    currencies: [],
    fields: [
      t('beneficiary_name', 'Beneficiary name', true),
      t('bank_name', 'Bank name', true),
      t('account_number', 'Account number', true),
      t('ifsc_or_swift', 'IFSC or SWIFT', true),
      t('branch', 'Branch'),
      a('notes', 'Notes shown to the buyer'),
    ],
  },
  {
    slug: 'offline',
    name: 'Offline / Cash',
    description: 'For enterprise quotes paid out-of-band.',
    regions: ['offline'],
    currencies: [],
    fields: [a('instructions', 'Instructions shown to the buyer', true)],
  },
  {
    slug: 'lemonsqueezy',
    name: 'Lemon Squeezy',
    description: 'Merchant of record for SaaS — hosted checkout, cards, global tax + subscriptions.',
    regions: ['popular'],
    currencies: [],
    fields: [
      p('api_key', 'API key', true),
      t('store_id', 'Store ID', true),
      t('variant_id', 'Variant ID', true),
      w('signing_secret', 'Signing secret'),
    ],
  },
  {
    slug: 'ligdicash',
    name: 'LigdiCash',
    description: 'Burkina Faso / West Africa (XOF) — Orange Money, Moov Money, cards.',
    regions: [],
    currencies: [],
    fields: [
      t('api_key', 'API key', true),
      p('api_token', 'API token', true),
      t('store_name', 'Store name'),
    ],
  },
];

/** WaDesk's seeded sort orders (tap and hyperpay no longer share a slot). */
const SORT: Record<string, number> = {
  stripe: 1,
  paypal: 2,
  razorpay: 3,
  paytm: 4,
  mollie: 5,
  paystack: 6,
  flutterwave: 7,
  square: 8,
  braintree: 9,
  twocheckout: 10,
  coinbase: 11,
  mercadopago: 12,
  iyzico: 13,
  paddle: 14,
  authorize_net: 15,
  sslcommerz: 16,
  instamojo: 17,
  phonepe: 18,
  cashfree: 19,
  payu: 20,
  midtrans: 21,
  duitku: 22,
  xendit: 23,
  tap: 24,
  hyperpay: 25,
  paytr: 26,
  fondy: 27,
  skrill: 28,
  cinetpay: 29,
  bank_transfer: 30,
  offline: 31,
  lemonsqueezy: 32,
  ligdicash: 33,
};

export const GATEWAY_CATALOGUE: readonly GatewayMeta[] = RAW.map((g) => ({
  ...g,
  sortOrder: SORT[g.slug] ?? 99,
}));

const BY_SLUG = new Map<string, GatewayMeta>(GATEWAY_CATALOGUE.map((g) => [g.slug, g]));
export const gatewayMeta = (slug: string): GatewayMeta | undefined => BY_SLUG.get(slug);
export const credentialFieldsFor = (slug: string): readonly CredentialField[] =>
  BY_SLUG.get(slug)?.fields ?? [];
export const webhookFieldKeys = (slug: string): string[] =>
  credentialFieldsFor(slug)
    .filter((f) => f.webhook)
    .map((f) => f.key);
