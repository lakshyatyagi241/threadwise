import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  planOverridesSchema,
  type AttachPlanRequest,
  type PlanOverrides,
  type WorkspaceAddons,
  type WorkspacePlan,
  type WorkspacePlanListQuery,
  type WorkspacePlanListResponse,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { AuthAuditService } from '../auth';
import { defaultPeriodEnd, planStateOf, validityForState } from './plan-lifecycle';
import { PLAN_COLUMNS, fullFeatures, fullLimits, toFacts, type PlanRow } from './plan-row';
import { PlanStore } from './plan-store';
import { workspaceAddons } from './plan-visible-addons';
import { planKind } from './plan-rules';

interface OrgPlanRow {
  id: string | number;
  uuid: string;
  slug: string;
  name: string;
  status: string;
  plan: string;
  trial_ends_at: string | null;
  plan_ends_at: string | null;
  billing_cycle: 'trial' | 'monthly' | 'yearly' | null;
  overrides: unknown;
  platform_owned: boolean | null;
  row_version: number | null;
  plan_name: string | null;
  plan_limits: unknown;
  plan_features: unknown;
  plan_found: boolean;
  plan_row_id: string | null;
  plan_is_free: boolean | null;
  plan_is_custom_quote: boolean | null;
  plan_amount: string | null;
}

const ORG_PLAN_SELECT = sql`
  o.id, o.uuid, o.slug, o.name, o.status, o.plan,
  s.trial_ends_at, s.plan_ends_at, s.billing_cycle, s.overrides, s.platform_owned, s.row_version,
  p.name AS plan_name, p.limits AS plan_limits, p.features AS plan_features, (p.id IS NOT NULL) AS plan_found, p.id AS plan_row_id,
  p.is_free AS plan_is_free, p.is_custom_quote AS plan_is_custom_quote, p.amount::text AS plan_amount
  FROM organizations o
  LEFT JOIN org_plan_state s ON s.org_id = o.id
  LEFT JOIN plans p ON p.slug = o.plan AND p.kind = 'plan'`;

const CURSOR_RE = /^\d{1,18}$/;

/**
 * The super admin's per-workspace plan console: list workspaces with their plan, attach a plan, set the workspace's own caps and
 * flags (overrides beat the plan, TW-PLAN-007 rule 1). Only super admins reach it (the controller's role list). Every write is one
 * privileged transaction that also writes the operator security event, the workspace's audit row and the outbox event.
 *
 * Attaching a DIFFERENT plan clears the trial and stamps `plan_ends_at` from the plan's period unless a date is given
 * (WSP-026 rule: only when the plan actually changes); attaching the same plan only edits the date and the overrides.
 */
@Injectable()
export class WorkspacePlanAdminService {
  constructor(
    private readonly store: PlanStore,
    private readonly audit: AuthAuditService,
    private readonly outbox: OutboxService,
  ) {}

