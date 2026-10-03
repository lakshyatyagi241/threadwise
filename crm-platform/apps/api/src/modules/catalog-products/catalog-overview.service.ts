import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  CatalogActivityQuery,
  CatalogActivityResponse,
  CatalogOverview,
  CatalogSendOptions,
  CatalogSendOptionsQuery,
  CatalogSender,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import {
  AUDIENCE_DIRECTORY,
  SENDER_DIRECTORY,
  SHOP_DIRECTORY,
  type AudienceDirectory,
  type CatalogSenderRow,
  type SenderDirectory,
  type ShopDirectory,
  type ShopRow,
} from './_shims/tokens';
import { CatalogSendsRepository } from './catalog-sends.repository';
import { CatalogSyncRepository } from './catalog-sync.repository';
import { CatalogsRepository } from './catalogs.repository';
import { toCatalogSummary } from './catalogs.mapper';
import { toProductResponse } from './products.mapper';
import { ProductsRepository } from './products.repository';

/** Contacts the Send tab can pick one by one. Reference shipped every contact to the browser; the rest is reachable by search or by group. */
export const SEND_CONTACTS_CAP = 500;

export const toSender = (s: CatalogSenderRow): CatalogSender => ({
  key: s.key,
  engine: s.engine,
  label: s.label,
  phone: s.phone,
});
export const toShop = (s: ShopRow) => ({ id: s.uuid, shopName: s.shopName, slug: s.slug });

/** The reads behind the four tabs (TW-CAT-008, 014, 016): one call per screen. */
@Injectable()
export class CatalogOverviewService {
  constructor(
    private readonly db: DatabaseService,
    private readonly catalogs: CatalogsRepository,
    private readonly sync: CatalogSyncRepository,
    private readonly products: ProductsRepository,
    private readonly sends: CatalogSendsRepository,
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
    @Inject(SHOP_DIRECTORY) private readonly shops: ShopDirectory,
    @Inject(AUDIENCE_DIRECTORY) private readonly audience: AudienceDirectory,
  ) {}

  /** The Setup tab. A workspace with no catalog gets everything but the catalog itself, so the connect form is always reachable. */
  async overview(): Promise<CatalogOverview> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const catalog = await this.catalogs.first(tx, ctx.orgId);
      const senders = await this.senders.list(tx, ctx.orgId);
      const buckets = await this.sync.buckets(tx, ctx.orgId);
      const setCount = await tx.execute(
        sql`SELECT count(*) AS c FROM wa_product_sets WHERE org_id = ${ctx.orgId}`,
      );
      return {
        catalog: catalog ? toCatalogSummary(catalog) : null,
        shops: (await this.shops.list(tx, ctx.orgId)).map(toShop),
        statusBuckets: buckets,
        totalProducts: Object.values(buckets).reduce((a, b) => a + b, 0),
        products: (await this.sync.recent(tx, ctx.orgId, 50)).map(toProductResponse),
        health: await this.sync.health(tx, ctx.orgId),
        recentSends: await this.sends.recent(tx, ctx.orgId, 5),
        senders: senders.map(toSender),
        hasSender: senders.length > 0,
        sets: Number((setCount.rows[0] as Record<string, unknown>).c),
      };
    });
  }

  async sendOptions(query: CatalogSendOptionsQuery): Promise<CatalogSendOptions> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const senders = await this.senders.list(tx, ctx.orgId);
      const [groups, contacts] = await Promise.all([
        this.audience.groups(tx, ctx.orgId),
        this.audience.contacts(tx, ctx.orgId, { q: query.q, limit: SEND_CONTACTS_CAP }),
      ]);
      return {
        senders: senders.map(toSender),
        shops: (await this.shops.list(tx, ctx.orgId)).map(toShop),
        groups: groups.map((g) => ({ id: g.uuid, name: g.name, count: g.count })),
        contacts: contacts.map((c) => ({ id: c.uuid, name: c.name, mobile: c.mobile })),
        recentSends: await this.sends.recent(tx, ctx.orgId, 10),
        totalProducts: await this.products.countAll(tx, ctx.orgId),
        connected: senders.length > 0,
      };
    });
  }

  async activity(query: CatalogActivityQuery): Promise<CatalogActivityResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => ({
      data: await this.sends.recent(tx, ctx.orgId, query.limit),
    }));
  }
}
