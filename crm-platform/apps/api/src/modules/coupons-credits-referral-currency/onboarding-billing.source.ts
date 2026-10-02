import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { PlatformStore, type OnboardingBillingHints, type OnboardingBillingSource } from '../auth';
import { WalletSettingsService } from '../wallet-message-billing';

/**
 * What the sign-up plan step shows about credits (TW-CPN-014, TW-AUTH-009), read from the billing settings the operator already
 * maintains: the platform currency, what one message costs, and where "Top up message credits" leads. Reference linked to the first
 * ACTIVE credit package's checkout, which redirected to the any-amount top-up with the package price in whole units; with no
 * package it went to the wallet tab. Same here, against the top-up checkout and the wallet page.
 */
@Injectable()
export class OnboardingBillingSourceImpl implements OnboardingBillingSource {
  constructor(
    private readonly wallet: WalletSettingsService,
    private readonly store: PlatformStore,
  ) {}

  async hints(): Promise<OnboardingBillingHints> {
    const s = await this.wallet.effective();
    const first = await this.store.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT price_minor FROM credit_packages WHERE is_active ORDER BY sort_order, id LIMIT 1`,
      );
      return res.rows[0] as { price_minor: string } | undefined;
    });
    const major = first ? Math.round(Number(first.price_minor) / 100) : null;
    return {
      creditsPerMessage: Math.max(1, s.flatPriceMinor),
      defaultCurrency: s.currency,
      topUpUrl:
        major !== null && major > 0
          ? `/billing/checkout/wallet?amount=${major}`
          : '/billing/wallet',
    };
  }
}
