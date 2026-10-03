import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { STOREFRONT_ENV, type StorefrontEnv } from '../../../config/domains/storefront-builder.env';
import { DatabaseService } from '../../../infra/db/database.service';
import { buildRecoveryMessage, recoveryShopUrl } from '../rules/recovery-message';
import { ShopsRepository } from '../shops/shops.repository';
import {
  RECOVERY_NUDGE_SENDER,
  SENDER_DIRECTORY,
  type RecoveryNudgeSender,
  type SenderDirectory,
} from '../_shims/tokens';
import { CartRecoveryRepository, type DueRecovery } from './cart-recovery.repository';

const BATCH = 100;

/**
 * The abandoned-cart nudge (TW-STORE-015), in the worker. Every minute it claims the recoveries that are due across every
 * workspace (`status = 'active' AND nudged_at IS NULL AND nudge_at <= now()`, `FOR UPDATE SKIP LOCKED`, so however many
 * workers run a row is taken once), stamps them `sent` with `nudged_at`, and then sends one plain-text WhatsApp message per
 * row from the shop's own workspace.
 *
 * Claim-then-send is at-most-once, like the one-off message Reference registered on its scheduler: a nudge that fails to send is
 * logged and not retried, and never goes out twice. A buyer who orders cancels their row (`recovered`) before it is claimed.
 *
 * The claim is cross-tenant by definition (one of the sanctioned privileged uses); everything else runs under the row's own
 * tenant. Imported by the worker module only.
 */
@Injectable()
export class CartRecoverySweepService {
  private readonly logger = new Logger(CartRecoverySweepService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CartRecoveryRepository,
    private readonly shops: ShopsRepository,
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
    @Inject(RECOVERY_NUDGE_SENDER) private readonly nudges: RecoveryNudgeSender,
    @Inject(STOREFRONT_ENV) private readonly env: StorefrontEnv,
  ) {}

  @Interval(60_000)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.sweep();
      if (n > 0) this.logger.debug({ nudged: n }, 'cart recovery sweep');
    } catch (err) {
      this.logger.error({ err }, 'cart recovery sweep failed');
    } finally {
      this.running = false;
    }
  }

  /** One pass. Returns how many rows were claimed. */
  async sweep(limit = BATCH): Promise<number> {
    const due = await this.db.privileged(async (tx) => {
      const rows = await this.repo.claimDue(tx, limit);
      for (const r of rows) await this.repo.markSent(tx, r.orgId, r.id);
      return rows;
    });
    for (const row of due) {
      try {
        await this.nudge(row);
      } catch (err) {
        this.logger.warn(
          { err: String(err), recovery: row.id },
          '[SF-CART] nudge could not be sent',
        );
      }
    }
    return due.length;
  }

  private async nudge(row: DueRecovery): Promise<void> {
    const ready = await this.db.txAs({ orgId: row.orgId }, async (tx) => {
      const shop = await this.shops.findById(tx, row.orgId, row.storefrontId);
      if (!shop) return null;
      const sender = await this.senders.recoverySender(tx, row.orgId);
      const orgName = shop.shopName ? null : await this.shops.orgName(tx, row.orgId);
      return { shop, sender, orgName };
    });
    if (!ready) return;
    if (!ready.sender) {
      this.logger.log(`[SF-CART] no sender for org ${row.orgId} — recovery skipped`);
      return;
    }

    const { shop } = ready;
    const text = shop.settings.cart_recovery_message;
    const body = buildRecoveryMessage({
      customText: typeof text === 'string' ? text : null,
      customerName: row.customerName,
      shopName: shop.shopName || ready.orgName || 'our store',
      shopUrl: recoveryShopUrl(shop, this.env.webAppUrl),
      subtotalMinor: row.subtotalMinor,
      currencyCode: row.currencyCode || shop.currencyCode || 'INR',
    });
    await this.nudges.send(row.orgId, ready.sender, row.customerPhone, body);
  }
}
