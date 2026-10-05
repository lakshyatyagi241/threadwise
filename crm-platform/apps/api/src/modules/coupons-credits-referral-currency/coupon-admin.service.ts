import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  COUPON_PAGE_SIZE,
  ERROR_CODES,
  createCouponRequestSchema,
  type BillingOptionsResponse,
  type CouponItem,
  type CouponListQuery,
  type CouponListResponse,
  type CreateCouponPayload,
  type UpdateCouponPayload,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuthAuditService } from '../auth';
import { CurrencyService } from '../platform-settings-branding-storage';
import { COUPON_COLUMNS, toCouponItem, type CouponRow } from './coupon-row';
import { CpnStore, type UniqueMap } from './cpn-store';

/** The five currencies WaDesk offered when its catalogue was empty (coupon form, credit-package form). */
export const FALLBACK_CURRENCIES = [
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', precision: 2 },
  { code: 'USD', symbol: '$', name: 'US Dollar', precision: 2 },
  { code: 'EUR', symbol: '€', name: 'Euro', precision: 2 },
  { code: 'GBP', symbol: '£', name: 'British Pound', precision: 2 },
  { code: 'AED', symbol: null, name: 'UAE Dirham', precision: 2 },
] as const;

const UNIQUE: UniqueMap = {
  uq_coupons_code: {
    code: ERROR_CODES.CPN_COUPON_CODE_TAKEN,
    message: 'Another coupon already uses this code.',
  },
};

/** The fields a create or update writes, in the form's own (camelCase) names. */
interface CouponFields {
  code: string;
  description: string | null;
  adminNote: string | null;
  type: 'percent' | 'fixed';
  amount: string;
  maxDiscountAmount: string | null;
  currencyCode: string | null;
  minOrderAmount: string | null;
  maxUses: number | null;
  perUserLimit: number | null;
  applicablePlans: string[];
  startsAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
  firstPurchaseOnly: boolean;
  stackableWithOther: boolean;
}

const toFields = (c: CouponItem): CouponFields => ({
  code: c.code,
  description: c.description,
  adminNote: c.adminNote,
  type: c.type,
  amount: c.amount,
  maxDiscountAmount: c.maxDiscountAmount,
  currencyCode: c.currencyCode,
  minOrderAmount: c.minOrderAmount,
  maxUses: c.maxUses,
  perUserLimit: c.perUserLimit,
  applicablePlans: c.applicablePlans,
  startsAt: c.startsAt,
  expiresAt: c.expiresAt,
  isActive: c.isActive,
  firstPurchaseOnly: c.firstPurchaseOnly,
  stackableWithOther: c.stackableWithOther,
});

/**
 * The operator's coupon catalogue (WD-CPN-001..005): list with KPIs, search and status pills, create, update, activate or
 * deactivate, delete. Every write is one platform transaction that also records the security event, so a change and its audit
 * row commit together. Updates are optimistic-locked on `rowVersion`.
 *
 * Differences from WaDesk, each recorded in the parity doc: the plan restriction can be cleared (an explicit empty list),
 * the search treats `%` and `_` literally, the code is unique case-insensitively in the database, `uses_count` is never writable
 * from here, and plan restrictions are plan slugs checked against the catalogue.
 */
@Injectable()
export class CouponAdminService {
  constructor(
    private readonly store: CpnStore,
    private readonly audit: AuthAuditService,
    private readonly currencies: CurrencyService,
  ) {}

  private operatorId(): number {
    const id = RequestContextStore.require().actorId;
    if (!id) throw AppError.unauthenticated();
    return id;
  }

  // --- reads ----------------------------------------------------------------------------------------------------------------

