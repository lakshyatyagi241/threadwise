import {
  PAYMENT_PROVIDERS,
  PRODUCT_CURRENCIES,
  STORE_BRAND_DEFAULT,
  STORE_SLUG_MAX,
  STORE_THEME_KEYS,
  type PaymentProvider,
  type ProductCurrency,
  type StoreTheme,
  type StorefrontResponse,
  type UpdateStorefrontInput,
} from '@crm/contracts';

/** The settings form as the person sees it: every field is text or a flag; `toInput` turns it into the API shape. */
export interface SettingsForm {
  slug: string;
  themeKey: string;
  enabled: boolean;
  customDomain: string;
  logoUrl: string;
  brandColor: string;
  heroText: string;
  footerText: string;
  currencyCode: string;
  shippingFlat: string;
  shippingFreeAbove: string;
  shippingNote: string;
  paymentProvider: string;
  paymentHandle: string;
  rzpKeyId: string;
  /** Write-only: blank keeps the stored secret. */
  rzpKeySecret: string;
  rzpWebhookSecret: string;
  cartRecoveryEnabled: boolean;
  cartRecoveryDelayMin: string;
  cartRecoveryMessage: string;
}

export type SettingsField = keyof SettingsForm;

export const DEFAULT_RECOVERY_DELAY = 30;
export const DEFAULT_CURRENCY = 'INR';
export const MAX_AMOUNT = 1_000_000;
export const LIMITS = {
  logoUrl: 1024,
  heroText: 280,
  footerText: 280,
  shippingNote: 160,
  paymentHandle: 255,
  cartRecoveryMessage: 1024,
  customDomain: 191,
  rzp: 191,
} as const;

/** The form's starting values for a shop (the same defaults the WaDesk page used). */
export function fromShop(shop: StorefrontResponse): SettingsForm {
  const s = shop.settings;
  return {
    slug: shop.slug,
    themeKey: shop.themeKey,
    enabled: shop.enabled,
    customDomain: shop.customDomain ?? '',
    logoUrl: s.logoUrl ?? '',
    brandColor: s.brandColor ?? STORE_BRAND_DEFAULT,
    heroText: s.heroText ?? '',
    footerText: s.footerText ?? '',
    currencyCode: shop.currencyCode || DEFAULT_CURRENCY,
    shippingFlat: shop.shipping.flat ?? '',
    shippingFreeAbove: shop.shipping.freeAbove ?? '',
    shippingNote: shop.shipping.note ?? '',
    paymentProvider: shop.paymentProvider ?? '',
    paymentHandle: shop.paymentHandle ?? '',
    rzpKeyId: shop.razorpay.keyId ?? '',
    rzpKeySecret: '',
    rzpWebhookSecret: '',
    cartRecoveryEnabled: s.cartRecoveryEnabled,
    cartRecoveryDelayMin: String(s.cartRecoveryDelayMin || DEFAULT_RECOVERY_DELAY),
    cartRecoveryMessage: s.cartRecoveryMessage ?? '',
  };
}

export interface Problem {
  key:
    | 'required'
    | 'tooLong'
    | 'slugPattern'
    | 'domainInvalid'
    | 'urlInvalid'
    | 'colorInvalid'
    | 'amountInvalid'
    | 'amountTooBig'
    | 'delayRange'
    | 'themeInvalid'
    | 'currencyInvalid'
    | 'providerInvalid';
  values?: Record<string, number>;
}

const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const SLUG_RE = /^[a-z0-9-]+$/;
const AMOUNT_RE = /^\d+(\.\d+)?$/;

const tooLong = (max: number): Problem => ({ key: 'tooLong', values: { max } });

function isUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Client-side checks that mirror the API's rules, so most mistakes are caught before the request. */
export function validate(form: SettingsForm): Partial<Record<SettingsField, Problem>> {
  const out: Partial<Record<SettingsField, Problem>> = {};
  const slug = form.slug.trim();
  if (slug === '') out.slug = { key: 'required' };
  else if (slug.length > STORE_SLUG_MAX) out.slug = tooLong(STORE_SLUG_MAX);
  else if (!SLUG_RE.test(slug)) out.slug = { key: 'slugPattern' };

  if (!(STORE_THEME_KEYS as readonly string[]).includes(form.themeKey))
    out.themeKey = { key: 'themeInvalid' };

  const domain = form.customDomain.trim();
  if (domain.length > LIMITS.customDomain) out.customDomain = tooLong(LIMITS.customDomain);
  else if (domain !== '' && !DOMAIN_RE.test(domain)) out.customDomain = { key: 'domainInvalid' };

  const logo = form.logoUrl.trim();
  if (logo.length > LIMITS.logoUrl) out.logoUrl = tooLong(LIMITS.logoUrl);
  else if (logo !== '' && !isUrl(logo)) out.logoUrl = { key: 'urlInvalid' };

  if (!HEX_RE.test(form.brandColor.trim())) out.brandColor = { key: 'colorInvalid' };

  if (form.heroText.length > LIMITS.heroText) out.heroText = tooLong(LIMITS.heroText);
  if (form.footerText.length > LIMITS.footerText) out.footerText = tooLong(LIMITS.footerText);

  if (!(PRODUCT_CURRENCIES as readonly string[]).includes(form.currencyCode)) {
    out.currencyCode = { key: 'currencyInvalid' };
  }

  for (const f of ['shippingFlat', 'shippingFreeAbove'] as const) {
    const v = form[f].trim();
    if (v === '') continue;
    if (!AMOUNT_RE.test(v)) out[f] = { key: 'amountInvalid' };
    else if (Number(v) > MAX_AMOUNT) out[f] = { key: 'amountTooBig', values: { max: MAX_AMOUNT } };
  }
  if (form.shippingNote.length > LIMITS.shippingNote)
    out.shippingNote = tooLong(LIMITS.shippingNote);

  if (
    form.paymentProvider !== '' &&
    !(PAYMENT_PROVIDERS as readonly string[]).includes(form.paymentProvider)
  ) {
    out.paymentProvider = { key: 'providerInvalid' };
  }
  if (form.paymentHandle.length > LIMITS.paymentHandle)
    out.paymentHandle = tooLong(LIMITS.paymentHandle);
  for (const f of ['rzpKeyId', 'rzpKeySecret', 'rzpWebhookSecret'] as const) {
    if (form[f].length > LIMITS.rzp) out[f] = tooLong(LIMITS.rzp);
  }

  const delay = form.cartRecoveryDelayMin.trim();
  if (delay !== '') {
    const n = Number(delay);
    if (!Number.isInteger(n) || n < 5 || n > 1440)
      out.cartRecoveryDelayMin = { key: 'delayRange', values: { min: 5, max: 1440 } };
  }
  if (form.cartRecoveryMessage.length > LIMITS.cartRecoveryMessage) {
    out.cartRecoveryMessage = tooLong(LIMITS.cartRecoveryMessage);
  }
  return out;
}

const orNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/**
 * The API body. Blank optional fields are sent as null (cleared). The three Razorpay fields are left out when blank:
 * blank means "keep what is stored" (there is no way to clear them from this form, as in WaDesk).
 */
export function toInput(form: SettingsForm, rowVersion: number): UpdateStorefrontInput {
  const delay = form.cartRecoveryDelayMin.trim();
  return {
    slug: form.slug.trim(),
    themeKey: form.themeKey as StoreTheme,
    enabled: form.enabled,
    customDomain: orNull(form.customDomain),
    logoUrl: orNull(form.logoUrl),
    brandColor: form.brandColor.trim(),
    heroText: orNull(form.heroText),
    footerText: orNull(form.footerText),
    cartRecoveryEnabled: form.cartRecoveryEnabled,
    cartRecoveryDelayMin: delay === '' ? null : Number(delay),
    cartRecoveryMessage: orNull(form.cartRecoveryMessage),
    currencyCode: form.currencyCode as ProductCurrency,
    shippingFlat: orNull(form.shippingFlat),
    shippingFreeAbove: orNull(form.shippingFreeAbove),
    shippingNote: orNull(form.shippingNote),
    paymentProvider: form.paymentProvider === '' ? null : (form.paymentProvider as PaymentProvider),
    paymentHandle: orNull(form.paymentHandle),
    ...(form.rzpKeyId.trim() !== '' ? { rzpKeyId: form.rzpKeyId.trim() } : {}),
    ...(form.rzpKeySecret !== '' ? { rzpKeySecret: form.rzpKeySecret } : {}),
    ...(form.rzpWebhookSecret !== '' ? { rzpWebhookSecret: form.rzpWebhookSecret } : {}),
    rowVersion,
  };
}

/** The Razorpay block matters only for the API provider; the other fields hide behind it. */
export const isRazorpayApi = (provider: string): boolean => provider === 'razorpay_api';

/** Shown under the domain field: the first label of the domain is the CNAME host. */
export function cnameHost(domain: string): string {
  return domain.trim().split('.')[0] ?? '';
}

/** A hex colour typed in the text box, normalised for the colour picker (which needs `#rrggbb`); null while incomplete. */
export function pickerColor(text: string): string | null {
  const v = text.trim();
  return HEX_RE.test(v) ? v.toLowerCase() : null;
}
