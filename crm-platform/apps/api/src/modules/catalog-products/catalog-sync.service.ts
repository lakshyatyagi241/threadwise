import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CATALOG_SYNC_CHUNK,
  type ImportFromMetaResponse,
  type PollBatchesResponse,
  type SyncProductsResponse,
} from '@crm/contracts';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import {
  CATALOG_PROVIDER,
  CatalogProviderError,
  type CatalogBatchItem,
  type CatalogProvider,
} from '../../infra/providers/catalog-products/catalog-provider.port';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { SHOP_DIRECTORY, type ShopDirectory } from './_shims/tokens';
import { CatalogBindings } from './catalog-bindings';
import { currentUserId, withOrgContext } from './catalog-context';
import { CATALOG_MODULE } from './catalog-connection.service';
import { notConnected, providerFailure, providerRefusal } from './catalog-problems';
import { parseMetaPriceMinor } from './catalog-money';
import { metaItemsOf, resolveVariantRetailerIds } from './catalog-variants';
import {
  normalizeImportedAvailability,
  nextFreeSlug,
  retailerIdOf,
  slugify,
  truncateError,
} from './catalog-rules';
import { CatalogSyncRepository } from './catalog-sync.repository';
import { CatalogsRepository, type CatalogRow } from './catalogs.repository';
import { ProductsRepository, type ProductRow } from './products.repository';

const FINISHED = new Set(['finished', 'success', 'completed']);
const FAILED = new Set(['error', 'failed']);

/** The Meta items of a product: one, or one per variant when it has variants (hidden for an inactive one). */
const toItems = (p: ProductRow, shopUrl: string): CatalogBatchItem[] =>
  metaItemsOf({ ...p, galleryUrls: p.gallery }, p.variants, shopUrl);

/** Meta takes up to 5,000 requests in one items_batch; stay well inside it. */
const META_BATCH_ITEMS = 4000;

/**
 * The Meta side of the product list (TW-CAT-009..013): push in chunks, settle the batches, pull a Meta-built catalog down, and
 * keep one product in step after an edit.
 *
 * Every method takes the organization explicitly because the sweeps run without a request. A call to Meta is never made inside
 * a database transaction: the rows are read, Meta is called, and the status is written in a second short transaction.
 */
@Injectable()
export class CatalogSyncService {
  private readonly logger = new Logger(CatalogSyncService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly catalogs: CatalogsRepository,
    private readonly repo: CatalogSyncRepository,
    private readonly products: ProductsRepository,
    private readonly bindings: CatalogBindings,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(CATALOG_PROVIDER) private readonly provider: CatalogProvider,
    @Inject(SHOP_DIRECTORY) private readonly shops: ShopDirectory,
  ) {}

  private tx<T>(orgId: number, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.txAs({ orgId, userId: RequestContextStore.peek()?.userId ?? null }, fn);
  }

  private async shopUrl(tx: Tx, orgId: number): Promise<string> {
    return (await this.shops.list(tx, orgId))[0]?.publicUrl ?? '';
  }

  // --- push (TW-CAT-009) --------------------------------------------------------------------------------------------------

  /**
   * One chunk of at most 1000 active products to Meta. `uuids` pushes exactly those (the per-row "Sync" link); without it, the
   * products never pushed or failed. The screen calls again while `hasMore`.
   */
  async syncChunk(orgId: number, uuids?: readonly string[]): Promise<SyncProductsResponse> {
    const pushed = await this.pushChunk(orgId, uuids, true);
    return this.tx(orgId, async (tx) => ({
      pushed: pushed.pushed,
      hasMore: (await this.repo.countUnpushed(tx, orgId)) > 0,
      ...(await this.counts(tx, orgId)),
    }));
  }

  private async counts(tx: Tx, orgId: number) {
    const b = await this.repo.buckets(tx, orgId);
    return {
      totalPending: b.pending ?? 0,
      totalSynced: b.synced ?? 0,
      totalFailed: b.failed ?? 0,
    };
  }

