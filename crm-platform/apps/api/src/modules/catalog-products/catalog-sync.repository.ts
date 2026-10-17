import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { CatalogHealth } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { healthScore } from './catalog-rules';
import {
  PRODUCT_SELECT,
  intArray,
  textArray,
  toProductRow,
  type ProductRow,
} from './products.repository';

type Raw = Record<string, unknown>;

const FROM = sql`FROM wa_products p LEFT JOIN wa_storefronts sf ON sf.org_id = p.org_id AND sf.id = p.storefront_id`;

/**
 * The rows the Meta sync reads and the bookkeeping it writes. Kept apart from the product repository because none of these
 * writes is a user edit: they touch only the `meta_*` columns, so they never go through the product service's rules.
 */
@Injectable()
export class CatalogSyncRepository {
  /**
   * The active products to push, oldest first, at most `limit`. With explicit uuids: exactly those that are active. Without:
   * the ones never pushed, the failed ones, and pending ones that lost their handle (Meta returned fewer handles than rows, so
   * they could never be polled to completion). Pending rows that DO have a handle are waiting on Meta and are not re-pushed:
   * Reference selected them too, which made a 1,000+ backlog loop on the same first chunk forever.
   */
  async selectForPush(
    tx: Tx,
    orgId: number,
    f: { uuids?: readonly string[]; limit: number },
  ): Promise<ProductRow[]> {
    const where = f.uuids
      ? sql`AND p.uuid::text = ANY(${textArray(f.uuids)})`
      : sql`AND (p.meta_sync_status IS NULL OR p.meta_sync_status = 'failed'
               OR (p.meta_sync_status = 'pending' AND p.meta_batch_handle IS NULL))`;
    if (f.uuids && f.uuids.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT ${PRODUCT_SELECT} ${FROM}
      WHERE p.org_id = ${orgId} AND p.status = 'active' ${where}
      ORDER BY p.id
      LIMIT ${f.limit}`);
    return (res.rows as Raw[]).map(toProductRow);
  }

  /** Rows still to be pushed by the default selection (the screen calls again while this is above zero). */
  async countUnpushed(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*) AS c FROM wa_products
      WHERE org_id = ${orgId} AND status = 'active'
        AND (meta_sync_status IS NULL OR meta_sync_status = 'failed'
             OR (meta_sync_status = 'pending' AND meta_batch_handle IS NULL))`);
    return Number((res.rows[0] as Raw).c);
  }

  /** Every product by sync state; a product never pushed is `unsynced`. */
  async buckets(tx: Tx, orgId: number): Promise<Record<string, number>> {
    const res = await tx.execute(sql`
      SELECT coalesce(meta_sync_status, 'unsynced') AS bucket, count(*) AS n
      FROM wa_products WHERE org_id = ${orgId} GROUP BY 1`);
    return Object.fromEntries((res.rows as Raw[]).map((r) => [r.bucket as string, Number(r.n)]));
  }

  async markPending(
    tx: Tx,
    orgId: number,
    rows: ReadonlyArray<{ id: number; handle: string | null; retailerId: string }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    const values = sql.join(
      rows.map((r) => sql`(${r.id}::bigint, ${r.handle}::text, ${r.retailerId}::text)`),
      sql`, `,
    );
    await tx.execute(sql`
      UPDATE wa_products p
      SET meta_sync_status = 'pending', meta_batch_handle = v.handle, meta_retailer_id = v.rid, meta_last_error = NULL
      FROM (VALUES ${values}) AS v(id, handle, rid)
      WHERE p.org_id = ${orgId} AND p.id = v.id`);
  }

  async markFailed(tx: Tx, orgId: number, ids: readonly number[], error: string): Promise<void> {
    if (ids.length === 0) return;
    await tx.execute(sql`
      UPDATE wa_products SET meta_sync_status = 'failed', meta_last_error = ${error}
      WHERE org_id = ${orgId} AND id = ANY(${intArray(ids)})`);
  }

  /** Pending rows with a handle: what a poll asks Meta about. */
  async pendingWithHandle(tx: Tx, orgId: number): Promise<Array<{ id: number; handle: string }>> {
    const res = await tx.execute(sql`
      SELECT id, meta_batch_handle AS handle FROM wa_products
      WHERE org_id = ${orgId} AND meta_sync_status = 'pending' AND meta_batch_handle IS NOT NULL
      ORDER BY id`);
    return (res.rows as Raw[]).map((r) => ({ id: Number(r.id), handle: r.handle as string }));
  }

  async markSynced(tx: Tx, orgId: number, ids: readonly number[]): Promise<void> {
    if (ids.length === 0) return;
    await tx.execute(sql`
      UPDATE wa_products
      SET meta_sync_status = 'synced', meta_synced_at = now(), meta_batch_handle = NULL, meta_last_error = NULL
      WHERE org_id = ${orgId} AND id = ANY(${intArray(ids)})`);
  }

