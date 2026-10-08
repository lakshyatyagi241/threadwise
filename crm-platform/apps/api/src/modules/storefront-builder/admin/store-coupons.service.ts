import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type CreateStoreCouponInput,
  type ListStoreCouponsQuery,
  type ListStoreCouponUsagesQuery,
  type StoreCoupon,
  type StoreCouponListResponse,
  type StoreCouponUsageListResponse,
  type UpdateStoreCouponInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { buildPage } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { couponState, normalizeCouponAmount, normalizeCouponCode } from '../rules/coupon-admin';
import { uniqueViolation } from '../shops/pg-errors';
import {
  StoreCouponsRepository,
  type CouponRow,
  type CouponValues,
} from './store-coupons.repository';

export const COUPON_MODULE = 'wa_coupons';

const taken = () =>
  new AppError(
    ERROR_CODES.STORE_COUPON_CODE_TAKEN,
    'A coupon with that code already exists.',
    HttpStatus.CONFLICT,
    [{ path: 'code', message: 'A coupon with that code already exists.' }],
  );

/**
 * Discount codes (Reference `WaCouponController`). Rules kept: the code is stored upper case and is unique in the workspace ignoring
 * case, a percentage is a whole number clamped to 100, money is minor units, a coupon can be switched on and off from the list,
 * delete removes it. Added: a start date and a shop scope (the columns the checkout already reads), a row version on edit, the usage
 * list, and the same duplicate check on edit (Reference only checked on create and let the database refuse the edit).
 * `usedCount` is only ever raised by the checkout.
 */
