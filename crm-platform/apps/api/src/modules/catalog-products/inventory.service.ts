import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';
import {
  afterCommit,
  afterHold,
  afterRelease,
  canHold,
  clampRef,
  DEFAULT_HOLD_TTL_SECONDS,
  holdTtl,
  type Stock,
} from './inventory-rules';

export interface StockReservation {
  id: number;
  uuid: string;
  productId: number;
  orderId: number | null;
  ref: string | null;
  qty: number;
  status: 'held' | 'committed' | 'released';
  expiresAt: Date | null;
}

type Raw = Record<string, unknown>;

const toReservation = (r: Raw): StockReservation => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  productId: Number(r.product_id),
  orderId: r.order_id === null || r.order_id === undefined ? null : Number(r.order_id),
  ref: (r.ref as string | null) ?? null,
  qty: Number(r.qty),
  status: r.status as StockReservation['status'],
  expiresAt: r.expires_at ? new Date(r.expires_at as string) : null,
});

const COLUMNS = sql`id, uuid, product_id, order_id, ref, qty, status, expires_at`;

/**
 * The anti-sellout ledger of natural-language ordering (WD-CAT-025), exported from the barrel for flows and checkout.
 *
 * Stock moves through reservations so two customers cannot oversell the last unit: `hold` reserves while the customer is
 * confirming, `commit` settles it (stock goes down), `release` gives it back, `sweepExpired` frees the holds nobody confirmed.
 * Each method works inside the CALLER's transaction and row-locks the product (`FOR UPDATE`), so the availability check and
 * the reservation are one atomic step. Stock changes made here never push to Meta: the resync sweep settles Meta's stock.
 */
