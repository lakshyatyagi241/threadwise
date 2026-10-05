import { Injectable } from '@nestjs/common';
import type { BspDashboard, BspDashboardQuery, BspStatus } from '@crm/contracts';
import { ResellerPlatformReader } from './reseller-platform.reader';
import { monthWindow, subtractDecimal } from './reseller-rules';
import { ResellerSettingsService } from './reseller-settings.service';

/**
 * The reseller's numbers: the P&L of one month (WD-BSP-014, -015) and the health probe (WD-BSP-001). Read only.
 *
 * WaDesk showed this month only, in the signed-in admin's currency. Here the month is a parameter and the currency is the
 * platform's base currency, so two operators see the same figure.
 */
@Injectable()
export class ResellerReportService {
  constructor(
    private readonly reader: ResellerPlatformReader,
    private readonly settings: ResellerSettingsService,
  ) {}

  async status(): Promise<BspStatus> {
    const view = await this.settings.view();
    return {
      ok: true,
      module: 'bsp',
      configured: view.configured,
      graphVersion: view.graphVersion,
      allocations: await this.reader.allocationCount(),
    };
  }

  async dashboard(query: BspDashboardQuery, now = new Date()): Promise<BspDashboard> {
    const window = monthWindow(query.month, now);
    const { baseCurrency } = await this.settings.connection();
    const currency = query.currency ?? baseCurrency;
    const rows = await this.reader.dashboard({
      from: window.from,
      to: window.to,
      currency,
      // A charge from before per-currency billing has no currency: it was made in the base currency.
      legacyCurrency: baseCurrency,
      limit: query.limit,
    });
    return {
      month: window.month,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      currency,
      currencies: rows.currencies,
      totals: {
        billedMessages: rows.totals.billed,
        freeMessages: rows.totals.free,
        revenue: rows.totals.revenue,
        metaCost: rows.totals.cost,
        margin: subtractDecimal(rows.totals.revenue, rows.totals.cost),
        unpricedMessages: rows.totals.unpriced,
        walletFloat: rows.totals.walletFloat,
      },
      workspaces: rows.workspaces.map((w) => ({
        workspaceId: w.org_uuid,
        workspaceName: w.org_name,
        billedMessages: w.billed,
        revenue: w.revenue,
        metaCost: w.cost,
        margin: subtractDecimal(w.revenue, w.cost),
        walletBalance: w.wallet_balance,
      })),
      hasMoreWorkspaces: rows.hasMore,
    };
  }
}
