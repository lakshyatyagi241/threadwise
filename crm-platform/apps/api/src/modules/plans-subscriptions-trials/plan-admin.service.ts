import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  createPlanRequestSchema,
  type CreatePlanPayload,
  type PlanAddonOptionsResponse,
  type PlanAdminItem,
  type PlanAdminListResponse,
  type UpdatePlanPayload,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuthAuditService, SecurityPolicyService } from '../auth';
import { PlanCatalogService } from './plan-catalog.service';
import {
  PLAN_COLUMNS,
  fullFeatures,
  fullLimits,
  toAdminItem,
  withStoredUnknownFeatures,
  withStoredUnknownLimits,
  type PlanRow,
} from './plan-row';
import {
  addonOptions,
  replaceVisibleAddons,
  visibleAddonIds,
  visibleAddonIdsByPlan,
} from './plan-visible-addons';
import { planKind, slugifyPlanName, uniquePlanSlug } from './plan-rules';
import { PlanStore } from './plan-store';

/** The columns a create or update writes, in the form's own (camelCase) names. */
interface PlanFields {
  name: string;
  subtitle: string | null;
  detail: string | null;
  amount: string;
  offerAmount: string | null;
  currency: string;
  billingUnit: 'days' | 'weeks' | 'months' | 'years';
  billingDuration: number;
  isFree: boolean;
  isLifetime: boolean;
  isActive: boolean;
  isDefault: boolean;
  isHighlighted: boolean;
  isCustomQuote: boolean;
  sortOrder: number;
  ctaLabel: string;
  dataRetentionDays: number;
  limits: Record<string, number>;
  features: Record<string, boolean>;
  /** Pack uuids of the Marketplace add-ons the plan makes visible (table `plan_visible_addons`, not a column of `plans`). */
  visibleAddons: string[];
}

const toFields = (row: PlanRow, visibleAddons: string[]): PlanFields => ({
  name: row.name,
  subtitle: row.subtitle,
  detail: row.detail,
  amount: row.amount,
  offerAmount: row.offer_amount,
  currency: row.currency,
  billingUnit: row.billing_unit,
  billingDuration: row.billing_duration,
  isFree: row.is_free,
  isLifetime: row.is_lifetime,
  isActive: row.is_active,
  isDefault: row.is_default,
  isHighlighted: row.is_highlighted,
  isCustomQuote: row.is_custom_quote,
  sortOrder: row.sort_order,
  ctaLabel: row.cta_label,
  dataRetentionDays: Number(row.data_retention_days),
  // The keys the registry does not know stay in the merged value so the diff and the re-validation see the whole plan; the schema then
  // strips them, and the save puts the stored ones back (withStoredUnknown*), so a module's key survives an edit of the plan.
  limits: fullLimits(row.limits, { keepUnknown: true }),
  features: fullFeatures(row.features, { keepUnknown: true }),
  visibleAddons: [...visibleAddons].sort(),
});

/**
 * The operator's plan catalogue (TW-PLAN-001..005): list with in-use counts,
 * create, update, activate/deactivate and delete. Every write is one
 * privileged transaction that also records the security event, so a change and
 * its audit row commit together.
 *
 * Rules beyond the field validation (shared with the form in @crm/contracts):
 *   - the slug is derived once on create (name or requested slug, made unique
 *     with _2, _3...) and never changes
 *   - at most one plan is the flagged default: flagging one clears the others
 *     in the same transaction
 *   - the signup default (the registration policy's plan, or the flagged
 *     default) cannot be deactivated or deleted: sign-ups would silently fall
 *     through to another plan (TW-PLAN-004 rule 3)
 *   - a plan any organization is on cannot be deleted (TW-PLAN-005); Reference's
 *     guard missed slug-referenced workspaces, this one counts the one
 *     reference there is
 */
@Injectable()
export class PlanAdminService {
  constructor(
    private readonly store: PlanStore,
    private readonly catalog: PlanCatalogService,
    private readonly policy: SecurityPolicyService,
    private readonly audit: AuthAuditService,
  ) {}