  async list(query: CouponListQuery): Promise<CouponListResponse> {
    const defaultCurrency = await this.currencies.effectiveCode();
    return this.store.tx(async (tx) => {
      const q = query.q ?? null;
      const search = q
        ? sql`AND (strpos(lower(code), lower(${q})) > 0 OR strpos(lower(coalesce(description, '')), lower(${q})) > 0)`
        : sql``;
      const status =
        query.status === 'active'
          ? sql`AND is_active`
          : query.status === 'disabled'
            ? sql`AND NOT is_active`
            : query.status === 'expired'
              ? sql`AND expires_at IS NOT NULL AND expires_at < now()`
              : sql``;

      const kpi = await tx.execute(sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE is_active)::int AS active,
               count(*) FILTER (WHERE NOT is_active)::int AS disabled,
               count(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at < now())::int AS expired,
               coalesce(sum(uses_count), 0)::int AS redeemed
        FROM coupons`);
      const k = kpi.rows[0] as unknown as {
        total: number;
        active: number;
        disabled: number;
        expired: number;
        redeemed: number;
      };

      const filtered = await tx.execute(
        sql`SELECT count(*)::int AS n FROM coupons WHERE true ${search} ${status}`,
      );
      const total = (filtered.rows[0] as unknown as { n: number }).n;
      const pageCount = Math.max(1, Math.ceil(total / COUPON_PAGE_SIZE));
      // A page past the end shows the last page (Laravel's paginator would show an empty one; this never strands the operator).
      const page = Math.min(query.page, pageCount);
      const offset = (page - 1) * COUPON_PAGE_SIZE;

      const rows = await tx.execute(sql`
        SELECT ${COUPON_COLUMNS} FROM coupons WHERE true ${search} ${status}
        ORDER BY id DESC LIMIT ${COUPON_PAGE_SIZE} OFFSET ${offset}`);
      const data = (rows.rows as unknown as CouponRow[]).map(toCouponItem);

      return {
        data,
        summary: { total: k.total, active: k.active, expired: k.expired, redeemed: k.redeemed },
        counts: { all: k.total, active: k.active, disabled: k.disabled, expired: k.expired },
        page,
        pageSize: COUPON_PAGE_SIZE,
        defaultCurrency,
        total,
        pageCount,
        from: data.length === 0 ? 0 : offset + 1,
        to: offset + data.length,
      };
    });
  }

  async get(uuid: string): Promise<CouponItem> {
    return this.store.tx(async (tx) => toCouponItem(await this.byUuid(tx, uuid)));
  }

  /** The plans a coupon can be limited to and the currencies it can be locked to (WD-CPN-002 sections 02 and 03). */
  async options(): Promise<BillingOptionsResponse> {
    return this.store.tx(async (tx) => billingOptions(tx));
  }

  // --- writes ---------------------------------------------------------------------------------------------------------------

  async create(body: CreateCouponPayload): Promise<CouponItem> {
    const operatorId = this.operatorId();
    return this.store.tx(async (tx) => {
      await this.assertPlansExist(tx, body.applicablePlans);
      const res = await tx.execute(sql`
        INSERT INTO coupons (code, description, admin_note, type, amount, max_discount_amount, currency_code,
                             min_order_amount, max_uses, per_user_limit, applicable_package_ids, starts_at,
                             expires_at, is_active, first_purchase_only, stackable_with_other)
        VALUES (${body.code}, ${body.description}, ${body.adminNote}, ${body.type}, ${body.amount}::numeric,
                ${body.maxDiscountAmount}::numeric, ${body.currencyCode}, ${body.minOrderAmount}::numeric,
                ${body.maxUses}, ${body.perUserLimit}, ${JSON.stringify(body.applicablePlans)}::jsonb,
                ${body.startsAt}::timestamptz, ${body.expiresAt}::timestamptz, ${body.isActive},
                ${body.firstPurchaseOnly}, ${body.stackableWithOther})
        RETURNING ${COUPON_COLUMNS}`);
      const item = toCouponItem(res.rows[0] as unknown as CouponRow);
      await this.record(tx, 'platform.coupon.created', operatorId, {
        couponCode: item.code,
        type: item.type,
        amount: item.amount,
        isActive: item.isActive,
      });
      return item;
    }, UNIQUE);
  }

  async update(uuid: string, patch: UpdateCouponPayload): Promise<CouponItem> {
    const operatorId = this.operatorId();
    return this.store.tx(async (tx) => {
      const stored = await this.byUuid(tx, uuid, true);
      if (stored.row_version !== patch.rowVersion) throw AppError.rowVersionConflict('The coupon');
      const before = toCouponItem(stored);
      const { rowVersion: _rv, ...fields } = patch;
      void _rv;
      const defined = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined),
      ) as Partial<CouponFields>;
      const merged = { ...toFields(before), ...defined };

      // The merged result must satisfy every rule a new coupon does (the window, the number shapes).
      const checked = createCouponRequestSchema.safeParse(merged);
      if (!checked.success) {
        throw AppError.validation(
          'The coupon failed validation.',
          checked.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        );
      }
      const after = checked.data;
      await this.assertPlansExist(tx, after.applicablePlans);

      const res = await tx.execute(sql`
        UPDATE coupons SET
          code = ${after.code}, description = ${after.description}, admin_note = ${after.adminNote},
          type = ${after.type}, amount = ${after.amount}::numeric,
          max_discount_amount = ${after.maxDiscountAmount}::numeric, currency_code = ${after.currencyCode},
          min_order_amount = ${after.minOrderAmount}::numeric, max_uses = ${after.maxUses},
          per_user_limit = ${after.perUserLimit},
          applicable_package_ids = ${JSON.stringify(after.applicablePlans)}::jsonb,
          starts_at = ${after.startsAt}::timestamptz, expires_at = ${after.expiresAt}::timestamptz,
          is_active = ${after.isActive}, first_purchase_only = ${after.firstPurchaseOnly},
          stackable_with_other = ${after.stackableWithOther}
        WHERE id = ${stored.id} AND row_version = ${patch.rowVersion}
        RETURNING ${COUPON_COLUMNS}`);
      if (res.rows.length === 0) throw AppError.rowVersionConflict('The coupon');
      const item = toCouponItem(res.rows[0] as unknown as CouponRow);

      // Nothing is logged when nothing changed (WD-CPN-003 rule 5).
      const changes = diffFields(toFields(before), toFields(item));
      if (Object.keys(changes).length > 0) {
        await this.record(tx, 'platform.coupon.updated', operatorId, {
          couponCode: item.code,
          fields: Object.keys(changes),
          changes,
        });
      }
      return item;
    }, UNIQUE);
  }

  /** Idempotent: setting the state it already has changes nothing and writes no audit row. */
  async setActive(uuid: string, isActive: boolean, rowVersion?: number): Promise<CouponItem> {
    const operatorId = this.operatorId();
    return this.store.tx(async (tx) => {
      const stored = await this.byUuid(tx, uuid, true);
      if (rowVersion !== undefined && stored.row_version !== rowVersion) {
        throw AppError.rowVersionConflict('The coupon');
      }
      if (stored.is_active === isActive) return toCouponItem(stored);
      const res = await tx.execute(
        sql`UPDATE coupons SET is_active = ${isActive} WHERE id = ${stored.id} RETURNING ${COUPON_COLUMNS}`,
      );
      await this.record(
        tx,
        isActive ? 'platform.coupon.activated' : 'platform.coupon.deactivated',
        operatorId,
        { couponCode: stored.code },
      );
      return toCouponItem(res.rows[0] as unknown as CouponRow);
    });
  }

  /**
   * Hard delete, as WaDesk. Past orders keep their discount and their `coupon_code` snapshot; their `coupon_id` becomes null
   * (the foreign key's ON DELETE SET NULL), which reproduces WaDesk's loophole: deleting a code and creating it again resets every
   * buyer's per-user count. Recorded in the parity doc.
   */
  async remove(uuid: string): Promise<void> {
    const operatorId = this.operatorId();
    await this.store.tx(async (tx) => {
      const stored = await this.byUuid(tx, uuid, true);
      await tx.execute(sql`DELETE FROM coupons WHERE id = ${stored.id}`);
      await this.record(tx, 'platform.coupon.deleted', operatorId, {
        couponCode: stored.code,
        usesCount: stored.uses_count,
      });
    });
  }

  // --- internals ------------------------------------------------------------------------------------------------------------

  private async byUuid(tx: Tx, uuid: string, lock = false): Promise<CouponRow> {
    const res = await tx.execute(
      lock
        ? sql`SELECT ${COUPON_COLUMNS} FROM coupons WHERE uuid = ${uuid}::uuid FOR UPDATE`
        : sql`SELECT ${COUPON_COLUMNS} FROM coupons WHERE uuid = ${uuid}::uuid`,
    );
    const row = res.rows[0] as unknown as CouponRow | undefined;
    if (!row) throw AppError.notFound('Coupon');
    return row;
  }

  /** WaDesk: each id must exist in `packages` (plans AND add-ons share the table). Here: each slug must exist in the catalogue. */
  private async assertPlansExist(tx: Tx, slugs: readonly string[]): Promise<void> {
    if (slugs.length === 0) return;
    const res = await tx.execute(
      sql`SELECT slug FROM plans WHERE slug IN (${sql.join(
        slugs.map((s) => sql`${s}`),
        sql`, `,
      )})`,
    );
    const known = new Set((res.rows as unknown as Array<{ slug: string }>).map((r) => r.slug));
    const unknown = slugs.filter((s) => !known.has(s));
    if (unknown.length > 0) {
      throw new AppError(
        ERROR_CODES.CPN_COUPON_PLAN_UNKNOWN,
        'One or more of the selected plans no longer exist.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        unknown.map((s) => ({ path: 'applicablePlans', message: s })),
      );
    }
  }

  private async record(
    tx: Tx,
    event: string,
    operatorId: number,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(tx, {
      event,
      status: 'info',
      actorType: 'platform_operator',
      actorId: operatorId,
      payload,
    });
  }
}

/** The form's two pickers, shared by the coupon and credit-package forms. */
export async function billingOptions(tx: Tx): Promise<BillingOptionsResponse> {
  const plans = await tx.execute(
    sql`SELECT slug, name, kind, is_active FROM plans ORDER BY kind, amount, slug`,
  );
  const currencies = await tx.execute(
    sql`SELECT code, symbol, name, "precision" FROM currencies WHERE is_active ORDER BY code`,
  );
  const rows = currencies.rows as unknown as Array<{
    code: string;
    symbol: string | null;
    name: string | null;
    precision: number;
  }>;
  return {
    plans: (
      plans.rows as unknown as Array<{
        slug: string;
        name: string;
        kind: 'plan' | 'addon';
        is_active: boolean;
      }>
    ).map((p) => ({ slug: p.slug, name: p.name, kind: p.kind, isActive: p.is_active })),
    currencies: rows.length > 0 ? rows : FALLBACK_CURRENCIES.map((c) => ({ ...c })),
  };
}

/** Field-by-field before/after for the audit event; unchanged fields are left out. */
function diffFields(
  before: CouponFields,
  after: CouponFields,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after) as Array<keyof CouponFields>) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      // `code` is a redacted key name in the audit writer; the coupon code is not a secret, so it travels as `couponCode`.
      changes[key === 'code' ? 'couponCode' : key] = { from: before[key], to: after[key] };
    }
  }
  return changes;
}
