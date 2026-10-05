import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  createAddonRequestSchema,
  type AddonGrants,
  type AddonPack,
  type AddonPackListResponse,
  type CreateAddonPayload,
  type GrantFieldsResponse,
  type UpdateAddonPayload,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { PLAN_FEATURE_DEFS, PLAN_LIMIT_DEFS } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuthAuditService, PlatformStore } from '../auth';
import { slugifyPlanName, uniquePlanSlug } from '../plans-subscriptions-trials';
import {
  featuresColumn,
  normaliseGrants,
  readGrants,
  titledKey,
  type AllowedKeys,
} from './addon-grants';
import { ModuleRegistryService } from './module-registry.service';

interface PackRow {
  id: number;
  uuid: string;
  slug: string;
  name: string;
  subtitle: string | null;
  detail: string | null;
  amount: string;
  offer_amount: string | null;
  currency: string;
  billing_unit: 'days' | 'weeks' | 'months' | 'years';
  billing_duration: number;
  billing_mode: 'one_time' | 'recurring';
  is_free: boolean;
  is_lifetime: boolean;
  is_active: boolean;
  sort_order: number;
  features: unknown;
  limits: unknown;
  row_version: number;
  created_at: string;
  updated_at: string;
  purchases: number;
  active_purchases: number;
}

/** Selected with the purchase counts the delete guard and the list both need. */
const SELECT = sql.raw(`
  SELECT p.id::int AS id, p.uuid, p.slug, p.name, p.subtitle, p.detail, p.amount::text AS amount,
         p.offer_amount::text AS offer_amount, p.currency, p.billing_unit, p.billing_duration, p.billing_mode, p.is_free,
         p.is_lifetime, p.is_active, p.sort_order, p.features, p.limits, p.row_version, p.created_at, p.updated_at,
         (SELECT count(*)::int FROM workspace_addons a WHERE a.package_id = p.id) AS purchases,
         (SELECT count(*)::int FROM workspace_addons a
           WHERE a.package_id = p.id AND a.status = 'active' AND (a.ends_at IS NULL OR a.ends_at > now())) AS active_purchases
  FROM plans p`);

const isZero = (m: string) => Number(m) === 0;