  /** The shared push: select, call Meta, flip the status. Throws on a Meta failure after marking the chunk failed. */
  private async pushChunk(
    orgId: number,
    uuids: readonly string[] | undefined,
    audited: boolean,
  ): Promise<{ pushed: number }> {
    const plan = await this.tx(orgId, async (tx) => {
      const catalog = await this.catalogs.first(tx, orgId);
      if (!catalog || !catalog.catalogId) throw notConnected();
      const rows = await this.products.withVariants(
        tx,
        orgId,
        await this.repo.selectForPush(tx, orgId, { uuids, limit: CATALOG_SYNC_CHUNK }),
      );
      return { catalog, rows, shopUrl: await this.shopUrl(tx, orgId) };
    });
    if (plan.rows.length === 0) {
      this.logger.debug(
        { orgId, mode: uuids ? 'explicit_ids' : 'unsynced+failed' },
        'catalog push: nothing to send',
      );
      return { pushed: 0 };
    }

    let handles: string[];
    // A product with variants is several items; its handle is the one of its first item.
    const firstItem: number[] = [];
    try {
      const items: CatalogBatchItem[] = [];
      for (const p of plan.rows) {
        firstItem.push(items.length);
        items.push(...toItems(p, plan.shopUrl));
      }
      handles = [];
      for (let i = 0; i < items.length; i += META_BATCH_ITEMS) {
        handles.push(
          ...(await this.provider.upsertProductsBatch(
            this.bindings.of(plan.catalog),
            items.slice(i, i + META_BATCH_ITEMS),
          )),
        );
      }
    } catch (err) {
      if (!(err instanceof CatalogProviderError)) throw err;
      await this.tx(orgId, (tx) =>
        this.repo.markFailed(
          tx,
          orgId,
          plan.rows.map((r) => r.id),
          truncateError(err.message),
        ),
      );
      throw providerFailure(err, [{ path: 'pushedFailed', message: String(plan.rows.length) }]);
    }

    await withOrgContext(orgId, () =>
      this.tx(orgId, async (tx) => {
        // Meta may answer fewer handles than rows sent: those rows keep a null handle and are re-queued by the next push.
        await this.repo.markPending(
          tx,
          orgId,
          plan.rows.map((p, i) => ({
            id: p.id,
            handle: handles[firstItem[i]!] ?? null,
            retailerId: retailerIdOf(p),
          })),
        );
        if (audited) {
          await this.audit.record(tx, {
            module: CATALOG_MODULE,
            recordId: plan.catalog.id,
            action: 'update',
            delta: { pushed: { old: null, new: plan.rows.length } },
          });
          await this.outbox.emit(tx, {
            aggregateModule: CATALOG_MODULE,
            aggregateId: plan.catalog.id,
            eventType: 'catalog.products_pushed',
            payload: { uuid: plan.catalog.uuid, count: plan.rows.length },
          });
        }
      }),
    );
    return { pushed: plan.rows.length };
  }

  /** The sweep's push: same rules, no audit row (nobody asked), a failure is returned instead of thrown. */
  async flushWorkspace(
    orgId: number,
  ): Promise<{ skipped: boolean; pushed: number; error?: string }> {
    const has = await this.tx(orgId, (tx) => this.catalogs.first(tx, orgId));
    if (!has || !has.catalogId) return { skipped: true, pushed: 0 };
    try {
      return { skipped: false, ...(await this.pushChunk(orgId, undefined, false)) };
    } catch (err) {
      return {
        skipped: false,
        pushed: 0,
        error: err instanceof Error ? err.message : 'push failed',
      };
    }
  }

  // --- poll (TW-CAT-010) --------------------------------------------------------------------------------------------------

  /**
   * Asks Meta about every outstanding handle and settles the rows. `strict` (the button) answers a Meta failure with a problem;
   * the sweep (not strict) logs it and reports zeros, as Reference's headless twin did.
   */
  async pollWorkspace(orgId: number, strict: boolean): Promise<PollBatchesResponse> {
    const zero: PollBatchesResponse = { pending: 0, synced: 0, failed: 0 };
    const plan = await this.tx(orgId, async (tx) => {
      const catalog = await this.catalogs.first(tx, orgId);
      if (!catalog || !catalog.catalogId) {
        if (strict) throw notConnected();
        return null;
      }
      return { catalog, pending: await this.repo.pendingWithHandle(tx, orgId) };
    });
    if (!plan || plan.pending.length === 0) return zero;

    let rows;
    try {
      rows = await this.provider.checkBatchStatus(this.bindings.of(plan.catalog), [
        ...new Set(plan.pending.map((p) => p.handle)),
      ]);
    } catch (err) {
      if (!(err instanceof CatalogProviderError)) throw err;
      if (strict) throw providerFailure(err);
      this.logger.warn({ orgId, err: err.message }, 'catalog poll failed');
      return zero;
    }

    const byHandle = new Map(rows.map((r) => [r.handle, r]));
    const out = { pending: 0, synced: 0, failed: 0 };
    const synced: number[] = [];
    const failed: Array<{ id: number; error: string }> = [];
    for (const p of plan.pending) {
      const row = byHandle.get(p.handle);
      if (!row) {
        out.pending++;
        continue;
      }
      const status = row.status.toLowerCase();
      if (FINISHED.has(status)) {
        synced.push(p.id);
        out.synced++;
      } else if (FAILED.has(status)) {
        failed.push({ id: p.id, error: truncateError(row.errors[0]?.message || 'unknown') });
        out.failed++;
      } else {
        out.pending++;
      }
    }

    await withOrgContext(orgId, () =>
      this.tx(orgId, async (tx) => {
        await this.repo.markSynced(tx, orgId, synced);
        await this.repo.markPollFailed(tx, orgId, failed);
        if (strict && (out.synced > 0 || out.failed > 0)) {
          await this.audit.record(tx, {
            module: CATALOG_MODULE,
            recordId: plan.catalog.id,
            action: 'update',
            delta: {
              polled: {
                old: null,
                new: `synced ${out.synced}, failed ${out.failed}, pending ${out.pending}`,
              },
            },
          });
        }
      }),
    );
    return out;
  }

