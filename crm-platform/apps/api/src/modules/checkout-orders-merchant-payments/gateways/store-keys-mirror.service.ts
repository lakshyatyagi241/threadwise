import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { MerchantGatewaysRepository } from './merchant-gateways.repository';

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * Keeps a shop's own Razorpay keys (the Payment section of the storefront settings page, `wa_storefronts.payment_config_json`) and
 * the shared gateway store in step, so the key a merchant types on that page is the one a checkout uses.
 *
 * The settings page keeps writing the old column (it is still Reference's screen). This mirrors it into the shop's `razorpay` override
 * in the shape the data migration used (`credentials` NULL, the field-by-field encrypted keys in `meta.legacy`): the secrets are
 * copied as they are, never decrypted here. A row whose keys were saved on the gateway screen (it holds the single encrypted
 * envelope) is the merchant's later choice and is left alone; from then on the shop's override there is what applies.
 */
@Injectable()
export class StoreKeysMirror {
  constructor(private readonly repo: MerchantGatewaysRepository) {}

  async sync(
    tx: Tx,
    orgId: number,
    storefrontId: number,
    provider: string | null,
    config: Record<string, unknown> | null,
  ): Promise<void> {
    const existing = await this.repo.find(tx, orgId, storefrontId, 'razorpay', { lock: true });
    if (existing?.credentials) return;

    const keyId = text(config?.key_id);
    const keySecret = text(config?.key_secret);
    if (provider !== 'razorpay_api' || !keyId || !keySecret) {
      if (existing) await this.repo.delete(tx, orgId, existing.id);
      return;
    }
    const legacy: Record<string, string> = { key_id: keyId, key_secret: keySecret };
    const hook = text(config?.webhook_secret);
    if (hook) legacy.webhook_secret = hook;
    const meta = JSON.stringify({ migratedFromStorefront: true, legacy });
    if (existing) {
      await tx.execute(sql`
        UPDATE wa_merchant_gateways SET meta = ${meta}::jsonb, active = true
        WHERE org_id = ${orgId} AND id = ${existing.id}`);
      return;
    }
    await tx.execute(sql`
      INSERT INTO wa_merchant_gateways (org_id, storefront_id, slug, credentials, mode, active, sort_order, meta)
      VALUES (${orgId}, ${storefrontId}, 'razorpay', NULL, 'live', true, 0, ${meta}::jsonb)`);
  }
}
