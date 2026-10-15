import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  CATALOG_SEND_MAX_PRODUCTS,
  ERROR_CODES,
  formatProductMoney,
  type CollectionResponse,
  type CreateCollectionInput,
  type ListCollectionsResponse,
  type UpdateCollectionInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  CATALOG_PROVIDER,
  CatalogProviderError,
  type CatalogProvider,
} from '../../infra/providers/catalog-products/catalog-provider.port';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { CatalogBindings } from './catalog-bindings';
import { notConnected, providerRefusal } from './catalog-problems';
import { CatalogsRepository } from './catalogs.repository';
import { nextFreeSlug, ownedInSubmittedOrder, retailerIdOf, slugify } from './catalog-rules';
import { ProductsRepository, type ProductRow } from './products.repository';

export const COLLECTION_MODULE = 'product_sets';

interface SetRow {
  id: number;
  uuid: string;
  name: string;
  slug: string | null;
  description: string | null;
  productIds: number[];
  isActive: boolean;
  metaSetId: string | null;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

type Raw = Record<string, unknown>;

const toRow = (r: Raw): SetRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  name: r.name as string,
  slug: (r.slug as string | null) ?? null,
  description: (r.description as string | null) ?? null,
  productIds: (Array.isArray(r.product_ids) ? r.product_ids : [])
    .map(Number)
    .filter(Number.isFinite),
  isActive: r.is_active === true,
  metaSetId: (r.meta_set_id as string | null) ?? null,
  rowVersion: Number(r.row_version),
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
});

const COLUMNS = sql`id, uuid, name, slug, description, product_ids, is_active, meta_set_id, row_version, created_at, updated_at`;

/**
 * Collections (TW-CAT-017, 018): a saved, ordered group of up to 30 products that is sent as one list message. The stored order
 * is the order of the message; ids that are not this workspace's are dropped, and a set left with none is refused.
 */
@Injectable()
export class CollectionsService {
  private readonly logger = new Logger(CollectionsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly products: ProductsRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly catalogs: CatalogsRepository,
    private readonly bindings: CatalogBindings,
    @Inject(CATALOG_PROVIDER) private readonly provider: CatalogProvider,
  ) {}

  private async members(
    tx: Tx,
    orgId: number,
    ids: readonly number[],
  ): Promise<Map<number, ProductRow>> {
    return new Map((await this.products.findByIds(tx, orgId, ids)).map((p) => [p.id, p]));
  }

  private toResponse(set: SetRow, byId: Map<number, ProductRow>): CollectionResponse {
    const products = set.productIds
      .map((id) => byId.get(id))
      .filter((p): p is ProductRow => p !== undefined)
      .slice(0, CATALOG_SEND_MAX_PRODUCTS);
    return {
      id: set.uuid,
      name: set.name,
      slug: set.slug,
      description: set.description,
      isActive: set.isActive,
      // The stored ids, stale ones included (Reference's `product_count`).
      productCount: set.productIds.length,
      metaSetId: set.metaSetId,
      products: products.map((p) => ({
        id: p.uuid,
        name: p.name,
        sku: p.sku,
        imageUrl: p.imageUrl,
        priceDisplay: formatProductMoney(p.priceMinor, p.currencyCode),
        retailerId: retailerIdOf(p),
        active: p.status === 'active',
      })),
      rowVersion: set.rowVersion,
      createdAt: set.createdAt.toISOString(),
      updatedAt: set.updatedAt.toISOString(),
    };
  }