  /** A batch Meta rejected: failed with the first message of its row; the handle is kept, as Reference did. */
  async markPollFailed(
    tx: Tx,
    orgId: number,
    rows: ReadonlyArray<{ id: number; error: string }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    const values = sql.join(
      rows.map((r) => sql`(${r.id}::bigint, ${r.error}::text)`),
      sql`, `,
    );
    await tx.execute(sql`
      UPDATE wa_products p SET meta_sync_status = 'failed', meta_last_error = v.err
      FROM (VALUES ${values}) AS v(id, err)
      WHERE p.org_id = ${orgId} AND p.id = v.id`);
  }

  /** Disconnect: forget the sync state, keep `meta_retailer_id` so a re-connect to the same catalog finds the same identities. */
  async clearSyncState(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE wa_products
      SET meta_sync_status = NULL, meta_batch_handle = NULL, meta_synced_at = NULL, meta_last_error = NULL
      WHERE org_id = ${orgId} RETURNING id`);
    return res.rows.length;
  }

  /** Disconnect: the collections stay, but the product sets they were pushed as no longer exist for this workspace. */
  async clearSetIds(tx: Tx, orgId: number): Promise<void> {
    await tx.execute(
      sql`UPDATE wa_product_sets SET meta_set_id = NULL WHERE org_id = ${orgId} AND meta_set_id IS NOT NULL`,
    );
  }

  /**
   * The product for each Meta retailer id, in one query per 5000 ids (bind parameters are capped). When several products share an id
   * the lowest product id wins, as the single-id lookup this replaces did (`ORDER BY p.id LIMIT 1`). Ids with no product are absent.
   */
  async findByRetailerIds(
    tx: Tx,
    orgId: number,
    retailerIds: readonly string[],
  ): Promise<Map<string, ProductRow>> {
    const out = new Map<string, ProductRow>();
    const ids = [...new Set(retailerIds)];
    for (let i = 0; i < ids.length; i += 5000) {
      const res = await tx.execute(sql`
        SELECT DISTINCT ON (p.meta_retailer_id) ${PRODUCT_SELECT} ${FROM}
        WHERE p.org_id = ${orgId} AND p.meta_retailer_id = ANY(${textArray(ids.slice(i, i + 5000))})
        ORDER BY p.meta_retailer_id, p.id`);
      for (const row of res.rows as Raw[]) {
        const product = toProductRow(row);
        if (product.metaRetailerId) out.set(product.metaRetailerId, product);
      }
    }
    return out;
  }

  /**
   * The health block (TW-CAT-007): a product is flagged when it has no image, no price, or its last push failed (Reference only
   * looked for the status `error`, which it never wrote, so that signal never fired; `failed` counts here). Up to 8 samples,
   * most recently changed first.
   */
  async health(tx: Tx, orgId: number): Promise<CatalogHealth> {
    const flagged = sql`(image_url IS NULL OR image_url = '' OR price_minor = 0 OR meta_sync_status IN ('error', 'failed'))`;
    const counts = await tx.execute(sql`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE image_url IS NULL OR image_url = '') AS no_image,
             count(*) FILTER (WHERE price_minor = 0) AS no_price,
             count(*) FILTER (WHERE meta_sync_status IN ('error', 'failed')) AS errored,
             count(*) FILTER (WHERE ${flagged}) AS flagged
      FROM wa_products WHERE org_id = ${orgId}`);
    const c = counts.rows[0] as Raw;
    const total = Number(c.total);
    const flaggedCount = Number(c.flagged);
    const samples =
      flaggedCount > 0
        ? await tx.execute(sql`
            SELECT uuid, name, sku, image_url, price_minor, meta_sync_status FROM wa_products
            WHERE org_id = ${orgId} AND ${flagged}
            ORDER BY updated_at DESC, id DESC LIMIT 8`)
        : { rows: [] as Raw[] };
    return {
      score: healthScore(total, flaggedCount),
      total,
      noImage: Number(c.no_image),
      noPrice: Number(c.no_price),
      errored: Number(c.errored),
      flagged: flaggedCount,
      samples: (samples.rows as Raw[]).map((r) => ({
        id: r.uuid as string,
        name: r.name as string,
        sku: (r.sku as string | null) ?? null,
        imageUrl: (r.image_url as string | null) ?? null,
        priceMinor: Number(r.price_minor),
        metaSyncStatus: (r.meta_sync_status as string | null) ?? null,
      })),
    };
  }

  /** The most recently changed products (the Setup tab shows 50). */
  async recent(tx: Tx, orgId: number, limit: number): Promise<ProductRow[]> {
    const res = await tx.execute(sql`
      SELECT ${PRODUCT_SELECT} ${FROM}
      WHERE p.org_id = ${orgId}
      ORDER BY p.updated_at DESC, p.id DESC LIMIT ${limit}`);
    return (res.rows as Raw[]).map(toProductRow);
  }
}
