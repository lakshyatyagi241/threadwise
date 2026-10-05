import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { AddonCard, OwnedAddon, WorkspaceAddonsResponse } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { PlanEntitlementService, planKind } from '../plans-subscriptions-trials';
import { addonLiveSql, cardState, grantBullets, readGrants, titledKey } from './addon-grants';
import { ModuleRegistryService } from './module-registry.service';

interface PlanStateRow {
  plan_found: boolean;
  is_free: boolean | null;
  is_custom_quote: boolean | null;
  amount: string | null;
  plan_ends_at: string | null;
}

interface CardRow {
  id: number;
  uuid: string;
  slug: string;
  name: string;
  subtitle: string | null;
  amount: string;
  offer_amount: string | null;
  currency: string;
  is_free: boolean;
  is_lifetime: boolean;
  billing_unit: AddonCard['billingUnit'];
  billing_mode: AddonCard['billingMode'];
  billing_duration: number;
  features: unknown;
  limits: unknown;
}

/**
 * What a workspace sees of the add-on catalogue (WD-ADD-033): the packs on sale, what each grants, what the
 * workspace already owns, and whether it may buy at all. Visibility is decided here, on the server: a workspace
 * without an active paid plan gets `eligible: false` and an empty catalogue, so the answer does not depend on the
 * screen hiding a button. The purchase itself belongs to checkout. The add-ons that sell a Marketplace app are not here (the Marketplace
 * shows them on the app's own page), so neither the catalogue nor the owned list carries them.
 */
@Injectable()
export class WorkspaceAddonsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly registry: ModuleRegistryService,
    private readonly plans: PlanEntitlementService,
  ) {}

  async forCurrentWorkspace(): Promise<WorkspaceAddonsResponse> {
    const orgId = RequestContextStore.require().orgId;
    const live = sql.raw(addonLiveSql(await this.plans.graceDays()));
    return this.db.tx(async (tx) => {
      const stateRes = await tx.execute(sql`
        SELECT (p.id IS NOT NULL) AS plan_found, p.is_free, p.is_custom_quote, p.amount::text AS amount,
               s.plan_ends_at
        FROM organizations o
        LEFT JOIN plans p ON p.slug = o.plan AND p.kind = 'plan'
        LEFT JOIN org_plan_state s ON s.org_id = o.id
        WHERE o.id = ${orgId}
      `);
      const st = stateRes.rows[0] as unknown as PlanStateRow | undefined;
      // "Active paid plan": a catalogue plan that is not free and has not run out.
      const eligible =
        Boolean(st?.plan_found) &&
        planKind({
          isFree: st!.is_free ?? false,
          isCustomQuote: st!.is_custom_quote ?? false,
          amount: st!.amount ?? '0',
        }) !== 'free' &&
        (st!.plan_ends_at === null || new Date(st!.plan_ends_at) > new Date());
      if (!eligible) return { eligible: false, owned: [], catalog: [] };

      // A module's own labels win; a core key is spelled out.
      const [mf, ml] = await Promise.all([
        this.registry.planFeatures(),
        this.registry.planLimits(),
      ]);
      const labels = new Map([...mf, ...ml].map((f) => [f.key, f.label]));
      const labelOf = (key: string) => labels.get(key) ?? titledKey(key);

      const ownedRes = await tx.execute(sql`
        SELECT a.uuid, p.uuid AS pack_uuid, p.name, a.starts_at, a.ends_at, a.package_id::int AS package_id,
               EXISTS (SELECT 1 FROM subscriptions sb WHERE sb.org_id = a.org_id AND sb.workspace_addon_id = a.id
                       AND sb.kind = 'addon' AND sb.status IN ('active', 'past_due')) AS renews
        FROM workspace_addons a JOIN plans p ON p.id = a.package_id
        WHERE a.org_id = ${orgId} AND ${live}
          AND p.marketplace_app_id IS NULL
        ORDER BY a.created_at DESC, a.id DESC
      `);
      const ownedRows = ownedRes.rows as unknown as Array<{
        uuid: string;
        pack_uuid: string;
        name: string;
        starts_at: string | null;
        ends_at: string | null;
        package_id: number;
        renews: boolean;
      }>;
      const ownedCount = new Map<number, number>();
      for (const r of ownedRows)
        ownedCount.set(r.package_id, (ownedCount.get(r.package_id) ?? 0) + 1);

      const catRes = await tx.execute(sql`
        SELECT id::int AS id, uuid, slug, name, subtitle, amount::text AS amount, offer_amount::text AS offer_amount,
               currency, is_free, is_lifetime, billing_unit, billing_duration, billing_mode, features, limits
        FROM plans WHERE kind = 'addon' AND is_active AND marketplace_app_id IS NULL ORDER BY sort_order ASC, amount ASC, slug ASC
      `);
      const catalog: AddonCard[] = (catRes.rows as unknown as CardRow[]).map((r) => {
        const grants = readGrants(r.features, r.limits);
        const owned = ownedCount.get(r.id) ?? 0;
        return {
          id: r.uuid,
          slug: r.slug,
          name: r.name,
          subtitle: r.subtitle,
          amount: r.amount,
          offerAmount: r.offer_amount,
          currency: r.currency,
          isFree: r.is_free,
          isLifetime: r.is_lifetime,
          billingUnit: r.billing_unit,
          billingMode: r.billing_mode,
          billingDuration: r.billing_duration,
          grantBullets: grantBullets(grants, labelOf),
          ownedCount: owned,
          state: cardState(grants, owned),
        };
      });
      const owned: OwnedAddon[] = ownedRows.map((r) => ({
        id: r.uuid,
        packId: r.pack_uuid,
        name: r.name,
        startsAt: r.starts_at ? new Date(r.starts_at).toISOString() : null,
        endsAt: r.ends_at ? new Date(r.ends_at).toISOString() : null,
        renews: r.renews,
      }));
      return { eligible: true, owned, catalog };
    });
  }
}