  async list(query: WorkspacePlanListQuery): Promise<WorkspacePlanListResponse> {
    const after = query.cursor && CURSOR_RE.test(query.cursor) ? query.cursor : null;
    const search = query.search ? `%${query.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const { rows, addons } = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT ${ORG_PLAN_SELECT}
        WHERE (${after}::bigint IS NULL OR o.id < ${after}::bigint)
          AND (${search}::text IS NULL OR o.name ILIKE ${search} OR o.slug ILIKE ${search})
          AND (${query.plan ?? null}::text IS NULL OR o.plan = ${query.plan ?? null})
        ORDER BY o.id DESC
        LIMIT ${query.limit + 1}
      `);
      const found = res.rows as unknown as OrgPlanRow[];
      const page = found.slice(0, query.limit);
      const byOrg = new Map<string, WorkspaceAddons>();
      for (const r of page) byOrg.set(String(r.id), await addonsOf(tx, r));
      return { rows: found, addons: byOrg };
    });
    const page = rows.slice(0, query.limit);
    return {
      data: page.map((r) => toWorkspacePlan(r, addons.get(String(r.id))!)),
      nextCursor: rows.length > query.limit ? String(page[page.length - 1]!.id) : null,
    };
  }

  async get(uuid: string): Promise<WorkspacePlan> {
    return this.store.tx(async (tx) => {
      const row = await this.load(tx, uuid);
      return toWorkspacePlan(row, await addonsOf(tx, row));
    });
  }

  async attach(uuid: string, body: AttachPlanRequest): Promise<WorkspacePlan> {
    const ctx = RequestContextStore.require();
    if (!ctx.actorId) throw AppError.unauthenticated();
    const operatorId = ctx.actorId;

    return this.store.tx(async (tx) => {
      const org = await this.load(tx, uuid, true);
      const orgId = Number(org.id);
      const target = await this.plan(tx, body.planSlug);
      if (!target) throw AppError.notFound('Plan');

      // The row version belongs to org_plan_state; a workspace that predates it has none and is version 1.
      if ((org.row_version ?? 1) !== body.rowVersion)
        throw AppError.rowVersionConflict('WorkspacePlan');

      const now = new Date();
      const changing = org.plan !== target.slug;
      const facts = toFacts(target);
      let trialEndsAt: string | null = changing ? null : org.trial_ends_at;
      if (body.trialEndsAt !== undefined) trialEndsAt = body.trialEndsAt;
      let planEndsAt: string | null = org.plan_ends_at;
      if (body.planEndsAt !== undefined) planEndsAt = body.planEndsAt;
      else if (changing) planEndsAt = defaultPeriodEnd(now, facts)?.toISOString() ?? null;
      if (planKind(facts) === 'free' && body.planEndsAt === undefined) planEndsAt = null;

      const overrides: PlanOverrides = body.overrides ?? parseOverrides(org.overrides);
      const cycle = trialEndsAt
        ? 'trial'
        : org.billing_cycle === 'trial' || !org.billing_cycle
          ? 'monthly'
          : org.billing_cycle;

      if (changing)
        await tx.execute(sql`UPDATE organizations SET plan = ${target.slug} WHERE id = ${orgId}`);
      await tx.execute(sql`
        INSERT INTO org_plan_state (org_id, trial_ends_at, plan_ends_at, billing_cycle, overrides)
        VALUES (${orgId}, ${trialEndsAt}, ${planEndsAt}, ${cycle}, ${JSON.stringify(overrides)}::jsonb)
        ON CONFLICT (org_id) DO UPDATE
          SET trial_ends_at = EXCLUDED.trial_ends_at, plan_ends_at = EXCLUDED.plan_ends_at,
              billing_cycle = EXCLUDED.billing_cycle, overrides = EXCLUDED.overrides
      `);

      const payload = {
        workspace: org.slug,
        plan: { from: org.plan, to: target.slug },
        planEndsAt,
        trialEndsAt,
        overrides,
      };
      await this.audit.record(tx, {
        event: 'platform.workspace.plan_attached',
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        orgId,
        payload,
      });
      // The workspace's own audit trail (the security event above is the operator's).
      await tx.execute(sql`
        INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta, request_id)
        VALUES (${orgId}, ${operatorId}, 'platform_operator', 'plans', ${orgId}, 'update',
          ${JSON.stringify({ plan: { old: org.plan, new: target.slug }, planEndsAt: { old: org.plan_ends_at, new: planEndsAt }, overrides: { old: parseOverrides(org.overrides), new: overrides } })}::jsonb,
          ${ctx.requestId ?? null})
      `);
      await this.outbox.emit(tx, {
        aggregateModule: 'plans',
        aggregateId: orgId,
        eventType: 'plan.attached',
        orgId,
        payload: { from: org.plan, to: target.slug, planEndsAt },
      });
      const row = await this.load(tx, uuid);
      return toWorkspacePlan(row, await addonsOf(tx, row));
    });
  }

  // --- internals ----------------------------------------------------------------------------------------------------------------

  private async load(tx: Tx, uuid: string, lock = false): Promise<OrgPlanRow> {
    const res = await tx.execute(
      lock
        ? sql`SELECT ${ORG_PLAN_SELECT} WHERE o.uuid = ${uuid}::uuid FOR UPDATE OF o`
        : sql`SELECT ${ORG_PLAN_SELECT} WHERE o.uuid = ${uuid}::uuid`,
    );
    const row = res.rows[0] as unknown as OrgPlanRow | undefined;
    if (!row) throw AppError.notFound('Workspace');
    return row;
  }

  private async plan(tx: Tx, slug: string): Promise<PlanRow | null> {
    const res = await tx.execute(
      sql`SELECT ${PLAN_COLUMNS} FROM plans WHERE kind = 'plan' AND slug = ${slug} FOR SHARE`,
    );
    return (res.rows[0] as unknown as PlanRow | undefined) ?? null;
  }
}

function parseOverrides(raw: unknown): PlanOverrides {
  const parsed = planOverridesSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { limits: {}, features: {}, dataRetentionDays: null };
}

/** What the workspace owns of the Marketplace versus what its plan makes visible (a platform-owned workspace is shown everything). */
function addonsOf(tx: Tx, r: OrgPlanRow): Promise<WorkspaceAddons> {
  return workspaceAddons(
    tx,
    Number(r.id),
    r.plan_row_id === null ? null : Number(r.plan_row_id),
    r.platform_owned ?? false,
  );
}

export function toWorkspacePlan(
  r: OrgPlanRow,
  addons: WorkspaceAddons,
  now = new Date(),
): WorkspacePlan {
  const trialEndsAt = r.trial_ends_at ? new Date(r.trial_ends_at) : null;
  const planEndsAt = r.plan_ends_at ? new Date(r.plan_ends_at) : null;
  const state = planStateOf({
    plan: r.plan_found
      ? {
          isFree: r.plan_is_free ?? false,
          isCustomQuote: r.plan_is_custom_quote ?? false,
          amount: r.plan_amount ?? '0.00',
        }
      : null,
    trialEndsAt,
    planEndsAt,
    now,
  });
  return {
    workspaceId: r.uuid,
    slug: r.slug,
    name: r.name,
    status: r.status,
    planSlug: r.plan,
    planName: r.plan_name,
    planKnown: r.plan_found,
    platformOwned: r.platform_owned ?? false,
    validity: validityForState(state, { trialEndsAt, planEndsAt, now }),
    billingCycle: r.billing_cycle ?? 'monthly',
    overrides: parseOverrides(r.overrides),
    planLimits: fullLimits(r.plan_limits),
    planFeatures: fullFeatures(r.plan_features),
    addons,
    rowVersion: r.row_version ?? 1,
  };
}
