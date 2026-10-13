import { Inject, Injectable } from '@nestjs/common';
import type { AbandonCartInput } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { CartPricingService } from '../public/cart-pricing.service';
import { PublicShopLoader } from '../public/public-shop.loader';
import { digitsOnly, hasValidPhone } from '../rules/phone';
import { recoveryDelayMinutes } from '../rules/recovery-message';
import { SENDER_DIRECTORY, type SenderDirectory } from '../_shims/tokens';
import { CartRecoveryRepository } from './cart-recovery.repository';

/**
 * Abandoned-cart recovery, buyer side (TW-STORE-015): the beacon records a cart and when its WhatsApp nudge is due; an order
 * from the same phone cancels it. The nudge itself is sent by `CartRecoverySweepService` in the worker.
 *
 * Reference registered a one-off message on a Node scheduler; here the due time is a column the worker sweeps. A fired row moves
 * to `sent` (Reference left it `active` forever, which blocked later recoveries for that phone and shop).
 */
@Injectable()
export class CartRecoveryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly loader: PublicShopLoader,
    private readonly pricing: CartPricingService,
    private readonly repo: CartRecoveryRepository,
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
  ) {}

  /** `scheduled` is false when recovery is off, the workspace has no sender, or an active recovery already exists. */
  async abandon(slug: string, input: AbandonCartInput): Promise<{ scheduled: boolean }> {
    if (!hasValidPhone(input.phone))
      throw AppError.validation('Please enter a valid phone number.');
    const handle = await this.loader.resolve(slug);
    const phone = digitsOnly(input.phone);

    return this.db.txAs({ orgId: handle.orgId }, async (tx) => {
      const shop = await this.loader.shop(tx, handle);
      // Off unless the merchant switched it on: exactly `true`.
      if (shop.settings.cart_recovery_enabled !== true) return { scheduled: false };

      // Re-priced on the server so the stored subtotal can be trusted.
      const { subtotalMinor } = await this.pricing.price(tx, handle, input.items);

      // No sender, no nudge: Reference did not schedule one either.
      if (!(await this.senders.recoverySender(tx, handle.orgId))) return { scheduled: false };

      const created = await this.repo.insertActive(tx, handle.orgId, {
        storefrontId: handle.storefrontId,
        phoneDigits: phone,
        name: input.name?.trim() ? input.name.trim() : null,
        // The items as the browser sent them (ids and quantities); they are not validated against the catalogue.
        items: input.items.map((i) => ({
          id: i.id,
          ...(i.variantId ? { variantId: i.variantId } : {}),
          qty: i.qty,
        })),
        subtotalMinor,
        currencyCode: shop.currencyCode || 'INR',
        delayMinutes: recoveryDelayMinutes(Number(shop.settings.cart_recovery_delay_min ?? 30)),
      });
      return { scheduled: created };
    });
  }

  /** The cart converted: every active recovery of this shop and phone becomes `recovered` (digits compared with digits). */
  async cancelOnOrder(tx: Tx, orgId: number, storefrontId: number, phone: string): Promise<void> {
    await this.repo.markRecovered(tx, orgId, storefrontId, digitsOnly(phone));
  }
}