export function toPack(row: PackRow): AddonPack {
  return {
    id: row.uuid,
    slug: row.slug,
    name: row.name,
    subtitle: row.subtitle,
    detail: row.detail,
    amount: row.amount,
    offerAmount: row.offer_amount,
    currency: row.currency,
    billingUnit: row.billing_unit,
    billingDuration: row.billing_duration,
    billingMode: row.billing_mode,
    isFree: row.is_free,
    isLifetime: row.is_lifetime,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    // the grants column is read from the stored grants, not from a mirrored flag (TW-ADD-025 QUIRK 1)
    grants: readGrants(row.features, row.limits),
    activePurchases: row.active_purchases,
    rowVersion: row.row_version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/**
 * The operator's catalogue of billing add-ons (TW-ADD-025..030). An add-on is a row of the plan catalogue with
 * kind = 'addon': its `features` are the flags it turns on and its `limits` are the boosts it adds. Every write is
 * one privileged transaction (through the auth module's PlatformStore) that also records its audit event, which
 * Reference did not do for add-ons.
 *
 * Deliberate differences from Reference, each from the inventory's own findings:
 *   - delete is refused while any workspace owns the pack (Reference deleted it and stripped every buyer's grants
 *     while its confirm text promised the opposite); deactivate it instead, owners keep it until it ends
 *   - the Grants summary is read from the stored grants (Reference read raw columns and showed "nothing set")
 *   - the long description is part of the form and a save never clears it (Reference's form had no field for it)
 *   - the add-ons that sell a Marketplace app (`plans.marketplace_app_id`) are not here: the Marketplace owns their price and grant, so
 *     they are neither listed nor addressable (a lookup of one is "not an add-on")
 */
@Injectable()
export class AddonPackService {
  constructor(
    private readonly platform: PlatformStore,
    private readonly registry: ModuleRegistryService,
    private readonly audit: AuthAuditService,
  ) {}

  private operatorId(): number {
    const id = RequestContextStore.require().actorId;
    if (!id) throw AppError.unauthenticated();
    return id;
  }

  /** One privileged transaction; a slug race (two operators naming a pack alike) is a 409, not a 500. */
  private tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.platform.tx(fn).catch((err: unknown) => {
      if ((err as { code?: string }).code === '23505') {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          'Another change to the catalogue was saved at the same time. Reload and try again.',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    });
  }

  // --- the form's registry (TW-ADD-026) --------------------------------------------------------------------------

  /** Every flag and cap a pack can grant: the core registry plus what enabled modules contribute (TW-ADD-013). */
  async fields(): Promise<GrantFieldsResponse> {
    const [mf, ml] = await Promise.all([this.registry.planFeatures(), this.registry.planLimits()]);
    const titled = titledKey;
    const currencies = await this.platform.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT code, name FROM currencies WHERE is_active ORDER BY code`,
      );
      return res.rows as unknown as Array<{ code: string; name: string }>;
    });
    return {
      currencies,
      features: [
        ...PLAN_FEATURE_DEFS.map((d) => ({
          key: d.key,
          label: titled(d.key),
          group: d.group,
          source: 'core',
        })),
        ...mf.map((f) => ({ key: f.key, label: f.label, group: f.group, source: f.module })),
      ],
      limits: [
        ...PLAN_LIMIT_DEFS.map((d) => ({
          key: d.key,
          label: titled(d.key),
          group: d.group,
          source: 'core',
          default: null,
          hint: '',
        })),
        ...ml.map((l) => ({
          key: l.key,
          label: l.label,
          group: l.group,
          source: l.module,
          default: l.default,
          hint: l.hint,
        })),
      ],
    };
  }

  private async allowed(): Promise<AllowedKeys> {
    const f = await this.fields();
    return {
      features: new Set(f.features.map((x) => x.key)),
      limits: new Set(f.limits.map((x) => x.key)),
    };
  }

  // --- reads -----------------------------------------------------------------------------------------------------

  async list(): Promise<AddonPackListResponse> {
    const rows = await this.platform.tx(async (tx) => {
      const res = await tx.execute(
        sql`${SELECT} WHERE p.kind = 'addon' AND p.marketplace_app_id IS NULL ORDER BY p.sort_order ASC, p.amount ASC, p.slug ASC`,
      );
      return res.rows as unknown as PackRow[];
    });
    const data = rows.map(toPack);
    return { data, summary: { total: data.length, active: data.filter((p) => p.isActive).length } };
  }

  async get(uuid: string): Promise<AddonPack> {
    return this.platform.tx(async (tx) => toPack(await this.byUuid(tx, uuid)));
  }

  // --- writes ----------------------------------------------------------------------------------------------------

  async create(body: CreateAddonPayload): Promise<AddonPack> {
    const operatorId = this.operatorId();
    const allowed = await this.allowed();
    const grants = normaliseGrants(body, allowed);

    return this.tx(async (tx) => {
      const taken = await tx.execute(sql`SELECT slug FROM plans`);
      const base = /[a-z0-9]/i.test(body.name.normalize('NFKD'))
        ? slugifyPlanName(body.name)
        : 'addon';
      const slug = uniquePlanSlug(
        base,
        new Set((taken.rows as unknown as Array<{ slug: string }>).map((r) => r.slug)),
      );
      const free = isZero(body.amount);
      const res = await tx.execute(sql`
        INSERT INTO plans (slug, kind, name, subtitle, detail, amount, offer_amount, currency, billing_unit,
                           billing_duration, billing_mode, is_free, is_lifetime, is_active, sort_order, cta_label, limits, features)
        VALUES (${slug}, 'addon', ${body.name}, ${body.subtitle}, ${body.detail}, ${body.amount}::numeric,
                ${body.offerAmount}::numeric, ${body.currency}, ${body.billingUnit}, ${body.billingDuration},
                ${body.billingMode}, ${free}, ${body.isLifetime}, ${body.isActive}, ${body.sortOrder}, 'Add to plan',
                ${JSON.stringify(grants.limits)}::jsonb, ${JSON.stringify(featuresColumn(grants))}::jsonb)
        RETURNING uuid
      `);
      const uuid = (res.rows[0] as unknown as { uuid: string }).uuid;
      await this.record(tx, 'platform.addon.created', operatorId, {
        slug,
        name: body.name,
        amount: body.amount,
        currency: body.currency,
        grants,
      });
      return toPack(await this.byUuid(tx, uuid));
    });
  }

  /**
   * Partial update with optimistic locking. Fields that are present replace the stored value (a `features` list or
   * a `limits` map replaces the whole grant of that kind); the merged result must satisfy every rule a new pack
   * does. The slug and the kind never change.
   */
  async update(uuid: string, patch: UpdateAddonPayload): Promise<AddonPack> {
    const operatorId = this.operatorId();
    const allowed = await this.allowed();

    return this.tx(async (tx) => {
      const stored = await this.byUuid(tx, uuid, true);
      if (stored.row_version !== patch.rowVersion) throw AppError.rowVersionConflict('The add-on');
      const before = toPack(stored);
      const { rowVersion: _rv, ...fields } = patch;
      const defined = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
      const merged = {
        name: before.name,
        subtitle: before.subtitle,
        detail: before.detail,
        amount: before.amount,
        offerAmount: before.offerAmount,
        currency: before.currency,
        billingUnit: before.billingUnit,
        billingDuration: before.billingDuration,
        billingMode: before.billingMode,
        isLifetime: before.isLifetime,
        isActive: before.isActive,
        sortOrder: before.sortOrder,
        features: before.grants.features,
        limits: before.grants.limits,
        ...defined,
      };
      const checked = createAddonRequestSchema.safeParse(merged);
      if (!checked.success) {
        throw AppError.validation(
          'The add-on failed validation.',
          checked.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        );
      }
      const after = checked.data;
      const grants = normaliseGrants(after, allowed);
      const res = await tx.execute(sql`
        UPDATE plans SET
          name = ${after.name}, subtitle = ${after.subtitle}, detail = ${after.detail},
          amount = ${after.amount}::numeric, offer_amount = ${after.offerAmount}::numeric,
          currency = ${after.currency}, billing_unit = ${after.billingUnit},
          billing_duration = ${after.billingDuration}, billing_mode = ${after.billingMode}, is_free = ${isZero(after.amount)},
          is_lifetime = ${after.isLifetime}, is_active = ${after.isActive}, sort_order = ${after.sortOrder},
          limits = ${JSON.stringify(grants.limits)}::jsonb, features = ${JSON.stringify(featuresColumn(grants))}::jsonb
        WHERE id = ${stored.id} AND row_version = ${patch.rowVersion}
        RETURNING id
      `);
      if (res.rows.length === 0) throw AppError.rowVersionConflict('The add-on');

      const row = await this.byUuid(tx, uuid);
      const changes = diff(before, toPack(row));
      if (Object.keys(changes).length > 0) {
        await this.record(tx, 'platform.addon.updated', operatorId, {
          slug: stored.slug,
          fields: Object.keys(changes),
          changes,
        });
      }
      return toPack(row);
    });
  }

  /**
   * Sale on or off. A deactivated pack can no longer be bought and leaves the customer catalogue, but workspaces
   * that already own it keep it: "can be sold" and "is entitled" are separate (TW-ADD-029).
   */
  async setActive(uuid: string, isActive: boolean, rowVersion: number): Promise<AddonPack> {
    const operatorId = this.operatorId();
    return this.tx(async (tx) => {
      const stored = await this.byUuid(tx, uuid, true);
      if (stored.row_version !== rowVersion) throw AppError.rowVersionConflict('The add-on');
      if (stored.is_active === isActive) return toPack(stored);
      await tx.execute(sql`UPDATE plans SET is_active = ${isActive} WHERE id = ${stored.id}`);
      await this.record(
        tx,
        isActive ? 'platform.addon.activated' : 'platform.addon.deactivated',
        operatorId,
        { slug: stored.slug },
      );
      return toPack(await this.byUuid(tx, uuid));
    });
  }

  async remove(uuid: string): Promise<void> {
    const operatorId = this.operatorId();
    await this.tx(async (tx) => {
      const stored = await this.byUuid(tx, uuid, true);
      if (stored.purchases > 0) {
        throw new AppError(
          ERROR_CODES.ADD_PACK_IN_USE,
          `Cannot delete: ${stored.purchases} purchase${stored.purchases === 1 ? '' : 's'} of this add-on exist. Deactivate it instead: workspaces that own it keep it until it ends.`,
          HttpStatus.CONFLICT,
          [{ path: 'purchases', message: String(stored.purchases) }],
        );
      }
      await tx.execute(sql`DELETE FROM plans WHERE id = ${stored.id}`);
      await this.record(tx, 'platform.addon.deleted', operatorId, {
        slug: stored.slug,
        name: stored.name,
      });
    });
  }

  // --- internals -------------------------------------------------------------------------------------------------

  private async byUuid(tx: Tx, uuid: string, lock = false): Promise<PackRow> {
    const res = await tx.execute(
      lock
        ? sql`${SELECT} WHERE p.kind = 'addon' AND p.marketplace_app_id IS NULL AND p.uuid = ${uuid}::uuid FOR UPDATE OF p`
        : sql`${SELECT} WHERE p.kind = 'addon' AND p.marketplace_app_id IS NULL AND p.uuid = ${uuid}::uuid`,
    );
    const row = res.rows[0] as unknown as PackRow | undefined;
    if (!row) throw AppError.notFound('Add-on'); // a plan's id is "not an add-on" too
    return row;
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

function diff(before: AddonPack, after: AddonPack): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after) as Array<keyof AddonPack>) {
    if (key === 'rowVersion' || key === 'updatedAt') continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      out[key] = { from: before[key], to: after[key] };
    }
  }
  return out;
}

export type { AddonGrants };
