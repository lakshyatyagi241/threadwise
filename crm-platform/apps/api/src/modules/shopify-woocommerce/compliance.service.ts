import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import { verifyShopifyWebhook } from './event-rules';
import { EcomSettingsService } from './platform-settings.service';

/**
 * Shopify's three mandatory privacy webhooks (WD-ECOM-022). The route has no per-store secret, so the app-level signature is
 * checked first and a bad one is a 401 before anything is read. Once it holds the answer is always 200 (Shopify retries anything
 * else): a handler that fails is logged, never surfaced.
 */
@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly settings: EcomSettingsService,
  ) {}

  async receive(raw: Buffer, hmac: string, topic: string, shopHeader: string): Promise<401 | 200> {
    const { clientSecret } = await this.settings.shopify();
    if (!verifyShopifyWebhook(raw, hmac, clientSecret)) return 401;
    try {
      const data = parse(raw);
      const shop = String(data.shop_domain ?? shopHeader ?? '').trim();
      if (topic === 'customers/redact') {
        const customer = (data.customer ?? {}) as { phone?: unknown };
        await this.erase(shop, typeof customer.phone === 'string' ? customer.phone : '', false);
      } else if (topic === 'shop/redact') {
        await this.erase(shop, '', true);
      } else {
        // customers/data_request: only webhook logs are held; the request is recorded and acknowledged.
        this.logger.log({ topic, shop }, '[Shopify-compliance] acknowledged');
      }
    } catch (err) {
      this.logger.warn({ topic, err }, '[Shopify-compliance] handler failed (swallowed)');
    }
    return 200;
  }

  /** Erases a customer's log rows (all of the shop's when no phone was given), or the whole shop when `wholeShop`. */
  private async erase(shop: string, phone: string, wholeShop: boolean): Promise<void> {
    if (shop === '') return;
    const found = await this.db.primary.execute(sql`SELECT * FROM ecom_shop_lookup(${shop})`);
    const hits = found.rows as Array<{
      store_org_id: number | string;
      store_row_id: number | string;
    }>;
    for (const hit of hits) {
      const orgId = Number(hit.store_org_id);
      const id = Number(hit.store_row_id);
      await this.db.txAs({ orgId }, async (tx) => {
        if (wholeShop) {
          await tx.execute(
            sql`DELETE FROM shopify_integration_logs WHERE org_id = ${orgId} AND integration_id = ${id}`,
          );
          // Events, waitlist and cart rows go with the store (their foreign keys cascade).
          await tx.execute(
            sql`DELETE FROM shopify_integrations WHERE org_id = ${orgId} AND id = ${id}`,
          );
        } else {
          await tx.execute(sql`
            DELETE FROM shopify_integration_logs
            WHERE org_id = ${orgId} AND integration_id = ${id} AND (${phone} = '' OR recipient = ${phone})`);
        }
      });
    }
  }
}

function parse(raw: Buffer): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw.toString('utf8'));
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
