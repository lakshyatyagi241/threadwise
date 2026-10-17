import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { AddonFulfilmentHooks, AddonTermEventKind } from '../addons-extension-registry';
import { text, type SubRow } from './subscription-row';

/**
 * Tells the add-ons domain's listeners (the Marketplace's subscription ledger) what just happened to the autopay subscription behind an
 * add-on purchase, in the transaction that applied it. A subscription that is not an add-on's, an add-on that does not sell a Marketplace
 * app, and one whose purchase cannot be found announce nothing. Read-only apart from what the listeners write.
 *
 * Shared by the lifecycle service (the provider's events and the reconciler) and the cancel service (an end we made), which cannot import
 * each other.
 */
export async function announceAddonTerm(
  tx: Tx,
  hooks: AddonFulfilmentHooks,
  sub: SubRow,
  kind: AddonTermEventKind,
  extra: {
    paymentId?: string | null;
    reason?: 'user' | 'superseded' | 'downgrade' | 'operator' | 'provider' | 'expired';
  } = {},
): Promise<void> {
  if (sub.kind !== 'addon') return;
  const number = text(sub.meta.order_number);
  const res = await tx.execute(
    sub.workspaceAddonId !== null
      ? sql`
          SELECT a.id, a.package_id, a.ends_at, p.slug, p.marketplace_app_id
          FROM workspace_addons a JOIN plans p ON p.id = a.package_id
          WHERE a.org_id = ${sub.orgId} AND a.id = ${sub.workspaceAddonId}`
      : sql`
          SELECT a.id, a.package_id, a.ends_at, p.slug, p.marketplace_app_id
          FROM workspace_addons a
            JOIN plans p ON p.id = a.package_id
            JOIN orders o ON o.org_id = a.org_id AND o.id = a.order_id
          WHERE a.org_id = ${sub.orgId} AND o.order_number = ${number ?? ''} LIMIT 1`,
  );
  const r = res.rows[0] as
    | {
        id: number | string;
        package_id: number | string;
        ends_at: string | null;
        slug: string;
        marketplace_app_id: number | string | null;
      }
    | undefined;
  if (!r || r.marketplace_app_id === null) return;
  await hooks.runTerm(tx, {
    kind,
    orgId: sub.orgId,
    packId: Number(r.package_id),
    packSlug: r.slug,
    marketplaceAppId: Number(r.marketplace_app_id),
    workspaceAddonId: Number(r.id),
    endsAt: r.ends_at ? new Date(r.ends_at) : null,
    paymentId: extra.paymentId ?? null,
    ...(extra.reason ? { reason: extra.reason } : {}),
  });
}
