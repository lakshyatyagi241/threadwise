import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import {
  SHOPIFY,
  WOOCOMMERCE,
  type ShopifyFactory,
  type StoreRead,
  type WooFactory,
} from '../../infra/providers/ecom/ecom.port';
import { QUEUES } from '../../infra/queue/queues';
import { STORE_MIRROR, type StoreMirror } from './_shims/tokens';
import {
  shopifyCustomer,
  shopifyOrder,
  shopifyProduct,
  wooCustomer,
  wooOrder,
  wooProduct,
  type MirrorCustomer,
  type MirrorOrder,
  type MirrorProduct,
  type StoreKind,
} from './mirror-rules';
import { StoresRepository } from './stores.repository';
import { readWooProducts } from './woo-variations';

export interface ImportJob {
  orgId: number;
  kind: StoreKind;
  /** The integration row's id. */
  id: number;
}

/** What one import brought in. `incomplete` is 1 when a resource was cut short by the page cap or a store that stopped answering. */
export type ImportStats = Record<'products' | 'orders' | 'customers' | 'incomplete', number>;

interface Source {
  storeUrl: string;
  currency: string | null;
  userId: number | null;
  groupKey: 'shopify_group_id' | 'woo_group_id';
  cachedGroup: number | null;
  read: {
    products: () => Promise<StoreRead>;
    orders: () => Promise<StoreRead>;
    customers: () => Promise<StoreRead>;
  };
  product: (r: Record<string, unknown>) => MirrorProduct;
  order: (r: Record<string, unknown>) => MirrorOrder;
  customer: (r: Record<string, unknown>) => MirrorCustomer | null;
}

/**
 * Mirrors a connected store into the CRM (TW-ECOM-011): products to the catalog, orders to the checkout orders, customers with a
 * phone to contacts in the store's group. Idempotent (every row is keyed by the store's id), and a row that cannot be mapped or
 * written is logged and skipped, never stopping the rest. Runs in the worker, not in the request that asked for it.
 *
 * Difference from Reference: every page of a resource is read (up to a cap), where Reference read only the first 250 (Shopify) or 100
 * (WooCommerce) and silently dropped the rest.
 */
@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: StoresRepository,
    private readonly crypto: CryptoService,
    @Inject(SHOPIFY) private readonly shopify: ShopifyFactory,
    @Inject(WOOCOMMERCE) private readonly woo: WooFactory,
    @Inject(STORE_MIRROR) private readonly mirror: StoreMirror,
    @InjectQueue(QUEUES.ECOM_IMPORT) private readonly queue: Queue<ImportJob>,
  ) {}

  /** Queues an import. One import per store at a time: asking again while one waits or runs changes nothing. */
  async enqueue(job: ImportJob): Promise<void> {
    await this.queue.add('import', job, {
      jobId: `ecom-import-${job.kind}-${job.orgId}-${job.id}`,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  private async source(orgId: number, kind: StoreKind, id: number): Promise<Source | null> {
    if (kind === 'shopify') {
      const row = await this.db.txAs({ orgId }, (tx) => this.repo.shopifyById(tx, orgId, id));
      if (!row || row.accessToken === '') return null;
      const api = this.shopify.store(row.storeUrl, this.crypto.decrypt(row.accessToken));
      const meta = row.metadata as { shopify_group_id?: unknown } | null;
      const ctx = { storeUrl: row.storeUrl, currency: row.shopCurrency };
      return {
        storeUrl: row.storeUrl,
        currency: row.shopCurrency,
        userId: row.userId,
        groupKey: 'shopify_group_id',
        cachedGroup: typeof meta?.shopify_group_id === 'number' ? meta.shopify_group_id : null,
        read: {
          products: () => api.products(),
          orders: () => api.orders(),
          customers: () => api.customers(),
        },
        product: (r) => shopifyProduct(r, ctx),
        order: (r) => shopifyOrder(r, ctx),
        customer: shopifyCustomer,
      };
    }
    const row = await this.db.txAs({ orgId }, (tx) => this.repo.wooById(tx, orgId, id));
    if (!row || row.consumerKey === '') return null;
    const api = this.woo.store(
      row.storeUrl,
      this.crypto.decrypt(row.consumerKey),
      this.crypto.decrypt(row.consumerSecret),
    );
    const meta = row.metadata as { woo_group_id?: unknown } | null;
    const ctx = { storeUrl: row.storeUrl, currency: row.storeCurrency };
    return {
      storeUrl: row.storeUrl,
      currency: row.storeCurrency,
      userId: row.userId,
      groupKey: 'woo_group_id',
      cachedGroup: typeof meta?.woo_group_id === 'number' ? meta.woo_group_id : null,
      read: {
        // A variable product's variations are read with it, so each becomes a variant of the product.
        products: () => readWooProducts(api),
        orders: () => api.orders(),
        customers: () => api.customers(),
      },
      product: (r) => wooProduct(r, ctx),
      order: (r) => wooOrder(r, ctx),
      customer: wooCustomer,
    };
  }

  /** Runs one import. A store that is gone or has no credentials left (the app was removed) imports nothing. */
  async run(orgId: number, kind: StoreKind, id: number): Promise<ImportStats> {
    const stats: ImportStats = { products: 0, orders: 0, customers: 0, incomplete: 0 };
    const src = await this.source(orgId, kind, id);
    if (!src) return stats;

    const products = await src.read.products();
    for (const raw of products.items) {
      try {
        const m = src.product(raw);
        if (m.storeId === '') continue;
        await this.db.txAs({ orgId }, (tx) =>
          this.mirror.upsertProduct(tx, orgId, kind, src.userId, m),
        );
        stats.products += 1;
      } catch (err) {
        this.logger.warn({ orgId, kind, product: raw.id, err }, 'import: a product was not stored');
      }
    }

    const orders = await src.read.orders();
    for (const raw of orders.items) {
      try {
        const m = src.order(raw);
        if (m.storeId === '') continue;
        await this.db.txAs({ orgId }, (tx) => this.mirror.upsertOrder(tx, orgId, kind, m));
        stats.orders += 1;
      } catch (err) {
        this.logger.warn({ orgId, kind, order: raw.id, err }, 'import: an order was not stored');
      }
    }

    const customers = await src.read.customers();
    // The group is found or made once, and its id kept on the store so a renamed group is still the one used.
    const groupId = await this.db.txAs({ orgId }, async (tx) => {
      const g = await this.mirror.ensureGroup(tx, orgId, src.userId, kind, src.cachedGroup);
      if (g !== src.cachedGroup)
        await this.repo.mergeMetadata(tx, orgId, kind, id, { [src.groupKey]: g });
      return g;
    });
    for (const raw of customers.items) {
      try {
        const m = src.customer(raw);
        if (!m || m.storeId === '') continue;
        await this.db.txAs({ orgId }, (tx) =>
          this.mirror.upsertCustomer(tx, orgId, src.userId, kind, m, groupId),
        );
        stats.customers += 1;
      } catch (err) {
        this.logger.warn(
          { orgId, kind, customer: raw.id, err },
          'import: a customer was not stored',
        );
      }
    }

    if (!products.complete || !orders.complete || !customers.complete) stats.incomplete = 1;
    await this.db.txAs({ orgId }, (tx) => this.repo.setSynced(tx, orgId, kind, id, stats));
    this.logger.log({ orgId, kind, ...stats }, 'store import done');
    return stats;
  }
}
