import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type Coupon,
  type CouponListResponse,
  type CouponOptionsResponse,
  type CreateCouponRequest,
  type ListCouponsQuery,
  type UpdateCouponRequest,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { AuthAuditService, PlatformStore } from '../auth';
import { isExpired, normalizeCouponCode, normalizePlanSlugs } from './coupon-rules';
import { decodeKey, encodeKey, escapeLike, operatorId } from './operator';
import { pgArray } from './pg-array';

interface Db {
  id: string;
  uuid: string;
  code: string;
  description: string | null;
  admin_note: string | null;
  type: 'percent' | 'fixed';
  amount: string;
  max_discount_amount: string | null;
  currency_code: string | null;
  min_order_amount: string | null;
  max_uses: number | null;
  per_user_limit: number | null;
  uses_count: number;
  applicable_plan_slugs: string[];
  starts_at: string | Date | null;
  expires_at: string | Date | null;
  is_active: boolean;
  first_purchase_only: boolean;
  stackable_with_other: boolean;
  row_version: number;
  created_at: string | Date;
  updated_at: string | Date;
}

const COLUMNS = sql`id, uuid, code, description, admin_note, type, amount::text AS amount,
  max_discount_amount::text AS max_discount_amount, currency_code, min_order_amount::text AS min_order_amount,
  max_uses, per_user_limit, uses_count, applicable_plan_slugs, starts_at, expires_at, is_active,
  first_purchase_only, stackable_with_other, row_version, created_at, updated_at`;

const iso = (v: string | Date | null): string | null =>
  v === null ? null : new Date(v).toISOString();

/** numeric(12,4) text trimmed of pointless zeros for display: "10.5000" -> "10.5", "20.0000" -> "20". */
const trimNumber = (v: string | null): string | null =>
  v === null ? null : v.includes('.') ? v.replace(/\.?0+$/, '') : v;

export const toCoupon = (r: Db, now = new Date()): Coupon => ({
  id: r.uuid,
  code: r.code,
  description: r.description,
  adminNote: r.admin_note,
  type: r.type,
  amount: trimNumber(r.amount) ?? '0',
  maxDiscountAmount: trimNumber(r.max_discount_amount),
  currencyCode: r.currency_code,
  minOrderAmount: trimNumber(r.min_order_amount),
  maxUses: r.max_uses,
  perUserLimit: r.per_user_limit,
  usesCount: Number(r.uses_count),
  applicablePlanSlugs: r.applicable_plan_slugs ?? [],
  startsAt: iso(r.starts_at),
  expiresAt: iso(r.expires_at),
  isActive: r.is_active,
  isExpired: isExpired(r.expires_at === null ? null : new Date(r.expires_at), now),
  firstPurchaseOnly: r.first_purchase_only,
  stackableWithOther: r.stackable_with_other,
  rowVersion: Number(r.row_version),
  createdAt: iso(r.created_at)!,
  updatedAt: iso(r.updated_at)!,
});

/** The editable fields of a coupon in one comparable shape, for the "what changed" audit line. */
const snapshot = (c: Coupon) => ({
  // `code` as a key is redacted by the audit writer (a bare "code" is treated as an OTP); the coupon code is not a secret.
  couponCode: c.code,
  description: c.description,
  adminNote: c.adminNote,
  type: c.type,
  amount: c.amount,
  maxDiscountAmount: c.maxDiscountAmount,
  currencyCode: c.currencyCode,
  minOrderAmount: c.minOrderAmount,
  maxUses: c.maxUses,
  perUserLimit: c.perUserLimit,
  applicablePlanSlugs: c.applicablePlanSlugs,
  startsAt: c.startsAt,
  expiresAt: c.expiresAt,
  isActive: c.isActive,
  firstPurchaseOnly: c.firstPurchaseOnly,
  stackableWithOther: c.stackableWithOther,
});

/**
 * The operator's coupon catalogue (TW-CPN-001..005). Coupons are platform-global rows: reads and writes use the privileged
 * connection, and the route is guarded by operator roles (every role reads, only super admins write).
 *
 * Deliberate differences from Reference, all from its own findings: the code is unique without regard to case; clearing the plan
 * restriction works (an empty list means any plan); an edit that changes nothing writes nothing; an edit with a stale form is
 * refused; `active` is set to a value instead of flipped; every write is audited with the field names it touched.
 */
