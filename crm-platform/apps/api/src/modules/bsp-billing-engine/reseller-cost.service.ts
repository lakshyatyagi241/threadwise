import { Injectable } from '@nestjs/common';
import type { Tx } from '@crm/db';
import { ResellerRepository } from './reseller.repository';
import { resolveRate, type RateRow } from './reseller-rules';

/**
 * What a message costs the platform at Meta, stamped on the ledger row when it is charged (WD-BSP-016). The settle engine (WALLET)
 * calls `lookup` inside its own transaction with the destination country and the message category; the P&L later sums the
 * stamped `cost_minor` and counts the rows where it is null.
 *
 * The rate rows are read per call: the table is small and global, and WaDesk's five-minute cache is what made a plain database
 * edit take five minutes to apply (WD-BSP-016 rule 2).
 */
@Injectable()
export class ResellerCostService {
  constructor(private readonly repo: ResellerRepository) {}

  async lookup(
    tx: Tx,
    country: string | null | undefined,
    category: string | null | undefined,
  ): Promise<{ credits: number | null; costMinor: string | null }> {
    const rows: RateRow[] = (await this.repo.activeRates(tx)).map((r) => ({
      countryCode: r.country_code,
      category: r.category,
      credits: r.credits,
      metaCostMinor: r.meta_cost_minor,
    }));
    const found = resolveRate(rows, country, category);
    return found;
  }
}