  private operatorId(): number {
    const id = RequestContextStore.require().actorId;
    if (!id) throw AppError.unauthenticated();
    return id;
  }

  // --- reads ----------------------------------------------------------------------------------------------------------------------

  async list(): Promise<PlanAdminListResponse> {
    const registrationDefaultSlug = (await this.policy.registration()).defaultPlanId;
    const { rows, counts, visible } = await this.store.tx(async (tx) => ({
      rows: await this.catalog.listPlans(tx),
      counts: await this.inUseCounts(tx),
      visible: await visibleAddonIdsByPlan(tx),
    }));
    const data = rows.map((row) =>
      toAdminItem(row, {
        inUse: counts.get(row.slug) ?? 0,
        isRegistrationDefault: registrationDefaultSlug === row.slug,
        visibleAddons: visible.get(Number(row.id)) ?? [],
      }),
    );
    return {
      data,
      summary: {
        total: data.length,
        active: data.filter((p) => p.isActive).length,
        free: data.filter((p) => p.kind === 'free').length,
        paid: data.filter((p) => p.kind === 'paid').length,
        customQuote: data.filter((p) => p.kind === 'custom_quote').length,
      },
      registrationDefaultSlug,
    };
  }

  /** The add-on packs a plan may enable, for the plan form (every operator role reads, like the catalogue). */
  async addonOptions(): Promise<PlanAddonOptionsResponse> {
    return { data: await this.store.tx((tx) => addonOptions(tx)) };
  }

  async get(uuid: string): Promise<PlanAdminItem> {
    const registrationDefaultSlug = (await this.policy.registration()).defaultPlanId;
    return this.store.tx(async (tx) => {
      const row = await this.byUuid(tx, uuid);
      return this.item(tx, row, registrationDefaultSlug);
    });
  }

  // --- writes ---------------------------------------------------------------------------------------------------------------------

  async create(body: CreatePlanPayload): Promise<PlanAdminItem> {
    const operatorId = this.operatorId();
    const registrationDefaultSlug = (await this.policy.registration()).defaultPlanId;

    return this.store.tx(async (tx) => {
      const taken = await tx.execute(sql`SELECT slug FROM plans`);
      const slug = uniquePlanSlug(
        slugifyPlanName(body.slug ?? body.name),
        new Set((taken.rows as unknown as Array<{ slug: string }>).map((r) => r.slug)),
      );
      if (body.isDefault) await this.clearDefault(tx);

      const res = await tx.execute(sql`
        INSERT INTO plans (slug, name, subtitle, detail, amount, offer_amount, currency, billing_unit,
                           billing_duration, is_free, is_lifetime, is_active, is_default, is_highlighted,
                           is_custom_quote, sort_order, cta_label, data_retention_days, limits, features)
        VALUES (${slug}, ${body.name}, ${body.subtitle}, ${body.detail}, ${body.amount}::numeric,
                ${body.offerAmount}::numeric, ${body.currency}, ${body.billingUnit}, ${body.billingDuration},
                ${body.isFree}, ${body.isLifetime}, ${body.isActive}, ${body.isDefault}, ${body.isHighlighted},
                ${body.isCustomQuote}, ${body.sortOrder}, ${body.ctaLabel}, ${body.dataRetentionDays},
                ${JSON.stringify(withStoredUnknownLimits({}, body.limits, body.moduleLimits))}::jsonb,
                ${JSON.stringify(withStoredUnknownFeatures({}, body.features, body.moduleFeatures))}::jsonb)
        RETURNING ${PLAN_COLUMNS}
      `);
      const row = res.rows[0] as unknown as PlanRow;
      await replaceVisibleAddons(tx, Number(row.id), body.visibleAddons);
      await this.record(tx, 'platform.plan.created', operatorId, {
        slug,
        name: row.name,
        kind: planKind({
          isFree: row.is_free,
          isCustomQuote: row.is_custom_quote,
          amount: row.amount,
        }),
        amount: row.amount,
        currency: row.currency,
        isActive: row.is_active,
        isDefault: row.is_default,
        visibleAddons: body.visibleAddons.length,
      });
      return this.item(tx, row, registrationDefaultSlug);
    });
  }