@Injectable()
export class CouponsService {
  constructor(
    private readonly store: PlatformStore,
    private readonly audit: AuthAuditService,
  ) {}

  async list(q: ListCouponsQuery): Promise<CouponListResponse> {
    const now = new Date();
    return this.store.tx(async (tx) => {
      const filters = [sql`true`];
      if (q.q) {
        const like = `%${escapeLike(q.q)}%`;
        filters.push(sql`(code ILIKE ${like} OR description ILIKE ${like})`);
      }
      if (q.status === 'active') filters.push(sql`is_active`);
      if (q.status === 'disabled') filters.push(sql`NOT is_active`);
      if (q.status === 'expired') filters.push(sql`expires_at IS NOT NULL AND expires_at < ${now}`);
      const where = sql.join(filters, sql` AND `);
      const after = q.cursor ? sql`AND id < ${Number(decodeKey(q.cursor))}` : sql``;

      const rows = await tx.execute(
        sql`SELECT ${COLUMNS} FROM coupons WHERE ${where} ${after} ORDER BY id DESC LIMIT ${q.limit + 1}`,
      );
      const all = rows.rows as unknown as Db[];
      const hasMore = all.length > q.limit;
      const items = hasMore ? all.slice(0, q.limit) : all;

      const totals = await tx.execute(sql`
        SELECT
          count(*) FILTER (WHERE ${where})::int AS matching,
          count(*)::int AS total,
          count(*) FILTER (WHERE is_active)::int AS active,
          count(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at < ${now})::int AS expired,
          coalesce(sum(uses_count), 0)::int AS redeemed
        FROM coupons`);
      const t = totals.rows[0] as {
        matching: number;
        total: number;
        active: number;
        expired: number;
        redeemed: number;
      };
      return {
        data: items.map((r) => toCoupon(r, now)),
        page: {
          nextCursor: hasMore ? encodeKey(items[items.length - 1]!.id) : null,
          hasMore,
          limit: q.limit,
        },
        total: t.matching,
        stats: { total: t.total, active: t.active, expired: t.expired, redeemed: t.redeemed },
        counts: { all: t.total, active: t.active, expired: t.expired },
      };
    });
  }

  async get(uuid: string): Promise<Coupon> {
    return this.store.tx(async (tx) => toCoupon(await this.load(tx, uuid)));
  }

  /** The plans and add-ons a coupon can be limited to, and the currencies it can be locked to. */
  async options(): Promise<CouponOptionsResponse> {
    return this.store.tx(async (tx) => {
      const plans = await tx.execute(
        sql`SELECT slug, name, kind FROM plans WHERE is_active AND NOT is_free AND NOT is_custom_quote ORDER BY kind, amount, id`,
      );
      const currencies = await tx.execute(
        sql`SELECT code, symbol FROM currencies WHERE is_active ORDER BY code`,
      );
      return {
        plans: (
          plans.rows as unknown as Array<{ slug: string; name: string; kind: 'plan' | 'addon' }>
        ).map((p) => ({ slug: p.slug, name: p.name, kind: p.kind })),
        // The static fallback keeps the lock usable before the catalog is seeded (TW-CPN-002 criterion).
        currencies:
          currencies.rows.length > 0
            ? (currencies.rows as unknown as Array<{ code: string; symbol: string | null }>).map(
                (c) => ({ code: c.code, symbol: c.symbol }),
              )
            : [
                { code: 'INR', symbol: '₹' },
                { code: 'USD', symbol: '$' },
                { code: 'EUR', symbol: '€' },
                { code: 'GBP', symbol: '£' },
                { code: 'AED', symbol: null },
              ],
      };
    });
  }

