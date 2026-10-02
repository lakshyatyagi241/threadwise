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
}

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
    const [taxEnabled, taxRate, taxLabel, toggle, discount, requireSecret, currency] =
      await Promise.all([
        g<boolean>('checkout.tax_enabled'),
        g<number | string>('checkout.tax_rate'),
        g<string>('checkout.tax_label'),
        g<boolean>('pricing.yearly_toggle_enabled'),
        g<number>('pricing.yearly_discount_pct'),
        g<boolean>('payment.require_webhook_secret'),
        g<string>('default_currency'),
      ]);
    const rate = String(taxRate ?? '0');
    const pct = Number(discount ?? 20);
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
    };
  }
}
