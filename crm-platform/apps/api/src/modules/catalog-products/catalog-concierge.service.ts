import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { DatabaseService } from '../../infra/db/database.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import {
  CATALOG_PROVIDER,
  type CatalogProvider,
} from '../../infra/providers/catalog-products/catalog-provider.port';
import { asMeta, readAutomation } from './catalog-automation';
import { CatalogBindings } from './catalog-bindings';
import { digitsOf } from './catalog-rules';
import {
  CONCIERGE_COOLDOWN_SECONDS,
  CONCIERGE_DEFAULT_EMPTY,
  CONCIERGE_DEFAULT_HEADER,
  conciergeBody,
  extractIntent,
  looksLikeProductQuery,
  rankProducts,
  type Intent,
} from './concierge-rules';
import { CatalogsRepository } from './catalogs.repository';
import { shareRetailerId } from './catalog-variants';
import {
  PRODUCT_SELECT,
  ProductsRepository,
  toProductRow,
  type ProductRow,
} from './products.repository';

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * The catalog concierge (TW-CAT-028): turns a free-text inbound ("got any red shoes under 2000?") into a product-list message
 * of the best matches.
 *
 * Hard-gated like Reference: OFF unless the catalog's automation says so; only a message that looks like a product question;
 * one auto-answer per sender per 30 seconds; silent on no match unless the merchant opted into a reply; and it never throws
 * (it must not break inbound handling).
 *
 * NOT WIRED: the inbound message hook that calls `handleInbound` belongs to the inbox / webhook domain. This is the service
 * that hook calls; it is exported from the barrel.
 */
@Injectable()
export class CatalogConciergeService {
  private readonly logger = new Logger(CatalogConciergeService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly catalogs: CatalogsRepository,
    private readonly bindings: CatalogBindings,
    private readonly productsRepo: ProductsRepository,
    @Inject(CATALOG_PROVIDER) private readonly provider: CatalogProvider,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** True when the concierge answered, so the caller stops handling the message. */
  async handleInbound(orgId: number, phone: string, message: string): Promise<boolean> {
    const to = digitsOf(phone);
    const text = message.trim();
    if (to === '' || Array.from(text).length < 2) return false;
    try {
      const catalog = await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.catalogs.first(tx, orgId),
      );
      if (!catalog || !catalog.catalogId) return false;
      const meta = asMeta(catalog.metaJson);
      if (meta.concierge_enabled !== true) return false;

      const intent = extractIntent(text);
      if (!looksLikeProductQuery(intent)) return false;

      // Anti-flood. A cache that is down answers "no": better silent than a flood.
      const first = await this.redis.set(
        `catalog_concierge:${orgId}:${to}`,
        '1',
        'EX',
        CONCIERGE_COOLDOWN_SECONDS,
        'NX',
      );
      if (first !== 'OK') return false;

      const settings = readAutomation(catalog.metaJson);
      const products = await this.search(orgId, intent, settings.conciergeMax);
      const binding = this.bindings.of(catalog);

      if (products.length === 0) {
        if (!settings.conciergeReplyOnEmpty) return false;
        await this.provider.sendText(
          binding,
          to,
          settings.conciergeEmptyText ?? CONCIERGE_DEFAULT_EMPTY,
        );
        return true;
      }
      const footer =
        typeof meta.concierge_footer === 'string' && meta.concierge_footer !== ''
          ? meta.concierge_footer
          : null;
      await this.provider.sendMPM(
        binding,
        to,
        settings.conciergeHeader ?? CONCIERGE_DEFAULT_HEADER,
        conciergeBody(products.length, text),
        [
          {
            title: 'Top matches',
            productRetailerIds: products.map((p) => shareRetailerId(p, p.variants)),
          },
        ],
        footer,
      );
      return true;
    } catch (err) {
      this.logger.warn(
        { orgId, err: err instanceof Error ? err.message : 'failed' },
        'concierge failed',
      );
      return false;
    }
  }

  /** Active products inside the price band that match any keyword in name, description, category or brand, ranked. */
  async search(orgId: number, intent: Intent, limit: number): Promise<ProductRow[]> {
    const conditions: SQL[] = [];
    if (intent.priceMin !== null)
      conditions.push(sql`AND p.price_minor >= ${intent.priceMin * 100}`);
    if (intent.priceMax !== null)
      conditions.push(sql`AND p.price_minor <= ${intent.priceMax * 100}`);
    if (intent.keywords.length > 0) {
      const any = intent.keywords.map((kw) => {
        const like = `%${escapeLike(kw)}%`;
        return sql`(p.name ILIKE ${like} OR p.description ILIKE ${like} OR p.category ILIKE ${like} OR p.brand ILIKE ${like}
          OR EXISTS (SELECT 1 FROM wa_product_variants v WHERE v.org_id = p.org_id AND v.product_id = p.id AND v.active
                       AND (v.title ILIKE ${like} OR v.sku ILIKE ${like})))`;
      });
      conditions.push(sql`AND (${sql.join(any, sql` OR `)})`);
    }
    const rows = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT ${PRODUCT_SELECT}
        FROM wa_products p LEFT JOIN wa_storefronts sf ON sf.org_id = p.org_id AND sf.id = p.storefront_id
        WHERE p.org_id = ${orgId} AND p.status = 'active' ${sql.join(conditions, sql` `)}
        ORDER BY p.id
        LIMIT ${Math.max(limit * 3, 60)}`);
      return this.productsRepo.withVariants(
        tx,
        orgId,
        (res.rows as Array<Record<string, unknown>>).map(toProductRow),
      );
    });
    return rankProducts(rows, intent.keywords, limit);
  }
}