  async create(input: CreateCouponRequest): Promise<Coupon> {
    const operator = operatorId();
    const code = normalizeCouponCode(input.code);
    return this.store.tx(async (tx) => {
      const slugs = await this.checkPlans(tx, input.applicablePlanSlugs);
      let row: Db;
      try {
        const res = await tx.execute(sql`
          INSERT INTO coupons (code, description, admin_note, type, amount, max_discount_amount, currency_code, min_order_amount,
                               max_uses, per_user_limit, applicable_plan_slugs, starts_at, expires_at, is_active,
                               first_purchase_only, stackable_with_other)
          VALUES (${code}, ${input.description ?? null}, ${input.adminNote ?? null}, ${input.type}, ${input.amount},
                  ${input.maxDiscountAmount ?? null}, ${input.currencyCode ?? null}, ${input.minOrderAmount ?? null},
                  ${input.maxUses ?? null}, ${input.perUserLimit ?? null}, ${pgArray(slugs, 'text')}, ${input.startsAt ?? null},
                  ${input.expiresAt ?? null}, ${input.isActive ?? false}, ${input.firstPurchaseOnly ?? false},
                  ${input.stackableWithOther ?? false})
          RETURNING ${COLUMNS}`);
        row = res.rows[0] as unknown as Db;
      } catch (err) {
        throw this.mapConflict(err);
      }
      await this.record(tx, 'platform.coupon.created', operator, {
        id: row.uuid,
        couponCode: code,
      });
      return toCoupon(row);
    });
  }

  async update(uuid: string, patch: UpdateCouponRequest): Promise<Coupon> {
    const operator = operatorId();
    return this.store.tx(async (tx) => {
      const stored = await this.load(tx, uuid, true);
      if (Number(stored.row_version) !== patch.rowVersion)
        throw AppError.rowVersionConflict('Coupon');
      const before = toCoupon(stored);
      const next = {
        code: patch.code === undefined ? stored.code : normalizeCouponCode(patch.code),
        description: patch.description === undefined ? stored.description : patch.description,
        adminNote: patch.adminNote === undefined ? stored.admin_note : patch.adminNote,
        type: patch.type ?? stored.type,
        amount: patch.amount ?? stored.amount,
        maxDiscountAmount:
          patch.maxDiscountAmount === undefined
            ? stored.max_discount_amount
            : patch.maxDiscountAmount,
        currencyCode: patch.currencyCode === undefined ? stored.currency_code : patch.currencyCode,
        minOrderAmount:
          patch.minOrderAmount === undefined ? stored.min_order_amount : patch.minOrderAmount,
        maxUses: patch.maxUses === undefined ? stored.max_uses : patch.maxUses,
        perUserLimit: patch.perUserLimit === undefined ? stored.per_user_limit : patch.perUserLimit,
        slugs:
          patch.applicablePlanSlugs === undefined
            ? stored.applicable_plan_slugs
            : await this.checkPlans(tx, patch.applicablePlanSlugs),
        startsAt: patch.startsAt === undefined ? iso(stored.starts_at) : patch.startsAt,
        expiresAt: patch.expiresAt === undefined ? iso(stored.expires_at) : patch.expiresAt,
        isActive: patch.isActive ?? stored.is_active,
        firstPurchaseOnly: patch.firstPurchaseOnly ?? stored.first_purchase_only,
        stackableWithOther: patch.stackableWithOther ?? stored.stackable_with_other,
      };
      if (next.startsAt && next.expiresAt && new Date(next.expiresAt) < new Date(next.startsAt)) {
        throw AppError.validation('Expires at must be on or after Starts at.', [
          { path: 'expiresAt', message: 'Expires at must be on or after Starts at.' },
        ]);
      }
      let row: Db;
      try {
        const res = await tx.execute(sql`
          UPDATE coupons SET code = ${next.code}, description = ${next.description}, admin_note = ${next.adminNote},
            type = ${next.type}, amount = ${next.amount}, max_discount_amount = ${next.maxDiscountAmount},
            currency_code = ${next.currencyCode}, min_order_amount = ${next.minOrderAmount}, max_uses = ${next.maxUses},
            per_user_limit = ${next.perUserLimit}, applicable_plan_slugs = ${pgArray(next.slugs, 'text')},
            starts_at = ${next.startsAt}, expires_at = ${next.expiresAt}, is_active = ${next.isActive},
            first_purchase_only = ${next.firstPurchaseOnly}, stackable_with_other = ${next.stackableWithOther}
          WHERE uuid = ${uuid}::uuid AND row_version = ${patch.rowVersion}
          RETURNING ${COLUMNS}`);
        row = res.rows[0] as unknown as Db;
      } catch (err) {
        throw this.mapConflict(err);
      }
      const after = toCoupon(row);
      const b = snapshot(before) as Record<string, unknown>;
      const a = snapshot(after) as Record<string, unknown>;
      const changed = Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      if (changed.length === 0) {
        // Nothing differed: the row is not touched, no version is burned and nothing is audited (TW-CPN-003 criterion).
        return before;
      }
      await this.record(tx, 'platform.coupon.updated', operator, {
        id: uuid,
        couponCode: after.code,
        fields: changed,
        before: Object.fromEntries(changed.map((k) => [k, compact(b[k])])),
        after: Object.fromEntries(changed.map((k) => [k, compact(a[k])])),
      });
      return after;
    });
  }