  // --- import (TW-CAT-011) ------------------------------------------------------------------------------------------------

  /**
   * Pulls the products of the Meta catalog down. Existing rows (matched by retailer id) are updated, new ones created, all
   * marked synced; the import never re-pushes what it just read. One transaction, so a failure leaves nothing half imported
   * (Reference left partial imports).
   */
  async importFromMeta(orgId: number): Promise<ImportFromMetaResponse> {
    const userId = currentUserId();
    const catalog = await this.tx(orgId, (tx) => this.catalogs.first(tx, orgId));
    if (!catalog) throw notConnected();

    let listed;
    try {
      listed = await this.provider.listProducts(this.bindings.of(catalog));
    } catch (err) {
      if (err instanceof CatalogProviderError) throw providerRefusal(err);
      throw err;
    }

    return this.tx(orgId, async (tx) => {
      let imported = 0;
      let updated = 0;
      let skipped = 0;
      const ownItems = await this.ownVariantItems(
        tx,
        orgId,
        listed.map((r) => r.retailerId.trim()),
      );
      // One read for every product Meta lists that we already hold, and one for their variants, not two queries per item.
      const held = await this.repo.findByRetailerIds(
        tx,
        orgId,
        listed.map((r) => r.retailerId.trim()).filter((id) => id !== ''),
      );
      const heldWithVariants = new Map(
        (await this.products.withVariants(tx, orgId, [...held.values()])).map((p) => [
          p.metaRetailerId ?? '',
          p,
        ]),
      );
      const created = new Set<string>(); // retailer ids this run inserted: a repeat of one reads the row we just made
      for (const r of listed) {
        const retailer = r.retailerId.trim();
        const name = r.name.trim();
        if (retailer === '' || name === '') {
          skipped++;
          continue;
        }
        const priceMinor = parseMetaPriceMinor(r.price, r.currency);
        const availRaw = (r.availability ?? '').toLowerCase();
        const attrs = {
          name,
          description: r.description,
          image_url: r.imageUrl || null,
          product_url: r.url || null,
          availability: normalizeImportedAvailability(r.availability),
          in_stock: !availRaw.includes('out'),
          status: 'active',
          meta_retailer_id: retailer,
          meta_sync_status: 'synced',
          meta_synced_at: new Date(),
          meta_last_error: null,
          meta_batch_handle: null,
          ...(priceMinor !== null ? { price_minor: priceMinor } : {}),
        };
        // An item this workspace pushed as a variant, or the hidden item of a product that has variants, is not a new product.
        if (ownItems.variantIds.has(retailer)) {
          skipped++;
          continue;
        }
        let existing = heldWithVariants.get(retailer);
        if (!existing && created.has(retailer)) {
          // The same retailer id twice in one listing: the first made the product, so the second updates it.
          const again = (await this.repo.findByRetailerIds(tx, orgId, [retailer])).get(retailer);
          existing = again ? (await this.products.withVariants(tx, orgId, [again]))[0] : undefined;
        }
        if (existing && ownItems.withVariants.has(existing.id)) {
          skipped++;
          continue;
        }
        if (existing && existing.variants.length > 0) {
          // Its own item is the hidden twin of the product-with-variants: Meta must not overwrite the aggregate.
          skipped++;
          continue;
        }
        if (existing) {
          // A currency Meta did not send never overwrites the one the operator set.
          await this.products.update(tx, orgId, existing.id, undefined, {
            ...attrs,
            ...(r.currency ? { currency_code: r.currency } : {}),
          });
          updated++;
        } else {
          const base = slugify(name) || 'product';
          const slug = nextFreeSlug(base, await this.products.slugsLike(tx, orgId, base));
          await this.products.insert(tx, orgId, {
            ...attrs,
            slug,
            user_id: userId,
            sku: retailer,
            price_minor: priceMinor ?? 0,
            ...(r.currency ? { currency_code: r.currency } : {}),
          });
          created.add(retailer);
          imported++;
        }
      }
      await this.audit.record(tx, {
        module: CATALOG_MODULE,
        recordId: catalog.id,
        action: 'update',
        delta: {
          imported: {
            old: null,
            new: `imported ${imported}, updated ${updated}, skipped ${skipped}`,
          },
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: CATALOG_MODULE,
        aggregateId: catalog.id,
        eventType: 'catalog.products_imported',
        payload: { uuid: catalog.uuid, imported, updated, skipped, total: listed.length },
      });
      return { imported, updated, skipped, total: listed.length };
    });
  }

  /** Which of these Meta retailer ids are variants of ours, and which products have variants (their own item is only a placeholder). */
  private async ownVariantItems(
    tx: Tx,
    orgId: number,
    ids: readonly string[],
  ): Promise<{ variantIds: Set<string>; withVariants: Set<number> }> {
    const variantIds = new Set((await resolveVariantRetailerIds(tx, orgId, ids)).keys());
    const withVariants = new Set<number>();
    const res = await tx.execute(
      sql`SELECT DISTINCT product_id FROM wa_product_variants WHERE org_id = ${orgId}`,
    );
    for (const r of res.rows as Array<{ product_id: number | string }>)
      withVariants.add(Number(r.product_id));
    return { variantIds, withVariants };
  }

  // --- auto-sync (TW-CAT-012) ---------------------------------------------------------------------------------------------

  /**
   * Pushes one product after its create or edit committed. Never throws: any failure (Meta, network, database) marks the row
   * failed with the message and is logged, and the save that caused it is already committed.
   *
   * Reference did this from a model observer, inline in the save; here the write transaction emits `catalog.product_changed`
   * (the durable hook a consumer can subscribe to) and the service calls this after the commit, because a call to Meta must not
   * run inside a database transaction. There is no outbox subscriber registry yet, so this direct call is the delivery.
   */
  async pushOne(orgId: number, productId: number): Promise<void> {
    try {
      const plan = await this.tx(orgId, async (tx) => {
        const catalog: CatalogRow | undefined = await this.catalogs.first(tx, orgId);
        if (!catalog || !catalog.catalogId) return null;
        const product = await this.products.findById(tx, orgId, productId);
        if (!product || product.status !== 'active') return null;
        return { catalog, product, shopUrl: await this.shopUrl(tx, orgId) };
      });
      if (!plan) return;
      try {
        const handles = await this.provider.upsertProductsBatch(
          this.bindings.of(plan.catalog),
          toItems(plan.product, plan.shopUrl),
        );
        await this.tx(orgId, (tx) =>
          this.repo.markPending(tx, orgId, [
            { id: productId, handle: handles[0] ?? null, retailerId: retailerIdOf(plan.product) },
          ]),
        );
      } catch (err) {
        await this.tx(orgId, (tx) =>
          this.repo.markFailed(
            tx,
            orgId,
            [productId],
            truncateError(err instanceof Error ? err.message : 'push failed'),
          ),
        );
        this.logger.warn(
          { orgId, productId, err: err instanceof Error ? err.message : 'failed' },
          'auto-push failed',
        );
      }
    } catch (err) {
      this.logger.warn(
        { orgId, productId, err: err instanceof Error ? err.message : 'failed' },
        'auto-push could not record its failure',
      );
    }
  }

  // --- the sweep (TW-CAT-013) ---------------------------------------------------------------------------------------------

  /** One catalog: push the dirty products in one batch, then settle the pending rows. Per-organization errors never escape. */
  async resyncOrg(orgId: number, opts: { pollOnly?: boolean } = {}) {
    return withOrgContext(orgId, async () => {
      const push = opts.pollOnly ? { skipped: false, pushed: 0 } : await this.flushWorkspace(orgId);
      const poll = await this.pollWorkspace(orgId, false);
      return { orgId, ...push, ...poll };
    });
  }
}
