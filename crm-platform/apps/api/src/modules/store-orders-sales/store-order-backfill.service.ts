import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { canonicalizeLocalPhone } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';
import {
  CONTACT_RESOLVER,
  InvoiceSettingsService,
  type ContactResolverPort,
  type ContactSkipReason,
} from '../crm';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { StoreOrderRepository } from './store-order.repository';
import { StoreOrderSalesService } from './store-order-sales.service';
import { isCancelled, parseTrigger, triggerMet } from './store-order.rules';

export interface BackfillOptions {
  /** One workspace (internal id); every workspace when omitted. */
  orgId?: number;
  /** Report what would happen and write nothing. */
  dryRun: boolean;
  log?: (line: string) => void;
}

export type BackfillSkipReason = ContactSkipReason | 'error';

export interface BackfillSkip {
  orgId: number;
  orderId: number;
  reason: BackfillSkipReason;
  /** The phone as the order holds it (for "no_phone" / "unusable_phone" a person has to fix it), or the error text. */
  detail: string | null;
}

export interface BackfillSummary {
  dryRun: boolean;
  /** Orders without a contact that were looked at. */
  scanned: number;
  /** Orders that now have (or, in a dry run, would get) a contact. */
  linked: number;
  contactsCreated: number;
  contactsFound: number;
  salesOrdersCreated: number;
  invoicesCreated: number;
  paymentsRecorded: number;
  profilesCreated: number;
  skipped: BackfillSkip[];
  skippedByReason: Record<string, number>;
}

const SOURCE_TAG = 'Store customer';
class DryRunRollback extends Error {}

/**
 * Repeatable, idempotent catch-up for store orders that predate the contact link (or whose contact was refused at the time): every
 * `wa_orders` row with `contact_id IS NULL` gets its contact (the CRM's one door, `findOrCreateByPhone`, source "store"), then the same
 * `syncOrder` a new order gets (sales order, timeline entry, and an invoice or receipt only when the workspace's trigger is met, so an
 * unpaid order under the default "on paid" trigger gets no invoice), and the buyer's saved customer profile if it is missing.
 *
 * It never fails the batch: a plan out of contacts, a number that cannot be read, or an unexpected error is a skipped order with its
 * reason. A bare local number is read in the platform's default country by the resolver (the same normalisation every contact writer
 * uses); with no default country it is reported "unusable_phone", never guessed. A second run finds only what is still unlinked and
 * changes nothing else. `dryRun` writes nothing (the contact step runs in a transaction that is rolled back).
 *
 * Run from `cli/backfill-store-orders.ts` (`pnpm --filter @crm/api backfill:store-orders`). The cross-workspace scan uses the
 * privileged connection; every write runs inside the order's own workspace.
 */
@Injectable()
export class StoreOrderBackfillService {
  private readonly logger = new Logger(StoreOrderBackfillService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly orders: StoreOrderRepository,
    private readonly sales: StoreOrderSalesService,
    @Inject(CONTACT_RESOLVER) private readonly resolver: ContactResolverPort,
    private readonly invoiceSettings: InvoiceSettingsService,
    private readonly entitlements: PlanEntitlementService,
  ) {}

  async run(opts: BackfillOptions): Promise<BackfillSummary> {
    const say = opts.log ?? (() => undefined);
    const summary: BackfillSummary = {
      dryRun: opts.dryRun,
      scanned: 0,
      linked: 0,
      contactsCreated: 0,
      contactsFound: 0,
      salesOrdersCreated: 0,
      invoicesCreated: 0,
      paymentsRecorded: 0,
      profilesCreated: 0,
      skipped: [],
      skippedByReason: {},
    };
    const candidates = await this.candidates(opts.orgId);
    const cc = await this.resolver.defaultCountryCode();
    say(
      `${candidates.length} order(s) without a contact${opts.orgId ? ` in workspace ${opts.orgId}` : ''}; default country ${cc ?? '(none)'}`,
    );
    for (const c of candidates) {
      summary.scanned++;
      const skip = (reason: BackfillSkipReason, detail: string | null) => {
        summary.skipped.push({ orgId: c.orgId, orderId: c.id, reason, detail });
        summary.skippedByReason[reason] = (summary.skippedByReason[reason] ?? 0) + 1;
        say(
          `  order ${c.id} (workspace ${c.orgId}): skipped, ${reason}${detail ? ` (${detail})` : ''}`,
        );
      };
      if (!c.phone?.trim()) {
        skip('no_phone', null);
        continue;
      }
      if (!canonicalizeLocalPhone(c.phone, cc)) {
        skip('unusable_phone', c.phone);
        continue;
      }
      try {
        if (opts.dryRun) await this.dryRunOne(c, summary, skip);
        else await this.runOne(c, summary, skip);
      } catch (err) {
        this.logger.warn(
          { err: String(err), orgId: c.orgId, order: c.id },
          'backfill: order failed',
        );
        skip('error', err instanceof Error ? err.message : String(err));
      }
    }
    return summary;
  }