  async setActive(uuid: string, value: boolean): Promise<Coupon> {
    const operator = operatorId();
    return this.store.tx(async (tx) => {
      const stored = await this.load(tx, uuid, true);
      if (stored.is_active === value) return toCoupon(stored);
      const res = await tx.execute(
        sql`UPDATE coupons SET is_active = ${value} WHERE uuid = ${uuid}::uuid RETURNING ${COLUMNS}`,
      );
      await this.record(tx, 'platform.coupon.updated', operator, {
        id: uuid,
        couponCode: stored.code,
        fields: ['isActive'],
        before: { isActive: stored.is_active },
        after: { isActive: value },
      });
      return toCoupon(res.rows[0] as unknown as Db);
    });
  }

  async remove(uuid: string): Promise<void> {
    const operator = operatorId();
    await this.store.tx(async (tx) => {
      const stored = await this.load(tx, uuid, true);
      // Past orders keep their discount: they hold their own amount and code snapshot, and the order's coupon link nulls out.
      await tx.execute(sql`DELETE FROM coupons WHERE uuid = ${uuid}::uuid`);
      await this.record(tx, 'platform.coupon.deleted', operator, {
        id: uuid,
        couponCode: stored.code,
      });
    });
  }

  // ---- helpers -------------------------------------------------------------------------------------------------------

  private async load(tx: Tx, uuid: string, lock = false): Promise<Db> {
    const res = await tx.execute(
      lock
        ? sql`SELECT ${COLUMNS} FROM coupons WHERE uuid = ${uuid}::uuid FOR UPDATE`
        : sql`SELECT ${COLUMNS} FROM coupons WHERE uuid = ${uuid}::uuid`,
    );
    const row = res.rows[0] as unknown as Db | undefined;
    if (!row) throw AppError.notFound('Coupon');
    return row;
  }

  /** Every slug must be a real plan or add-on; the list is stored sorted and de-duplicated. */
  private async checkPlans(tx: Tx, slugs: readonly string[] | undefined): Promise<string[]> {
    const wanted = normalizePlanSlugs(slugs);
    if (wanted.length === 0) return [];
    const res = await tx.execute(
      sql`SELECT slug FROM plans WHERE slug = ANY(${pgArray(wanted, 'text')})`,
    );
    const known = new Set((res.rows as Array<{ slug: string }>).map((r) => r.slug));
    const missing = wanted.filter((s) => !known.has(s));
    if (missing.length > 0) {
      throw new AppError(
        ERROR_CODES.CPN_COUPON_PLAN_UNKNOWN,
        'One of the selected plans does not exist.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        missing.map((slug) => ({ path: 'applicablePlanSlugs', message: slug })),
      );
    }
    return wanted;
  }

  private mapConflict(err: unknown): unknown {
    const e = err as { code?: string; constraint?: string };
    if (e.code === '23505' && e.constraint === 'uq_coupons_code') {
      return new AppError(
        ERROR_CODES.CPN_COUPON_CODE_TAKEN,
        'A coupon with this code already exists.',
        HttpStatus.CONFLICT,
        [{ path: 'code', message: 'The code has already been taken.' }],
      );
    }
    return err;
  }

  private async record(tx: Tx, event: string, operator: number, payload: Record<string, unknown>) {
    await this.audit.record(tx, {
      event,
      status: 'info',
      actorType: 'platform_operator',
      actorId: operator,
      payload,
    });
  }
}

/** Long strings are replaced by their length, as Reference's observer did (500 characters). */
function compact(v: unknown): unknown {
  return typeof v === 'string' && v.length > 500 ? `[${v.length} chars]` : v;
}
