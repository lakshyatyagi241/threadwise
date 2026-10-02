import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { addonEndsAt, type BillingUnit } from './addon-grants';

export interface FulfilInput {
  orgId: number;
  /** The add-on's slug or uuid (checkout knows one or the other). */
  pack: string;
  /** The paid order. Replaying the same order for the same pack is a no-op. */
  orderId: number | null;
  now?: Date;
}

export interface FulfilResult {
  /** False when this order had already been fulfilled (nothing was written). */
  created: boolean;
  workspaceAddonId: string | null;
  startsAt: Date;
  endsAt: Date | null;
}

interface PackRow {
  id: number;
  slug: string;
  is_free: boolean;
  is_lifetime: boolean;
  billing_unit: BillingUnit;
  billing_duration: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Add-on purchase fulfilment (WD-ADD-032): a confirmed paid order creates the workspace's `workspace_addons` row,
 * on top of the current plan, without touching the plan, the trial or the plan's end date.
 *
 * It takes the caller's transaction: checkout's order finalisation owns the transaction that marks the order paid,
 * so the order and its entitlement commit or fail together. That transaction is privileged (the table accepts
 * writes only then, a workspace cannot grant itself an add-on), and nothing here opens one.
 *
 * Idempotent through the unique (org, order, pack) index: finalising the same order twice writes one row. Buying
 * the same add-on in a second order adds a second row and the grants stack. Whether the workspace is on an active
 * paid plan, and whether a feature-only pack may be bought twice, are checkout's business (WaDesk enforced both
 * only in the view; the catalogue endpoint reports them, nothing here refuses a paid order).
 */
@Injectable()
export class AddonFulfilmentService {
  constructor(private readonly outbox: OutboxService) {}

  async fulfil(tx: Tx, input: FulfilInput): Promise<FulfilResult> {
    const now = input.now ?? new Date();
    // slug first, then uuid (WD-ADD-032 rule 2); an add-on only, never a plan
    const res = await tx.execute(
      UUID.test(input.pack)
        ? sql`SELECT id::int AS id, slug, is_free, is_lifetime, billing_unit, billing_duration
              FROM plans WHERE kind = 'addon' AND (slug = ${input.pack} OR uuid = ${input.pack}::uuid)`
        : sql`SELECT id::int AS id, slug, is_free, is_lifetime, billing_unit, billing_duration
              FROM plans WHERE kind = 'addon' AND slug = ${input.pack}`,
    );
    const pack = res.rows[0] as unknown as PackRow | undefined;
    if (!pack) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Add-on not found', HttpStatus.NOT_FOUND);
    }
    const endsAt = addonEndsAt(now, {
      isFree: pack.is_free,
      isLifetime: pack.is_lifetime,
      billingUnit: pack.billing_unit,
      billingDuration: pack.billing_duration,
    });

    const ins = await tx.execute(sql`
      INSERT INTO workspace_addons (org_id, package_id, order_id, status, starts_at, ends_at)
      VALUES (${input.orgId}, ${pack.id}, ${input.orderId}, 'active', ${now}, ${endsAt})
      ON CONFLICT (org_id, order_id, package_id) WHERE order_id IS NOT NULL DO NOTHING
      RETURNING id::int AS id, uuid
    `);
    const row = ins.rows[0] as unknown as { id: number; uuid: string } | undefined;
    if (!row) return { created: false, workspaceAddonId: null, startsAt: now, endsAt };

    await this.outbox.emit(tx, {
      orgId: input.orgId,
      aggregateModule: 'addons',
      aggregateId: row.id,
      eventType: 'addon.activated',
      payload: {
        uuid: row.uuid,
        pack: pack.slug,
        orderId: input.orderId,
        endsAt: endsAt?.toISOString() ?? null,
      },
    });
    return { created: true, workspaceAddonId: row.uuid, startsAt: now, endsAt };
  }
}
