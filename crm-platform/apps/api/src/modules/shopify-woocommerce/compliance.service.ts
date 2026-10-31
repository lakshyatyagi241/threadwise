import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import { verifyShopifyWebhook } from './event-rules';
import { EcomSettingsService } from './platform-settings.service';

/**
 * Shopify's three mandatory privacy webhooks (TW-ECOM-022). The route has no per-store secret, so the app-level signature is
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
        const customer = (data.customer ?? {}) as { id?: unknown; phone?: unknown };
        await this.erase(
          shop,
          {
            phone: typeof customer.phone === 'string' ? customer.phone : '',
            customerId:
              typeof customer.id === 'number' || typeof customer.id === 'string'
                ? String(customer.id)
                : '',
          },
          false,
        );
      } else if (topic === 'shop/redact') {
        await this.erase(shop, { phone: '', customerId: '' }, true);
      } else {
        // customers/data_request: only webhook logs are held; the request is recorded and acknowledged.
        this.logger.log({ topic, shop }, '[Shopify-compliance] acknowledged');
      }
    } catch (err) {
      this.logger.warn({ topic, err }, '[Shopify-compliance] handler failed (swallowed)');
    }
    return 200;
  }

  /**
   * Erases one customer's log rows, matched by phone digits (recipients are stored digits-only) or by the customer id in the payload,
   * or the whole shop when `wholeShop`. A redact that names neither the phone nor the id erases nothing.
   */
  private async erase(
    shop: string,
    subject: { phone: string; customerId: string },
    wholeShop: boolean,
  ): Promise<void> {
    const digits = subject.phone.replace(/\D/g, '');
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
          if (digits === '' && subject.customerId === '') return;
          await tx.execute(sql`
            DELETE FROM shopify_integration_logs
            WHERE org_id = ${orgId} AND integration_id = ${id}
              AND ((${digits} <> '' AND regexp_replace(recipient, '[^0-9]', '', 'g') = ${digits})
                OR (${subject.customerId} <> '' AND payload->'customer'->>'id' = ${subject.customerId}))`);
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
