import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { CurrencyService } from '../platform-settings-branding-storage';
import { MetaRateCardService } from './meta-rate-card.service';
import { WalletSettingsService } from './wallet-settings.service';
import { convertMinor } from './wallet-rules';

/**
 * The currency a workspace is billed in: its own currency setting (`organizations.settings.currency`, the one invoices, deals and
 * onboarding already use) when the platform can bill in it, else the platform currency. "Can bill in it" means Meta's rate card for
 * that currency is stored: without a card there is no real Meta cost to price a message from, so such a workspace stays in the
 * platform currency until the card is imported (the rate-card screen lists the currencies in use that have none).
 *
 * The wallet, the price of each message, the ledger and a top-up all follow this one answer.
 */
@Injectable()
export class BillingCurrencyService {
  constructor(
    private readonly settings: WalletSettingsService,
    private readonly cards: MetaRateCardService,
    private readonly fx: CurrencyService,
  ) {}

  /**
   * An amount that the platform keeps in its own currency (the flat price, the low-balance threshold) as hundredths of `unit`,
   * at the exchange rate on file. The platform currency itself is returned unchanged.
   */
  async fromPlatform(minor: number, unit: string): Promise<number> {
    const platform = await this.settings.currency();
    if (unit === platform) return minor;
    const [from, to] = await Promise.all([this.fx.find(platform), this.fx.find(unit)]);
    return convertMinor(minor, Number(from?.rate ?? 1), Number(to?.rate ?? 1));
  }

  /** The currencies a workspace can be billed in: the platform currency and every currency with a stored Meta card. */
  async billable(tx: Tx): Promise<string[]> {
    const platform = await this.settings.currency();
    return [...new Set([platform, ...(await this.cards.currencies(tx))])].sort();
  }

  async forOrg(tx: Tx, orgId: number): Promise<string> {
    const platform = await this.settings.currency();
    const res = await tx.execute(
      sql`SELECT upper(settings->>'currency') AS currency FROM organizations WHERE id = ${orgId}`,
    );
    const own = (res.rows[0] as { currency?: string | null } | undefined)?.currency ?? '';
    if (!own || own === platform) return platform;
    return (await this.cards.currencies(tx)).includes(own) ? own : platform;
  }

  /**
   * A cost in US dollars as hundredths of `unit`, at the rate on file (units per USD). Rounded UP and never 0 for a real cost: a
   * charge the wallet cannot represent would otherwise be free.
   */
  async fromUsd(usd: number, unit: string): Promise<number> {
    if (!(usd > 0)) return 0;
    const rate = Number((await this.fx.find(unit))?.rate ?? 1);
    return Math.max(1, Math.ceil(usd * (rate > 0 ? rate : 1) * 100 - 1e-9));
  }
}