  private async candidates(orgId?: number) {
    return this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT org_id, id, customer_phone FROM wa_orders
        WHERE contact_id IS NULL ${orgId !== undefined ? sql`AND org_id = ${orgId}` : sql``}
        ORDER BY org_id, id`);
      return (
        res.rows as Array<{
          org_id: number | string;
          id: number | string;
          customer_phone: string | null;
        }>
      ).map((r) => ({ orgId: Number(r.org_id), id: Number(r.id), phone: r.customer_phone }));
    });
  }

  private async profileCount(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*)::int AS n FROM wa_customer_profiles WHERE org_id = ${orgId}`,
    );
    return Number((res.rows[0] as { n: number }).n);
  }

  /** The real thing: `syncOrder` links the contact (and the profile), creates the sales order, and bills only when the trigger says so. */
  private async runOne(
    c: { orgId: number; id: number },
    summary: BackfillSummary,
    skip: (reason: BackfillSkipReason, detail: string | null) => void,
  ): Promise<void> {
    const before = await this.db.privileged((tx) => this.profileCount(tx, c.orgId));
    const r = await this.sales.syncOrder(c.orgId, { id: c.id });
    const after = await this.db.privileged((tx) => this.profileCount(tx, c.orgId));
    summary.profilesCreated += Math.max(0, after - before);
    if (r.order === 'not_found') return;
    if (r.contact === 'skipped') skip((r.contactSkipReason ?? 'error') as BackfillSkipReason, null);
    else if (r.contact === 'created' || r.contact === 'found' || r.contact === 'linked') {
      summary.linked++;
      if (r.contact === 'created') summary.contactsCreated++;
      else summary.contactsFound++;
    }
    if (r.salesOrder === 'created') summary.salesOrdersCreated++;
    if (r.invoice === 'invoiced') summary.invoicesCreated++;
    if (r.payment === 'recorded') summary.paymentsRecorded++;
  }

  /** Same decisions, nothing kept: the contact step runs in a transaction that is rolled back; the rest is predicted from the plan and the trigger. */
  private async dryRunOne(
    c: { orgId: number; id: number },
    summary: BackfillSummary,
    skip: (reason: BackfillSkipReason, detail: string | null) => void,
  ): Promise<void> {
    let predicted: 'created' | 'found' | 'skipped' = 'skipped';
    let status = 'new';
    let hasSalesOrder = false;
    try {
      await this.db.txAs({ orgId: c.orgId, userId: null }, async (tx) => {
        const order = await this.orders.lock(tx, c.orgId, { id: c.id });
        if (!order) return;
        status = order.status;
        hasSalesOrder = order.salesOrderId !== null;
        const before = await this.profileCount(tx, c.orgId);
        const link = await this.resolver.findOrCreateByPhone(tx, c.orgId, {
          phone: order.customerPhone,
          name: order.customerName,
          email: order.customerEmail,
          address: order.customerAddress,
          source: 'store',
          tag: SOURCE_TAG,
          saveProfile: true,
        });
        summary.profilesCreated += Math.max(0, (await this.profileCount(tx, c.orgId)) - before);
        if (link.outcome === 'skipped') skip(link.reason, null);
        else predicted = link.outcome;
        throw new DryRunRollback();
      });
    } catch (err) {
      if (!(err instanceof DryRunRollback)) throw err;
    }
    if (predicted === 'skipped') return;
    summary.linked++;
    if (predicted === 'created') summary.contactsCreated++;
    else summary.contactsFound++;
    if (isCancelled(status)) return;
    const invoicing = await this.entitlements.featureEnabled(c.orgId, 'invoicing');
    if (!invoicing) return;
    if (!hasSalesOrder) summary.salesOrdersCreated++;
    const wantsInvoice = await this.db.txAs({ orgId: c.orgId, userId: null }, async (tx) =>
      triggerMet(
        parseTrigger((await this.invoiceSettings.storeOrderPolicy(tx, c.orgId)).triggerOwn),
        status,
      ),
    );
    if (wantsInvoice) summary.invoicesCreated++;
  }
}
