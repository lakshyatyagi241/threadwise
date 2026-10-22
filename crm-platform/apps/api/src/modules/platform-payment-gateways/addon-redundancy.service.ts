import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { isIncludedInPlan, readGrants } from '../addons-extension-registry/addon-grants';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { PaygwStore } from './paygw.store';
import { SubscriptionCancelService } from './subscription-cancel.service';

/** The outbox event that tells the workspace's billing admins a renewal was stopped (see SubscriptionNotificationsConsumer). */
export const ADDON_RENEWAL_STOPPED = 'paygw.addon.renewal_stopped';

type Raw = Record<string, unknown>;

/**
 * Stops the renewal of a plain add-on whose every feature the workspace's PLAN now grants (it upgraded to a plan that includes Smart routing,
 * an operator switched its plan, a plan was edited to add the flag, an override or platform-owned status covers it). Owner decision: the
 * add-on runs to the end of the term already paid for (no refund, no early removal) and does not renew, so the workspace is not charged for
 * something it no longer needs.
 *
 * It reuses the one mechanism that exists for ending a renewal, `SubscriptionCancelService.endOne` with `atCycleEnd` (the gateway is told to
 * stop at the cycle end, the row is marked cancelled, audited and announced); a second mechanism would drift. `strict` makes a provider that
 * could not be stopped leave the row untouched, so the next pass tries again instead of pretending.
 *
 * Idempotent: only a subscription that is still active or past due is touched (past due included: it must not retry a charge), a second pass
 * finds nothing, and the notification is written only by the pass that really stopped it. Several stacked purchases are each stopped. Nothing
 * here ever turns a renewal back on: when a later plan no longer covers the add-on the card is a buyable card again. One-time and lifetime
 * packs have no subscription, so there is nothing to stop and nothing changes. When it runs: right after a plan payment is applied, and every
 * 10 minutes for every workspace that has a renewing plain add-on, which also covers an operator switching a plan or editing its Features
 * tab (decision: an edit never cancels add-ons in bulk at edit time; each workspace is evaluated on its own the next time round).
 */
@Injectable()
export class AddonRedundancyService {
  private readonly logger = new Logger(AddonRedundancyService.name);

  constructor(
    private readonly store: PaygwStore,
    private readonly plans: PlanEntitlementService,
    private readonly cancel: SubscriptionCancelService,
    private readonly outbox: OutboxService,
  ) {}

  /** Every workspace that has a renewing plain add-on, checked once. Returns how many renewals were stopped. */
  async sweep(): Promise<number> {
    const orgs = await this.store.tx(async (tx) =>
      (
        await tx.execute(sql`
          SELECT DISTINCT s.org_id FROM subscriptions s
          JOIN workspace_addons wa ON wa.org_id = s.org_id AND wa.id = s.workspace_addon_id
          JOIN plans p ON p.id = wa.package_id AND p.marketplace_app_id IS NULL
          WHERE s.kind = 'addon' AND s.status IN ('active', 'past_due')`)
      ).rows.map((r) => Number((r as Raw).org_id)),
    );
    let stopped = 0;
    for (const orgId of orgs) {
      try {
        stopped += await this.stopForWorkspace(orgId);
      } catch (err) {
        this.logger.error({ err, orgId }, 'stopping a redundant add-on renewal failed');
      }
    }
    return stopped;
  }

  /** Stops the renewals of the workspace's add-ons that its plan already covers. Returns how many. */
  async stopForWorkspace(orgId: number): Promise<number> {
    const rows = await this.store.tx(
      async (tx) =>
        (
          await tx.execute(sql`
          SELECT s.id AS sub_id, p.slug, p.name, p.features, p.limits, wa.ends_at
          FROM subscriptions s
          JOIN workspace_addons wa ON wa.org_id = s.org_id AND wa.id = s.workspace_addon_id
          JOIN plans p ON p.id = wa.package_id AND p.marketplace_app_id IS NULL
          WHERE s.org_id = ${orgId} AND s.kind = 'addon' AND s.status IN ('active', 'past_due')
          ORDER BY s.id`)
        ).rows as Raw[],
    );
    if (rows.length === 0) return 0;
    const packs = rows.map((r) => ({ r, grants: readGrants(r.features, r.limits) }));
    const included = await this.plans.includedByPlan(
      orgId,
      packs.flatMap((p) => p.grants.features),
    );
    const planName = (await this.plans.forOrg(orgId, { ignorePacks: true }))?.planName ?? null;
    let stopped = 0;
    for (const { r, grants } of packs) {
      if (!isIncludedInPlan(grants, included)) continue;
      const out = await this.cancel.endOne(orgId, Number(r.sub_id), {
        atCycleEnd: true,
        reason: 'plan_includes',
        actor: { id: null, type: 'system' },
        strict: true,
      });
      // null: not renewing any more (someone got there first). A provider that could not be stopped leaves the row alone, retried next pass.
      if (out === null || (out.result !== 'ok' && out.result !== 'unsupported')) continue;
      stopped += 1;
      await this.store.tx((tx) =>
        this.outbox.emit(tx, {
          aggregateModule: 'subscriptions',
          aggregateId: Number(r.sub_id),
          orgId,
          eventType: ADDON_RENEWAL_STOPPED,
          payload: {
            pack: String(r.slug),
            packName: String(r.name),
            plan: planName,
            endsAt: r.ends_at ? new Date(r.ends_at as string).toISOString() : null,
          },
        }),
      );
    }
    return stopped;
  }
}
