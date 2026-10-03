import { Injectable } from '@nestjs/common';
import { PlatformSettingsService } from '../auth';

export interface CheckoutSettings {
  taxEnabled: boolean;
  /** Percent as a decimal string with at most two decimals. */
  taxRate: string;
  taxLabel: string;
  yearlyToggleEnabled: boolean;
  yearlyDiscountPct: number;
  requireWebhookSecret: boolean;
  defaultCurrency: string;
  refundEnabled: boolean;
  refundDays: number;
  recurringEnabled: boolean;
  /** The checkout country dropdown (TW-PAYGW-007 rule 2): the saved list, else Reference's four. */
  countries: string[];
}

export const DEFAULT_COUNTRIES = ['India', 'United States', 'United Kingdom', 'Other'] as const;

/**
 * One typed read of the checkout-facing platform settings, with ONE set of defaults (Reference's form said 18% GST while its order
 * code billed 0%). Tax is off until an operator turns it on: a fresh platform must never add a tax line nobody configured.
 * Keys keep Reference's names so the settings screen (TW-PAYGW-007) and the mobile app read the same rows.
 */
@Injectable()
export class CheckoutSettingsService {
  constructor(private readonly settings: PlatformSettingsService) {}

  async load(): Promise<CheckoutSettings> {
    const g = <T>(k: string) => this.settings.get<T>(k);
    const [
      taxEnabled,
      taxRate,
      taxLabel,
      toggle,
      discount,
      requireSecret,
      currency,
      refundEnabled,
      refundDays,
      recurring,
      countries,
    ] = await Promise.all([
      g<boolean>('checkout.tax_enabled'),
      g<number | string>('checkout.tax_rate'),
      g<string>('checkout.tax_label'),
      g<boolean>('pricing.yearly_toggle_enabled'),
      g<number>('pricing.yearly_discount_pct'),
      g<boolean>('payment.require_webhook_secret'),
      g<string>('default_currency'),
      g<boolean>('pricing.refund_enabled'),
      g<number>('pricing.refund_days'),
      g<boolean>('pricing.recurring_enabled'),
      g<unknown>('checkout.countries'),
    ]);
    const rate = String(taxRate ?? '0');
    const pct = Number(discount ?? 20);
    const days = Number(refundDays ?? 7);
    // Reference stored this as a JSON-encoded string inside a JSON value; accept both that and a plain list.
    let list: unknown = countries;
    if (typeof list === 'string') {
      try {
        list = JSON.parse(list);
      } catch {
        list = [];
      }
    }
    const cleaned = Array.isArray(list)
      ? [
          ...new Set(list.filter((c): c is string => typeof c === 'string').map((c) => c.trim())),
        ].filter(Boolean)
      : [];
    return {
      taxEnabled: taxEnabled === true,
      taxRate: /^\d{1,3}(\.\d{1,2})?$/.test(rate) && Number(rate) <= 100 ? rate : '0',
      taxLabel:
        typeof taxLabel === 'string' && taxLabel.trim() ? taxLabel.trim().slice(0, 32) : 'Tax',
      yearlyToggleEnabled: toggle !== false,
      yearlyDiscountPct: Number.isInteger(pct) && pct >= 0 && pct <= 100 ? pct : 20,
      requireWebhookSecret: requireSecret !== false,
      defaultCurrency:
        typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : 'USD',
      refundEnabled: refundEnabled !== false,
      refundDays: Number.isInteger(days) && days >= 0 && days <= 365 ? days : 7,
      recurringEnabled: recurring !== false,
      countries: cleaned.length > 0 ? cleaned : [...DEFAULT_COUNTRIES],
    };
  }
}
