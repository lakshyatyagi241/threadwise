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
 * What the payment provider did to the autopay subscription behind an add-on purchase, as the payments domain applied it. Every event is
 * delivered in the transaction that applied it, so a ledger that follows the entitlement moves with it.
 *
 *   activated     the first charge went through and the provider subscription is live
 *   renewed       a renewal charge went through: `endsAt` is the purchase's new end
 *   payment_failed a renewal charge failed: the provider retries and the grace days keep the add-on working
 *   ended         the provider subscription is over (cancelled by the workspace, an operator or the provider, or it expired); the paid term
 *                 keeps running to `endsAt`. `reason` says who ended it.
 */
export type AddonTermEventKind = 'activated' | 'renewed' | 'payment_failed' | 'ended';

export interface AddonTermEvent {
  kind: AddonTermEventKind;
  orgId: number;
  packId: number;
  packSlug: string;
  marketplaceAppId: number | null;
  /** `workspace_addons.id`, internal. */
  workspaceAddonId: number;
  /** The purchase's end after the event was applied (null: it has none). */
  endsAt: Date | null;
  /** The provider's id of the payment, when the event carries one (a renewal or a failure). */
  paymentId: string | null;
  /** For `ended`: who ended it. */
  reason?: 'user' | 'superseded' | 'downgrade' | 'operator' | 'provider' | 'expired';
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
  /** The provider's autopay subscription behind a purchase changed (see `AddonTermEvent`). Optional: not every listener follows renewals. */
  onTermEvent?(tx: Tx, event: AddonTermEvent): Promise<void>;
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
    this.warnIfNoListener(purchase.marketplaceAppId, purchase.packSlug);
  }

  /** Tells the listeners, in the caller's transaction, what the provider did to the autopay subscription of a Marketplace add-on. */
  async runTerm(tx: Tx, event: AddonTermEvent): Promise<void> {
    if (event.marketplaceAppId === null) return;
    for (const l of this.listeners) {
      // Failing the transaction on purpose, as for a purchase: the provider's next delivery (or the reconciler's poll) tries again.
      await l.onTermEvent?.(tx, event);
    }
  }

  private warnIfNoListener(marketplaceAppId: number | null, packSlug: string): void {
    if (this.listeners.length === 0 && marketplaceAppId !== null) {
      this.logger.warn(
        { pack: packSlug },
        'a Marketplace add-on was fulfilled with no listener registered: its subscription row was not written',
      );
    }
  }
}