@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private readonly db: DatabaseService) {}

  private async lockStock(tx: Tx, orgId: number, productId: number): Promise<Stock | undefined> {
    const res = await tx.execute(sql`
      SELECT stock_qty, reserved_qty FROM wa_products WHERE org_id = ${orgId} AND id = ${productId} FOR UPDATE`);
    const r = res.rows[0] as Raw | undefined;
    if (!r) return undefined;
    return {
      stockQty: r.stock_qty === null ? null : Number(r.stock_qty),
      reservedQty: Number(r.reserved_qty ?? 0),
    };
  }

  private async writeStock(tx: Tx, orgId: number, productId: number, s: Stock): Promise<void> {
    await tx.execute(sql`
      UPDATE wa_products SET stock_qty = ${s.stockQty}, reserved_qty = ${s.reservedQty}
      WHERE org_id = ${orgId} AND id = ${productId}`);
  }

  /** Sellable right now (null = unlimited). */
  available(s: Stock): number | null {
    return s.stockQty === null ? null : Math.max(0, s.stockQty - (s.reservedQty || 0));
  }

  /** Holds `qty` for an in-flight order; null when there is not enough (the caller tells the customer). */
  async hold(
    tx: Tx,
    orgId: number,
    productId: number,
    qty: number,
    ref: string,
    opts: { orderId?: number | null; ttlSeconds?: number } = {},
  ): Promise<StockReservation | null> {
    if (qty <= 0) return null;
    const stock = await this.lockStock(tx, orgId, productId);
    if (!stock || !canHold(stock, qty)) return null;
    const ttl = holdTtl(opts.ttlSeconds ?? DEFAULT_HOLD_TTL_SECONDS);
    const res = await tx.execute(sql`
      INSERT INTO wa_stock_reservations (org_id, product_id, order_id, ref, qty, status, expires_at)
      VALUES (${orgId}, ${productId}, ${opts.orderId ?? null}, ${clampRef(ref)}, ${qty}, 'held',
              now() + make_interval(secs => ${ttl}))
      RETURNING ${COLUMNS}`);
    await this.writeStock(tx, orgId, productId, afterHold(stock, qty));
    return toReservation(res.rows[0] as Raw);
  }

  private async findHeld(
    tx: Tx,
    orgId: number,
    reservationId: number,
  ): Promise<StockReservation | undefined> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM wa_stock_reservations
      WHERE org_id = ${orgId} AND id = ${reservationId} FOR UPDATE`);
    const r = res.rows[0] as Raw | undefined;
    return r ? toReservation(r) : undefined;
  }

  /** Settles a hold on Confirm: real stock down, the hold off the books. Anything not `held` is left alone. */
  async commit(
    tx: Tx,
    orgId: number,
    reservationId: number,
    orderId?: number | null,
  ): Promise<boolean> {
    const held = await this.findHeld(tx, orgId, reservationId);
    if (!held || held.status !== 'held') return false;
    const stock = await this.lockStock(tx, orgId, held.productId);
    if (stock) await this.writeStock(tx, orgId, held.productId, afterCommit(stock, held.qty));
    await tx.execute(sql`
      UPDATE wa_stock_reservations
      SET status = 'committed', order_id = coalesce(${orderId ?? null}, order_id)
      WHERE org_id = ${orgId} AND id = ${held.id}`);
    return true;
  }

  /** Frees a hold (no sale). */
  async release(tx: Tx, orgId: number, reservationId: number): Promise<boolean> {
    const held = await this.findHeld(tx, orgId, reservationId);
    if (!held || held.status !== 'held') return false;
    const stock = await this.lockStock(tx, orgId, held.productId);
    if (stock) await this.writeStock(tx, orgId, held.productId, afterRelease(stock, held.qty));
    await tx.execute(
      sql`UPDATE wa_stock_reservations SET status = 'released' WHERE org_id = ${orgId} AND id = ${held.id}`,
    );
    return true;
  }

  private async heldIdsByRef(tx: Tx, orgId: number, ref: string): Promise<number[]> {
    const res = await tx.execute(sql`
      SELECT id FROM wa_stock_reservations WHERE org_id = ${orgId} AND ref = ${ref} AND status = 'held' ORDER BY id`);
    return (res.rows as Raw[]).map((r) => Number(r.id));
  }

  /** Commits every held reservation of a ref (the customer pressed Confirm); returns how many. */
  async commitByRef(tx: Tx, orgId: number, ref: string, orderId?: number | null): Promise<number> {
    let n = 0;
    for (const id of await this.heldIdsByRef(tx, orgId, ref)) {
      if (await this.commit(tx, orgId, id, orderId)) n++;
    }
    return n;
  }

  /** Releases every held reservation of a ref (cancel, re-order, abandon); returns how many. */
  async releaseByRef(tx: Tx, orgId: number, ref: string): Promise<number> {
    let n = 0;
    for (const id of await this.heldIdsByRef(tx, orgId, ref)) {
      if (await this.release(tx, orgId, id)) n++;
    }
    return n;
  }

  /**
   * The heartbeat: frees the holds whose window passed so abandoned carts do not pin stock. It spans organizations, so it
   * finds the expired holds privileged and releases each one in a transaction of its own organization; one failing hold does
   * not stop the rest. Returns how many were released.
   */
  async sweepExpired(limit = 1000): Promise<number> {
    const expired = await this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT org_id, id FROM wa_stock_reservations
        WHERE status = 'held' AND expires_at IS NOT NULL AND expires_at < now()
        ORDER BY id LIMIT ${limit}`);
      return (res.rows as Raw[]).map((r) => ({ orgId: Number(r.org_id), id: Number(r.id) }));
    });
    let n = 0;
    for (const e of expired) {
      try {
        if (
          await this.db.txAs({ orgId: e.orgId, userId: null }, (tx) =>
            this.release(tx, e.orgId, e.id),
          )
        )
          n++;
      } catch (err) {
        this.logger.warn(
          { ...e, err: err instanceof Error ? err.message : 'failed' },
          'sweep release failed',
        );
      }
    }
    return n;
  }
}
