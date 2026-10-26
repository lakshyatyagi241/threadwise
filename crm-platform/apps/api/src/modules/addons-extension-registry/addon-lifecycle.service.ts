import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  PLAN_FEATURE_LABELS,
  featureDependents,
  type AddonActivationResponse,
  type AddonImpact,
  type AddonImpactItem,
  type PlanFeatureKey,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { RbacService } from '../../kernel/rbac/rbac.service';
import {
  PlanEntitlementService,
  activationOf,
  resolveFeature,
  setActivation,
} from '../plans-subscriptions-trials';
import { isIncludedInPlan, readGrants } from './addon-grants';

const AUDIT_MODULE = 'addons';
const label = (k: string) => PLAN_FEATURE_LABELS[k as PlanFeatureKey] ?? k.replace(/_/g, ' ');

interface PackRow {
  id: number;
  uuid: string;
  slug: string;
  name: string;
  features: unknown;
  limits: unknown;
  marketplace_app_id: number | null;
}

/**
 * Turning an add-on the plan includes off and on again (docs/specs/addons-lifecycle-and-permissions.md, phase 1). The workspace's own switch
 * (`workspace_addon_activation`) is separate from the plan's offer: the offer says the workspace MAY have it, the switch says it has it on. Off
 * means the features the add-on grants stop applying (the resolver every gate asks), and so does every feature that needs one of them; the
 * settings, the data and the roles' permissions are kept and come back when it is switched on.
 *
 * Only an add-on the PLAN includes can be switched here. One the workspace bought is cancelled from its renewal (it is paid for), and the add-on
 * of a Marketplace app is installed, disabled and uninstalled from the Marketplace (which writes the same switch).
 */
@Injectable()
export class AddonLifecycleService {
  constructor(
    private readonly db: DatabaseService,
    private readonly plans: PlanEntitlementService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly rbac: RbacService,
  ) {}

  /** What switching the add-on off (or on) does for this workspace, in codes the screen words. Reads only. */
  async impact(packUuid: string, action: 'disable' | 'enable'): Promise<AddonImpact> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const pack = await this.pack(tx, packUuid);
      await this.assertToggleable(orgId, pack);
      const grants = readGrants(pack.features, pack.limits);
      const items: AddonImpactItem[] = [];
      const base = { count: 0, names: [] as string[], risk: false };
      if (action === 'enable') {
        items.push({ ...base, code: 'features_off', names: grants.features.map(label) });
        items.push({ ...base, code: 'kept' });
        return this.result(pack, action, items);
      }

      const e = await this.plans.forOrg(orgId);
      const live = grants.features.filter(
        (k) => e !== null && resolveFeature(e, k as PlanFeatureKey),
      );
      items.push({ ...base, code: 'features_off', names: live.map(label) });

      // Features that need one of these and are on now: they stop with it (declared once in the registry).
      const dependents = [
        ...new Set(
          live
            .flatMap((k) => featureDependents(k))
            .filter(
              (d) =>
                !grants.features.includes(d) &&
                e !== null &&
                resolveFeature(e, d as PlanFeatureKey),
            ),
        ),
      ];
      if (dependents.length > 0)
        items.push({
          ...base,
          code: 'dependents_off',
          names: dependents.map(label),
          count: dependents.length,
          risk: true,
        });

      // Roles that hold permissions of these features keep them, inactive until it is back on.
      const affected = [...live, ...dependents];
      if (affected.length > 0) {
        const roles = await tx.execute(sql`
          SELECT count(DISTINCT g.role_id)::int AS n
          FROM role_grants g JOIN permission_defs d ON d.key = g.permission_key
          WHERE g.org_id = ${orgId} AND g.effect = 'allow' AND d.plan_feature = ANY(${`{${affected.join(',')}}`}::text[])`);
        const n = Number((roles.rows[0] as { n: number } | undefined)?.n ?? 0);
        if (n > 0) items.push({ ...base, code: 'roles_dormant', count: n });
      }