  async update(uuid: string, patch: UpdatePlanPayload): Promise<PlanAdminItem> {
    const operatorId = this.operatorId();
    const registrationDefaultSlug = (await this.policy.registration()).defaultPlanId;

    return this.store.tx(async (tx) => {
      const stored = await this.byUuid(tx, uuid, true);
      const before = toFields(stored, await visibleAddonIds(tx, Number(stored.id)));
      const defined = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      ) as Partial<PlanFields>;
      const merged = {
        ...before,
        ...defined,
        limits: { ...before.limits, ...(patch.limits ?? {}) },
        features: { ...before.features, ...(patch.features ?? {}) },
        visibleAddons: patch.visibleAddons ?? before.visibleAddons,
      };

      // The merged result must satisfy every rule a new plan does (the slug is not part of it).
      const checked = createPlanRequestSchema.safeParse(merged);
      if (!checked.success) {
        throw AppError.validation(
          'The plan failed validation.',
          checked.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        );
      }
      const after = checked.data;
      this.assertNotDeactivatingDefault(stored, registrationDefaultSlug, after.isActive);

      if (after.isDefault && !stored.is_default) await this.clearDefault(tx);
      const res = await tx.execute(sql`
        UPDATE plans SET
          name = ${after.name}, subtitle = ${after.subtitle}, detail = ${after.detail},
          amount = ${after.amount}::numeric, offer_amount = ${after.offerAmount}::numeric,
          currency = ${after.currency}, billing_unit = ${after.billingUnit},
          billing_duration = ${after.billingDuration}, is_free = ${after.isFree},
          is_lifetime = ${after.isLifetime}, is_active = ${after.isActive},
          is_default = ${after.isDefault}, is_highlighted = ${after.isHighlighted},
          is_custom_quote = ${after.isCustomQuote}, sort_order = ${after.sortOrder},
          cta_label = ${after.ctaLabel}, data_retention_days = ${after.dataRetentionDays},
          limits = ${JSON.stringify(withStoredUnknownLimits(stored.limits, after.limits, after.moduleLimits))}::jsonb,
          features = ${JSON.stringify(withStoredUnknownFeatures(stored.features, after.features, after.moduleFeatures))}::jsonb
        WHERE id = ${stored.id}
        RETURNING ${PLAN_COLUMNS}
      `);
      const row = res.rows[0] as unknown as PlanRow;
      if (patch.visibleAddons !== undefined)
        await replaceVisibleAddons(tx, Number(stored.id), after.visibleAddons);

      const changes = diffFields(before, toFields(row, after.visibleAddons));
      if (Object.keys(changes).length > 0) {
        await this.record(tx, 'platform.plan.updated', operatorId, {
          slug: row.slug,
          fields: Object.keys(changes),
          changes,
        });
      }
      return this.item(tx, row, registrationDefaultSlug);
    });
  }

  async setActive(uuid: string, isActive: boolean): Promise<PlanAdminItem> {
    const operatorId = this.operatorId();
    const registrationDefaultSlug = (await this.policy.registration()).defaultPlanId;

    return this.store.tx(async (tx) => {
      const stored = await this.byUuid(tx, uuid, true);
      this.assertNotDeactivatingDefault(stored, registrationDefaultSlug, isActive);
      if (stored.is_active === isActive) return this.item(tx, stored, registrationDefaultSlug);

      const res = await tx.execute(sql`
        UPDATE plans SET is_active = ${isActive} WHERE id = ${stored.id} RETURNING ${PLAN_COLUMNS}
      `);
      const row = res.rows[0] as unknown as PlanRow;
      await this.record(
        tx,
        isActive ? 'platform.plan.activated' : 'platform.plan.deactivated',
        operatorId,
        { slug: row.slug },
      );
      return this.item(tx, row, registrationDefaultSlug);
    });
  }

  async remove(uuid: string): Promise<void> {
    const operatorId = this.operatorId();
    const registrationDefaultSlug = (await this.policy.registration()).defaultPlanId;

    await this.store.tx(async (tx) => {
      const stored = await this.byUuid(tx, uuid, true);
      this.assertNotDefault(stored, registrationDefaultSlug, 'delete');
      const inUse = (await this.inUseCounts(tx, stored.slug)).get(stored.slug) ?? 0;
      if (inUse > 0) {
        throw new AppError(
          ERROR_CODES.PLAN_IN_USE,
          `Cannot delete: ${inUse} workspace${inUse === 1 ? '' : 's'} currently use this plan. Move them to another plan first, or deactivate this one instead.`,
          HttpStatus.CONFLICT,
          [{ path: 'inUse', message: String(inUse) }],
        );
      }
      await tx.execute(sql`DELETE FROM plans WHERE id = ${stored.id}`);
      await this.record(tx, 'platform.plan.deleted', operatorId, {
        slug: stored.slug,
        name: stored.name,
      });
    });
  }

  // --- internals ------------------------------------------------------------------------------------------------------------

  private async byUuid(tx: Tx, uuid: string, lock = false): Promise<PlanRow> {
    const res = await tx.execute(
      lock
        ? sql`SELECT ${PLAN_COLUMNS} FROM plans WHERE kind = 'plan' AND uuid = ${uuid}::uuid FOR UPDATE`
        : sql`SELECT ${PLAN_COLUMNS} FROM plans WHERE kind = 'plan' AND uuid = ${uuid}::uuid`,
    );
    const row = res.rows[0] as unknown as PlanRow | undefined;
    if (!row) throw AppError.notFound('Plan');
    return row;
  }

  /** organizations per plan slug (one slug when given). */
  private async inUseCounts(tx: Tx, slug?: string): Promise<Map<string, number>> {
    const res = await tx.execute(
      slug === undefined
        ? sql`SELECT plan, count(*)::int AS n FROM organizations GROUP BY plan`
        : sql`SELECT plan, count(*)::int AS n FROM organizations WHERE plan = ${slug} GROUP BY plan`,
    );
    return new Map(
      (res.rows as unknown as Array<{ plan: string; n: number }>).map((r) => [r.plan, r.n]),
    );
  }

  private async item(tx: Tx, row: PlanRow, registrationDefaultSlug: string | null) {
    const inUse = (await this.inUseCounts(tx, row.slug)).get(row.slug) ?? 0;
    return toAdminItem(row, {
      inUse,
      isRegistrationDefault: registrationDefaultSlug === row.slug,
      visibleAddons: await visibleAddonIds(tx, Number(row.id)),
    });
  }

  private async clearDefault(tx: Tx): Promise<void> {
    await tx.execute(sql`UPDATE plans SET is_default = false WHERE is_default`);
  }

  private assertNotDeactivatingDefault(
    row: PlanRow,
    registrationDefaultSlug: string | null,
    nextActive: boolean,
  ): void {
    if (!nextActive && row.is_active)
      this.assertNotDefault(row, registrationDefaultSlug, 'deactivate');
  }

  private assertNotDefault(
    row: PlanRow,
    registrationDefaultSlug: string | null,
    verb: 'deactivate' | 'delete',
  ): void {
    if (row.is_default || registrationDefaultSlug === row.slug) {
      throw new AppError(
        ERROR_CODES.PLAN_DEFAULT_PROTECTED,
        `This plan is the signup default, so it cannot be ${verb === 'delete' ? 'deleted' : 'deactivated'}. Choose another default plan first.`,
        HttpStatus.CONFLICT,
        [{ path: 'slug', message: row.slug }],
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

/** Field-by-field before/after for the audit event; unchanged fields are left out. */
function diffFields(
  before: PlanFields,
  after: PlanFields,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after) as Array<keyof PlanFields>) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = { from: before[key], to: after[key] };
    }
  }
  return changes;
}