  async list(): Promise<ListCollectionsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT ${COLUMNS} FROM wa_product_sets WHERE org_id = ${ctx.orgId} ORDER BY id DESC`,
      );
      const sets = (res.rows as Raw[]).map(toRow);
      const byId = await this.members(tx, ctx.orgId, [
        ...new Set(sets.flatMap((s) => s.productIds)),
      ]);
      const pick = await tx.execute(sql`
        SELECT p.uuid, p.name, p.sku, p.image_url, p.price_minor, p.currency_code
        FROM wa_products p WHERE p.org_id = ${ctx.orgId} AND p.status = 'active'
        ORDER BY p.name, p.id LIMIT 300`);
      return {
        data: sets.map((s) => this.toResponse(s, byId)),
        pickProducts: (pick.rows as Raw[]).map((r) => ({
          id: r.uuid as string,
          name: r.name as string,
          sku: (r.sku as string | null) ?? null,
          imageUrl: (r.image_url as string | null) ?? null,
          priceDisplay: formatProductMoney(Number(r.price_minor), r.currency_code as string),
        })),
        totalProducts: await this.products.countAll(tx, ctx.orgId),
      };
    });
  }

  private async resolveIds(
    tx: Tx,
    orgId: number,
    productIds: readonly string[],
  ): Promise<number[]> {
    const owned = await this.products.findByUuids(tx, orgId, productIds);
    const ordered = ownedInSubmittedOrder(productIds, owned);
    if (ordered.length === 0) {
      throw new AppError(
        ERROR_CODES.CAT_COLLECTION_PRODUCTS_INVALID,
        'None of the selected products belong to this workspace.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [
          {
            path: 'productIds',
            message: 'None of the selected products belong to this workspace.',
          },
        ],
      );
    }
    return ordered.map((p) => p.id);
  }

  private async freeSlug(tx: Tx, orgId: number, name: string, excludeId?: number): Promise<string> {
    const base = slugify(name) || 'set';
    const res = await tx.execute(sql`
      SELECT slug FROM wa_product_sets
      WHERE org_id = ${orgId} AND slug IS NOT NULL AND (slug = ${base} OR slug LIKE ${`${base}-%`})
        ${excludeId !== undefined ? sql`AND id <> ${excludeId}` : sql``}`);
    return nextFreeSlug(base, new Set((res.rows as Raw[]).map((r) => r.slug as string)));
  }

  async create(input: CreateCollectionInput): Promise<CollectionResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const ids = await this.resolveIds(tx, ctx.orgId, input.productIds);
      const slug = await this.freeSlug(tx, ctx.orgId, input.name);
      const res = await tx.execute(sql`
        INSERT INTO wa_product_sets (org_id, user_id, name, slug, description, product_ids, is_active)
        VALUES (${ctx.orgId}, ${ctx.userId}, ${input.name}, ${slug}, ${input.description?.trim() || null},
                ${JSON.stringify(ids)}::jsonb, ${input.isActive})
        RETURNING ${COLUMNS}`);
      const set = toRow(res.rows[0] as Raw);
      await this.audit.record(tx, {
        module: COLLECTION_MODULE,
        recordId: set.id,
        action: 'insert',
        delta: { name: { old: null, new: set.name }, productCount: { old: null, new: ids.length } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: COLLECTION_MODULE,
        aggregateId: set.id,
        eventType: 'product_set.created',
        payload: { uuid: set.uuid, name: set.name, productCount: ids.length },
      });
      return this.toResponse(set, await this.members(tx, ctx.orgId, ids));
    });
  }

  async update(uuid: string, input: UpdateCollectionInput): Promise<CollectionResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const found = await tx.execute(sql`
        SELECT ${COLUMNS} FROM wa_product_sets WHERE org_id = ${ctx.orgId} AND uuid = ${uuid}::uuid FOR UPDATE`);
      if (!found.rows[0]) throw AppError.notFound('Collection', uuid);
      const before = toRow(found.rows[0] as Raw);
      if (input.rowVersion !== undefined && input.rowVersion !== before.rowVersion) {
        throw AppError.rowVersionConflict('Collection');
      }
      const ids = await this.resolveIds(tx, ctx.orgId, input.productIds);
      // The slug follows the name only when the name changed.
      const slug =
        before.name === input.name
          ? before.slug
          : await this.freeSlug(tx, ctx.orgId, input.name, before.id);
      const res = await tx.execute(sql`
        UPDATE wa_product_sets
        SET name = ${input.name}, slug = ${slug}, description = ${input.description?.trim() || null},
            product_ids = ${JSON.stringify(ids)}::jsonb, is_active = ${input.isActive}
        WHERE org_id = ${ctx.orgId} AND id = ${before.id}
        RETURNING ${COLUMNS}`);
      const set = toRow(res.rows[0] as Raw);
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      if (before.name !== set.name) delta.name = { old: before.name, new: set.name };
      if (before.isActive !== set.isActive)
        delta.isActive = { old: before.isActive, new: set.isActive };
      if (JSON.stringify(before.productIds) !== JSON.stringify(ids)) {
        delta.productCount = { old: before.productIds.length, new: ids.length };
      }
      await this.audit.record(tx, {
        module: COLLECTION_MODULE,
        recordId: set.id,
        action: 'update',
        delta,
      });
      await this.outbox.emit(tx, {
        aggregateModule: COLLECTION_MODULE,
        aggregateId: set.id,
        eventType: 'product_set.updated',
        payload: { uuid: set.uuid, changed: Object.keys(delta) },
      });
      return this.toResponse(set, await this.members(tx, ctx.orgId, ids));
    });
  }

  /** Deleting a missing collection is a success (Reference was silent); the products are untouched. */
  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.dropFromMetaQuietly(ctx.orgId, uuid);
    await this.db.tx(async (tx) => {
      const found = await tx.execute(sql`
        SELECT ${COLUMNS} FROM wa_product_sets WHERE org_id = ${ctx.orgId} AND uuid = ${uuid}::uuid FOR UPDATE`);
      if (!found.rows[0]) return;
      const set = toRow(found.rows[0] as Raw);
      await this.audit.record(tx, {
        module: COLLECTION_MODULE,
        recordId: set.id,
        action: 'delete',
        delta: { name: { old: set.name, new: null } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: COLLECTION_MODULE,
        aggregateId: set.id,
        eventType: 'product_set.deleted',
        payload: { uuid: set.uuid, name: set.name },
      });
      await tx.execute(
        sql`DELETE FROM wa_product_sets WHERE org_id = ${ctx.orgId} AND id = ${set.id}`,
      );
    });
  }

  // --- the same collection as a product set on Meta ------------------------------------------------------------------------

  private async loadForMeta(uuid: string) {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const found = await tx.execute(sql`
        SELECT ${COLUMNS} FROM wa_product_sets WHERE org_id = ${ctx.orgId} AND uuid = ${uuid}::uuid`);
      if (!found.rows[0]) throw AppError.notFound('Collection', uuid);
      const set = toRow(found.rows[0] as Raw);
      const catalog = await this.catalogs.first(tx, ctx.orgId);
      return { ctx, set, catalog, members: await this.members(tx, ctx.orgId, set.productIds) };
    });
  }

  /**
   * Creates the collection as a product set on Meta (or updates it when it was pushed before) and keeps Meta's id. The set holds the
   * products whose retailer id is in the collection. Meta first: a refusal changes nothing here.
   */
  async pushToMeta(uuid: string): Promise<CollectionResponse> {
    const { ctx, set, catalog, members } = await this.loadForMeta(uuid);
    if (!catalog) throw notConnected();
    const retailerIds = set.productIds
      .map((id) => members.get(id))
      .filter((p): p is ProductRow => p !== undefined && p.status === 'active')
      .map((p) => retailerIdOf(p));
    if (retailerIds.length === 0) {
      throw new AppError(
        ERROR_CODES.CAT_SET_NOT_SYNCABLE,
        'This collection has no active products to put in a Meta product set.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const binding = this.bindings.of(catalog);
    let metaSetId: string;
    try {
      metaSetId = await this.writeSet(binding, set, retailerIds);
    } catch (err) {
      if (err instanceof CatalogProviderError) throw providerRefusal(err);
      throw err;
    }
    return this.db.tx(async (tx) => {
      await tx.execute(sql`
        UPDATE wa_product_sets SET meta_set_id = ${metaSetId}
        WHERE org_id = ${ctx.orgId} AND id = ${set.id}`);
      await this.audit.record(tx, {
        module: COLLECTION_MODULE,
        recordId: set.id,
        action: 'update',
        delta: { metaSetId: { old: set.metaSetId, new: metaSetId } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: COLLECTION_MODULE,
        aggregateId: set.id,
        eventType: 'product_set.pushed',
        payload: { uuid: set.uuid, metaSetId, productCount: retailerIds.length },
      });
      return this.toResponse({ ...set, metaSetId }, members);
    });
  }

  /** Updates the set when this collection has one on Meta; if Meta no longer has it (code 100), creates a fresh one. */
  private async writeSet(
    binding: ReturnType<CatalogBindings['of']>,
    set: SetRow,
    retailerIds: readonly string[],
  ): Promise<string> {
    if (set.metaSetId) {
      try {
        await this.provider.updateProductSet(binding, set.metaSetId, set.name, retailerIds);
        return set.metaSetId;
      } catch (err) {
        if (!(err instanceof CatalogProviderError) || err.meta.code !== 100) throw err;
      }
    }
    return this.provider.createProductSet(binding, set.name, retailerIds);
  }

  /** Removes the product set from Meta and forgets its id; the collection itself stays. */
  async removeFromMeta(uuid: string): Promise<CollectionResponse> {
    const { ctx, set, catalog, members } = await this.loadForMeta(uuid);
    if (set.metaSetId && catalog) {
      try {
        await this.provider.deleteProductSet(this.bindings.of(catalog), set.metaSetId);
      } catch (err) {
        // Already gone on Meta (code 100) is the state we wanted; anything else is surfaced.
        if (!(err instanceof CatalogProviderError)) throw err;
        if (err.meta.code !== 100) throw providerRefusal(err);
      }
    }
    return this.db.tx(async (tx) => {
      await tx.execute(sql`
        UPDATE wa_product_sets SET meta_set_id = NULL
        WHERE org_id = ${ctx.orgId} AND id = ${set.id}`);
      await this.audit.record(tx, {
        module: COLLECTION_MODULE,
        recordId: set.id,
        action: 'update',
        delta: { metaSetId: { old: set.metaSetId, new: null } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: COLLECTION_MODULE,
        aggregateId: set.id,
        eventType: 'product_set.unpushed',
        payload: { uuid: set.uuid },
      });
      return this.toResponse({ ...set, metaSetId: null }, members);
    });
  }

  /** Deleting a collection also deletes its Meta set; a Meta failure must not block removing the local row, so it is logged. */
  private async dropFromMetaQuietly(orgId: number, uuid: string): Promise<void> {
    try {
      const { set, catalog } = await this.db.tx(async (tx) => {
        const found = await tx.execute(sql`
          SELECT ${COLUMNS} FROM wa_product_sets WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`);
        return {
          set: found.rows[0] ? toRow(found.rows[0] as Raw) : undefined,
          catalog: await this.catalogs.first(tx, orgId),
        };
      });
      if (!set?.metaSetId || !catalog) return;
      await this.provider.deleteProductSet(this.bindings.of(catalog), set.metaSetId);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : 'failed', uuid },
        'could not delete the Meta product set; removing the collection anyway',
      );
    }
  }
}