      if (live.includes('inbox_routing')) {
        const [waiting, rules, teams] = await Promise.all([
          this.count(
            tx,
            sql`SELECT count(*)::int AS n FROM conversations WHERE org_id = ${orgId} AND handling = 'waiting'`,
          ),
          this.count(
            tx,
            sql`SELECT count(*)::int AS n FROM routing_rules WHERE org_id = ${orgId} AND is_active`,
          ),
          this.count(
            tx,
            sql`SELECT count(*)::int AS n FROM teams WHERE org_id = ${orgId} AND assignment_strategy <> 'manual'`,
          ),
        ]);
        // Waiting chats stop being routed automatically: someone claims them by hand.
        if (waiting > 0) items.push({ ...base, code: 'waiting_chats', count: waiting, risk: true });
        if (rules > 0) items.push({ ...base, code: 'routing_rules', count: rules });
        if (teams > 0) items.push({ ...base, code: 'auto_teams', count: teams });
      }
      if (live.includes('custom_roles') || live.includes('team_hierarchy')) {
        const [teams, holders] = await Promise.all([
          this.count(tx, sql`SELECT count(*)::int AS n FROM teams WHERE org_id = ${orgId}`),
          this.count(
            tx,
            sql`SELECT count(DISTINCT ur.user_id)::int AS n FROM user_roles ur JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id
                WHERE ur.org_id = ${orgId} AND r.system_key IS NULL`,
          ),
        ]);
        if (teams > 0) items.push({ ...base, code: 'teams', count: teams });
        if (holders > 0)
          items.push({
            ...base,
            code: 'custom_role_holders',
            count: holders,
            risk: live.includes('custom_roles'),
          });
      }
      items.push({ ...base, code: 'kept' });
      return this.result(pack, action, items);
    });
  }

  /** Switches the add-on off for the workspace. The caller has seen the impact (the route requires `confirm`). Idempotent. */
  async disable(packUuid: string): Promise<AddonActivationResponse> {
    return this.change(packUuid, 'disabled');
  }

  /** Switches it back on. Settings and data are as they were left; roles' permissions apply again. Idempotent. */
  async enable(packUuid: string): Promise<AddonActivationResponse> {
    return this.change(packUuid, 'active');
  }

  // --- internals ------------------------------------------------------------------------------------------------------------------

  private async change(
    packUuid: string,
    state: 'active' | 'disabled',
  ): Promise<AddonActivationResponse> {
    const ctx = RequestContextStore.require();
    const res = await this.db.tx(async (tx) => {
      const pack = await this.pack(tx, packUuid);
      await this.assertToggleable(ctx.orgId, pack);
      const was = (await activationOf(tx, ctx.orgId)).get(pack.id) ?? 'active';
      await setActivation(tx, ctx.orgId, pack.id, state, { userId: ctx.userId ?? null });
      if (was !== state) {
        await this.audit.record(tx, {
          module: AUDIT_MODULE,
          recordId: pack.id,
          action: 'update',
          delta: { activation: { old: was, new: state }, addon: { old: null, new: pack.slug } },
        });
        await this.outbox.emit(tx, {
          orgId: ctx.orgId,
          aggregateModule: AUDIT_MODULE,
          aggregateId: pack.id,
          eventType: state === 'disabled' ? 'addon.disabled' : 'addon.enabled',
          payload: { addon: pack.slug, by: ctx.userId ?? null },
        });
      }
      return {
        changed: was !== state,
        body: { addonId: pack.uuid, activation: state, changedAt: new Date().toISOString() },
      };
    });
    // The effective permissions of this workspace's people follow the add-on (phase 3 reads them): drop their cached grants now.
    if (res.changed) await this.rbac.bumpRolesVersion(ctx.orgId);
    return res.body;
  }

  private async pack(tx: Tx, uuid: string): Promise<PackRow> {
    const res = await tx.execute(sql`
      SELECT id::int AS id, uuid, slug, name, features, limits, marketplace_app_id::int AS marketplace_app_id
      FROM plans WHERE kind = 'addon' AND uuid = ${uuid}::uuid`);
    const row = res.rows[0] as unknown as PackRow | undefined;
    if (!row) throw AppError.notFound('Add-on');
    return row;
  }

  /** Only a plain add-on the workspace's PLAN includes is switched here (see the class comment). */
  private async assertToggleable(orgId: number, pack: PackRow): Promise<void> {
    const refuse = (message: string) =>
      new AppError(
        ERROR_CODES.PAYGW_ADDON_NOT_TOGGLEABLE,
        message,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    if (pack.marketplace_app_id !== null)
      throw refuse(
        'This add-on belongs to an app. Install, disable or uninstall it from the Marketplace.',
      );
    const grants = readGrants(pack.features, pack.limits);
    const { included } = await this.plans.includedByPlanDetailed(orgId, grants.features);
    if (!isIncludedInPlan(grants, included))
      throw refuse(
        'Only an add-on your plan includes can be switched here. A bought add-on is stopped by cancelling its renewal.',
      );
  }

  private async count(tx: Tx, q: ReturnType<typeof sql>): Promise<number> {
    const res = await tx.execute(q);
    return Number((res.rows[0] as { n: number } | undefined)?.n ?? 0);
  }

  private result(
    pack: PackRow,
    action: 'disable' | 'enable',
    items: AddonImpactItem[],
  ): AddonImpact {
    return {
      addon: { id: pack.uuid, name: pack.name, slug: pack.slug },
      action,
      items,
      requiresConfirm: items.some((i) => i.risk),
    };
  }
}