@Injectable()
export class StoreCouponsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: StoreCouponsRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async list(query: ListStoreCouponsQuery): Promise<StoreCouponListResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, ctx.orgId, query);
      const { items, page } = buildPage(rows, query.limit);
      return { data: items.map(toCoupon), page };
    });
  }

  async get(uuid: string): Promise<StoreCoupon> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => toCoupon(await this.orFail(tx, ctx.orgId, uuid)));
  }

  async create(input: CreateStoreCouponInput): Promise<StoreCoupon> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const values = await this.values(tx, ctx.orgId, input);
      if (await this.repo.codeTaken(tx, ctx.orgId, values.code)) throw taken();
      let made: { id: number; uuid: string };
      try {
        made = await tx.transaction((sp) => this.repo.insert(sp, ctx.orgId, values));
      } catch (err) {
        if (uniqueViolation(err)) throw taken();
        throw err;
      }
      await this.audit.record(tx, {
        module: COUPON_MODULE,
        recordId: made.id,
        action: 'insert',
        delta: { code: { old: null, new: values.code }, type: { old: null, new: values.type } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: COUPON_MODULE,
        aggregateId: made.id,
        eventType: 'store.coupon_created',
        payload: { code: values.code },
      });
      return toCoupon((await this.repo.findByUuid(tx, ctx.orgId, made.uuid))!);
    });
  }

  async update(uuid: string, input: UpdateStoreCouponInput): Promise<StoreCoupon> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, { lock: true });
      if (!row) throw AppError.notFound('Coupon', uuid);
      if (input.rowVersion !== row.rowVersion) throw AppError.rowVersionConflict('Coupon');
      const values = await this.values(tx, ctx.orgId, input);
      if (await this.repo.codeTaken(tx, ctx.orgId, values.code, row.id)) throw taken();
      let ok: boolean;
      try {
        ok = await tx.transaction((sp) =>
          this.repo.update(sp, ctx.orgId, row.id, values, row.rowVersion),
        );
      } catch (err) {
        if (uniqueViolation(err)) throw taken();
        throw err;
      }
      if (!ok) throw AppError.rowVersionConflict('Coupon');
      const after = (await this.repo.findByUuid(tx, ctx.orgId, uuid))!;
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      const pairs: Array<[string, unknown, unknown]> = [
        ['code', row.code, after.code],
        ['type', row.type, after.type],
        ['amount', row.amount, after.amount],
        ['minSubtotalMinor', row.minSubtotalMinor, after.minSubtotalMinor],
        ['maxDiscountMinor', row.maxDiscountMinor, after.maxDiscountMinor],
        ['freeShipping', row.freeShipping, after.freeShipping],
        ['active', row.active, after.active],
        ['startsAt', row.startsAt?.toISOString() ?? null, after.startsAt?.toISOString() ?? null],
        ['expiresAt', row.expiresAt?.toISOString() ?? null, after.expiresAt?.toISOString() ?? null],
        ['usageLimit', row.usageLimit, after.usageLimit],
        ['storefrontId', row.storefrontUuid, after.storefrontUuid],
      ];
      for (const [k, a, b] of pairs) if (a !== b) delta[k] = { old: a, new: b };
      await this.audit.record(tx, {
        module: COUPON_MODULE,
        recordId: row.id,
        action: 'update',
        delta,
      });
      await this.outbox.emit(tx, {
        aggregateModule: COUPON_MODULE,
        aggregateId: row.id,
        eventType: 'store.coupon_updated',
        payload: { code: after.code },
      });
      return toCoupon(after);
    });
  }

  /** Reference's quick toggle from the list. */
  async toggle(uuid: string): Promise<StoreCoupon> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, { lock: true });
      if (!row) throw AppError.notFound('Coupon', uuid);
      await this.repo.setActive(tx, ctx.orgId, row.id, !row.active);
      await this.audit.record(tx, {
        module: COUPON_MODULE,
        recordId: row.id,
        action: 'update',
        delta: { active: { old: row.active, new: !row.active } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: COUPON_MODULE,
        aggregateId: row.id,
        eventType: 'store.coupon_updated',
        payload: { code: row.code },
      });
      return toCoupon((await this.repo.findByUuid(tx, ctx.orgId, uuid))!);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const gone = await this.repo.delete(tx, ctx.orgId, uuid);
      if (!gone) throw AppError.notFound('Coupon', uuid);
      await this.audit.record(tx, {
        module: COUPON_MODULE,
        recordId: gone.id,
        action: 'delete',
        delta: { code: { old: gone.code, new: null } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: COUPON_MODULE,
        aggregateId: gone.id,
        eventType: 'store.coupon_deleted',
        payload: { code: gone.code },
      });
    });
  }

  /** The orders that used the coupon (matched on the code, ignoring case), newest first. */
  async usages(
    uuid: string,
    query: ListStoreCouponUsagesQuery,
  ): Promise<StoreCouponUsageListResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.orFail(tx, ctx.orgId, uuid);
      const rows = await this.repo.usages(tx, ctx.orgId, row.code, query);
      const { items, page } = buildPage(rows, query.limit);
      return {
        data: items.map((o) => ({
          orderId: o.uuid,
          orderNo: o.id,
          customerName: o.customerName,
          customerPhone: o.customerPhone,
          discountMinor: o.discountMinor,
          totalMinor: o.totalMinor,
          currencyCode: o.currencyCode,
          status: o.status,
          createdAt: o.createdAt.toISOString(),
        })),
        page,
      };
    });
  }

  // ---- internals -----------------------------------------------------------------------------------------------------

  private async orFail(tx: Tx, orgId: number, uuid: string): Promise<CouponRow> {
    const row = await this.repo.findByUuid(tx, orgId, uuid);
    if (!row) throw AppError.notFound('Coupon', uuid);
    return row;
  }

  /** The stored values of a submitted form (Reference `payload`): code upper case, amount normalised, the shop resolved. */
  private async values(
    tx: Tx,
    orgId: number,
    input: CreateStoreCouponInput | UpdateStoreCouponInput,
  ): Promise<CouponValues> {
    let storefrontId: number | null = null;
    if (input.storefrontId) {
      const id = await this.repo.shopIdByUuid(tx, orgId, input.storefrontId);
      if (id === undefined) {
        throw AppError.validation('Request payload failed validation', [
          { path: 'storefrontId', message: 'Unknown shop' },
        ]);
      }
      storefrontId = id;
    }
    return {
      code: normalizeCouponCode(input.code),
      type: input.type,
      amount: normalizeCouponAmount(input.type, input.amount),
      minSubtotalMinor: input.minSubtotalMinor ?? null,
      maxDiscountMinor: input.maxDiscountMinor ?? null,
      freeShipping: input.freeShipping,
      active: input.active,
      startsAt: input.startsAt ?? null,
      expiresAt: input.expiresAt ?? null,
      usageLimit: input.usageLimit ?? null,
      storefrontId,
    };
  }
}

export function toCoupon(r: CouponRow): StoreCoupon {
  return {
    id: r.uuid,
    code: r.code,
    type: r.type,
    amount: r.amount,
    minSubtotalMinor: r.minSubtotalMinor,
    maxDiscountMinor: r.maxDiscountMinor,
    freeShipping: r.freeShipping,
    active: r.active,
    startsAt: r.startsAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    usageLimit: r.usageLimit,
    usedCount: r.usedCount,
    state: couponState(r),
    storefrontId: r.storefrontUuid,
    storefrontName: r.storefrontName,
    rowVersion: r.rowVersion,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
