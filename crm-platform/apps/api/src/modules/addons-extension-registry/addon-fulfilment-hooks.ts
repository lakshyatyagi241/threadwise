import { Injectable, Logger } from '@nestjs/common';
import type { Tx } from '@crm/db';

/** A purchase row the fulfilment has just written, as a listener needs to know it. */
export interface FulfilledAddon {
  orgId: number;
  /** The billing add-on (a `plans` row of kind `addon`) and its slug. */
  packId: number;
  packSlug: string;
  /** Set when the add-on is the one that sells a Marketplace app (`plans.marketplace_app_id`). */
  marketplaceAppId: number | null;
  /** `workspace_addons.id`, internal. */
  workspaceAddonId: number;
  orderId: number | null;
  startsAt: Date;
  endsAt: Date | null;
}

/**
 * Something that must happen in the SAME transaction as an add-on purchase. Checkout's order finalisation owns that transaction (it is
 * privileged: the receivers have no tenant), so a listener may write whatever its own domain keeps about the purchase and is covered by the
 * same commit or rollback. Listeners are called in registration order and must be idempotent only in the sense the fulfilment already is:
 * they run once per newly created purchase row, never for a replayed order.
 */
export interface AddonFulfilmentListener {
  readonly name: string;
  onFulfilled(tx: Tx, purchase: FulfilledAddon): Promise<void>;
}

/**
 * Where a domain announces that it wants to hear about add-on purchases. The add-ons domain knows nothing about its listeners (the
 * Marketplace is the first), the same shape as the kernel's outbox subscriber registry but synchronous, because a subscription row that
 * trails its entitlement by a queue hop would show a workspace that just paid as having nothing. Registered once per process in the
 * listener's own module (`onModuleInit`), so the API and the worker process both have it.
 */
@Injectable()
export class AddonFulfilmentHooks {
  private readonly logger = new Logger(AddonFulfilmentHooks.name);
  private readonly listeners: AddonFulfilmentListener[] = [];

  register(listener: AddonFulfilmentListener): void {
    if (this.listeners.some((l) => l.name === listener.name)) return;
    this.listeners.push(listener);
  }

  async run(tx: Tx, purchase: FulfilledAddon): Promise<void> {
    for (const l of this.listeners) {
      // A failing listener fails the purchase's transaction on purpose: the order stays unpaid and the provider's next delivery tries
      // again, instead of a paid order whose subscription was never recorded.
      await l.onFulfilled(tx, purchase);
    }
    if (this.listeners.length === 0 && purchase.marketplaceAppId !== null) {
      this.logger.warn(
        { pack: purchase.packSlug },
        'a Marketplace add-on was fulfilled with no listener registered: its subscription row was not written',
      );
    }
  }
}
