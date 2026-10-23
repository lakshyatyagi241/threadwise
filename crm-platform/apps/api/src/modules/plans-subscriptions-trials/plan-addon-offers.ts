import { sql } from 'drizzle-orm';
import type { AddonPlanOffer, PlanAddonOffer, PlanAddonOfferMode } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';

/**
 * How each plan offers each plain add-on (`plan_addon_offers`, docs/specs/addons-plan-offers.md): included, paid (optionally at the plan's own price)
 * or hidden. No row = paid at the add-on's own price.
 *
 * "Included" is also written into the plan's `features`: saving an offer sets every feature the add-on grants to true when included and to false
 * otherwise, so every gate (which reads the plan's features) follows the one switch without change. Plain functions over a transaction, like
 * plan-visible-addons.ts: the operator's writes (privileged), a workspace's list and checkout (tenant) share one definition.
 */

type Raw = Record<string, unknown>;

export interface StoredOffer {
  addonId: string;
  mode: PlanAddonOfferMode;
  amount: string | null;
}

/** What a workspace's plan does with one add-on: the mode and the price it pays (the plan's own, else the add-on's). */
export interface ResolvedOffer {
  mode: PlanAddonOfferMode;
  /** The plan's own price for a paid offer, or null when the add-on's price applies. */
  amount: string | null;
}

/** The features a pack grants (the keys stored `true`). */
export const packFeatureKeys = (features: unknown): string[] =>
  features && typeof features === 'object'
    ? Object.entries(features as Record<string, unknown>)
        .filter(([, v]) => v === true)
        .map(([k]) => k)
        .sort()
    : [];

/** The stored offers of every plan at once (the operator's list), keyed by plan row id. */
export async function offersByPlan(tx: Tx): Promise<Map<number, StoredOffer[]>> {
  const res = await tx.execute(sql`
    SELECT o.plan_id::text AS plan_id, ap.uuid AS addon_id, o.mode, o.amount::text AS amount
    FROM plan_addon_offers o JOIN plans ap ON ap.id = o.addon_id
    ORDER BY ap.sort_order, ap.id`);
  const out = new Map<number, StoredOffer[]>();
  for (const r of res.rows as Raw[]) {
    const k = Number(r.plan_id);
    out.set(k, [...(out.get(k) ?? []), toStored(r)]);
  }
  return out;
}

export async function offersForPlan(tx: Tx, planId: number): Promise<StoredOffer[]> {
  return (await offersByPlan(tx)).get(planId) ?? [];
}

const toStored = (r: Raw): StoredOffer => ({
  addonId: r.addon_id as string,
  mode: r.mode as PlanAddonOfferMode,
  amount: (r.amount as string | null) ?? null,
});

interface PackRow {
  id: number;
  uuid: string;
  name: string;
  features: string[];
  /** The plain add-on's kind (stored, else derived); null for an add-on of a Marketplace app. */
  kind: 'feature' | 'capacity' | null;
  /** The Marketplace app's row id for an app's add-on (a mini app or an integration), else null. */
  appId: number | null;
}

async function offerPacks(tx: Tx, uuids: readonly string[]): Promise<Map<string, PackRow>> {
  if (uuids.length === 0) return new Map();
  const res = await tx.execute(sql`
    SELECT p.id::text AS id, p.uuid, p.name, p.features, p.limits, p.addon_kind, p.marketplace_app_id::text AS app_id,
           a.grants_plan_features AS app_features
    FROM plans p LEFT JOIN marketplace_apps a ON a.id = p.marketplace_app_id
    WHERE p.kind = 'addon' AND p.uuid = ANY(${`{${uuids.join(',')}}`}::uuid[])`);
  return new Map(
    (res.rows as Raw[]).map((r) => {
      const isApp = r.app_id !== null && r.app_id !== undefined;
      const own = packFeatureKeys(r.features);
      const hasLimits =
        r.limits && typeof r.limits === 'object'
          ? Object.values(r.limits as Record<string, unknown>).some(
              (v) => typeof v === 'number' && v !== 0,
            )
          : false;
      return [
        r.uuid as string,
        {
          id: Number(r.id),
          uuid: r.uuid as string,
          name: r.name as string,
          // An app's plan features are the ones its listing grants (never its own `mkt_` key, which only a purchase grants).
          features: isApp
            ? ((r.app_features as string[] | null) ?? []).filter((k) => !k.startsWith('mkt_'))
            : own,
          kind: isApp
            ? null
            : ((r.addon_kind as 'feature' | 'capacity' | null) ??
              (own.length === 0 && hasLimits ? 'capacity' : 'feature')),
          appId: isApp ? Number(r.app_id) : null,
        } satisfies PackRow,
      ];
    }),
  );
}

/**
 * Writes the offers named (an add-on not named keeps its stored offer) and returns the plan features they imply. For a plain add-on every
 * feature of an included one is true and of a paid or hidden one false. For an add-on of a Marketplace app (mini app or integration) the
 * features it grants follow only a CHANGE of inclusion (on when it becomes included, off when it stops), so saving a plan never switches off a
 * feature the plan carried on its own, and Paid / Hidden are stored as before in `plan_visible_addons` (a row = visible; only Included needs
 * a row here). The caller merges the features into the plan's `features` in the same transaction.
 * Refuses an unknown add-on, "included" for a capacity add-on (the plan sets its own cap) or one with no feature yet, and a price on an app.
 */
export async function writePlanOffers(
  tx: Tx,
  planId: number,
  offers: readonly PlanAddonOffer[],
): Promise<{ features: Record<string, boolean>; changed: string[] }> {
  const packs = await offerPacks(
    tx,
    offers.map((o) => o.addonId),
  );
  const issues: Array<{ path: string; message: string }> = [];
  offers.forEach((o, i) => {
    const p = packs.get(o.addonId);
    if (!p)
      issues.push({ path: `addonOffers.${i}.addonId`, message: `unknown_addon:${o.addonId}` });
    else if (p.appId !== null && o.amount !== null)
      issues.push({
        path: `addonOffers.${i}.amount`,
        message: `${p.name} keeps its own price: set it in the Marketplace.`,
      });
    else if (p.appId === null && o.mode === 'included' && p.kind === 'capacity')
      issues.push({
        path: `addonOffers.${i}.mode`,
        message: `${p.name} only adds to limits, so it cannot be included. Set the plan's own cap on the Limits tab.`,
      });
    else if (p.appId === null && o.mode === 'included' && p.features.length === 0)
      issues.push({
        path: `addonOffers.${i}.mode`,
        message: `${p.name} unlocks no feature yet, so there is nothing to include. Add its features first.`,
      });
  });
  if (issues.length > 0) throw AppError.validation('The add-on offers failed validation.', issues);

  const current = await tx.execute(sql`
    SELECT ap.uuid AS addon_id, o.mode, o.amount::text AS amount
    FROM plan_addon_offers o JOIN plans ap ON ap.id = o.addon_id
    WHERE o.plan_id = ${planId} FOR UPDATE OF o`);
  const have = new Map((current.rows as Raw[]).map((r) => [r.addon_id as string, toStored(r)]));

  const features: Record<string, boolean> = {};
  const changed: string[] = [];
  for (const o of offers) {
    const p = packs.get(o.addonId)!;
    const was = have.get(o.addonId);
    if (p.appId !== null) {
      // A mini app or an integration: Included keeps a row, Paid and Hidden none; visibility stays in plan_visible_addons.
      const wasIncluded = was?.mode === 'included';
      if (o.mode === 'included' && !wasIncluded) for (const k of p.features) features[k] = true;
      if (o.mode !== 'included' && wasIncluded)
        for (const k of p.features) features[k] = features[k] === true;
      if (o.mode === 'included') {
        if (!wasIncluded) {
          await tx.execute(sql`
            INSERT INTO plan_addon_offers (plan_id, addon_id, mode) VALUES (${planId}, ${p.id}, 'included')
            ON CONFLICT (plan_id, addon_id) DO UPDATE SET mode = 'included', amount = NULL`);
          changed.push(p.uuid);
        }
      } else if (was) {
        await tx.execute(
          sql`DELETE FROM plan_addon_offers WHERE plan_id = ${planId} AND addon_id = ${p.id}`,
        );
        changed.push(p.uuid);
      }
      const visible = await tx.execute(
        sql`SELECT 1 FROM plan_visible_addons WHERE plan_id = ${planId} AND addon_plan_id = ${p.id}`,
      );
      const isVisible = visible.rows.length > 0;
      if (o.mode === 'hidden' && isVisible) {
        await tx.execute(
          sql`DELETE FROM plan_visible_addons WHERE plan_id = ${planId} AND addon_plan_id = ${p.id}`,
        );
        if (!changed.includes(p.uuid)) changed.push(p.uuid);
      } else if (o.mode !== 'hidden' && !isVisible) {
        await tx.execute(
          sql`INSERT INTO plan_visible_addons (plan_id, addon_plan_id) VALUES (${planId}, ${p.id})`,
        );
        if (!changed.includes(p.uuid)) changed.push(p.uuid);
      }
      continue;
    }
    // A key two add-ons grant is on when ANY of them is included (included wins over paid / hidden, whatever the order).
    for (const k of p.features) features[k] = features[k] === true || o.mode === 'included';
    // "paid at the add-on's price" is the default: store no row for it, so the table holds only real decisions.
    if (o.mode === 'paid' && o.amount === null) {
      if (was) {
        await tx.execute(
          sql`DELETE FROM plan_addon_offers WHERE plan_id = ${planId} AND addon_id = ${p.id}`,
        );
        changed.push(p.uuid);
      }
      continue;
    }
    if (was && was.mode === o.mode && was.amount === o.amount) continue;
    await tx.execute(sql`
      INSERT INTO plan_addon_offers (plan_id, addon_id, mode, amount)
      VALUES (${planId}, ${p.id}, ${o.mode}, ${o.amount}::numeric)
      ON CONFLICT (plan_id, addon_id) DO UPDATE SET mode = EXCLUDED.mode, amount = EXCLUDED.amount`);
    changed.push(p.uuid);
  }
  return { features, changed };
}

/** Merges offer-implied features into a stored `features` object (keys the offers do not name keep their value). */
export const withOfferFeatures = (
  stored: Record<string, unknown>,
  implied: Record<string, boolean>,
): Record<string, unknown> => ({ ...stored, ...implied });

/** Every plan's offer of one pack (the operator's add-on list and pack editor); plans with no row read `paid`. */
export async function offersForAddon(tx: Tx, addonId: number): Promise<AddonPlanOffer[]> {
  const res = await tx.execute(sql`
    SELECT p.uuid AS plan_id, p.slug, p.name, p.is_active, (p.is_free OR p.amount = 0) AS is_free,
           o.mode, o.amount::text AS amount
    FROM plans p
    LEFT JOIN plan_addon_offers o ON o.plan_id = p.id AND o.addon_id = ${addonId}
    WHERE p.kind = 'plan'
    ORDER BY p.sort_order, p.amount, p.slug`);
  return (res.rows as Raw[]).map((r) => ({
    planId: r.plan_id as string,
    planSlug: r.slug as string,
    planName: r.name as string,
    planIsActive: Boolean(r.is_active),
    planIsFree: Boolean(r.is_free),
    mode: ((r.mode as string | null) ?? 'paid') as PlanAddonOfferMode,
    amount: (r.amount as string | null) ?? null,
    stored: r.mode !== null && r.mode !== undefined,
  }));
}

/** Every plan's offer of every plain pack at once (the operator's add-on list), keyed by pack row id. */
export async function offersByAddon(tx: Tx): Promise<Map<number, AddonPlanOffer[]>> {
  const res = await tx.execute(sql`
    SELECT ap.id::text AS addon_id, p.uuid AS plan_id, p.slug, p.name, p.is_active,
           (p.is_free OR p.amount = 0) AS is_free, o.mode, o.amount::text AS amount
    FROM plans ap
    CROSS JOIN plans p
    LEFT JOIN plan_addon_offers o ON o.plan_id = p.id AND o.addon_id = ap.id
    WHERE ap.kind = 'addon' AND ap.marketplace_app_id IS NULL AND p.kind = 'plan'
    ORDER BY p.sort_order, p.amount, p.slug`);
  const out = new Map<number, AddonPlanOffer[]>();
  for (const r of res.rows as Raw[]) {
    const k = Number(r.addon_id);
    out.set(k, [
      ...(out.get(k) ?? []),
      {
        planId: r.plan_id as string,
        planSlug: r.slug as string,
        planName: r.name as string,
        planIsActive: Boolean(r.is_active),
        planIsFree: Boolean(r.is_free),
        mode: ((r.mode as string | null) ?? 'paid') as PlanAddonOfferMode,
        amount: (r.amount as string | null) ?? null,
        stored: r.mode !== null && r.mode !== undefined,
      },
    ]);
  }
  return out;
}

/**
 * Writes one pack's offers on the plans named (by plan uuid) and sets each plan's features to match (see `writePlanOffers`). Returns the plan slugs
 * that changed, for the audit event.
 */
export async function writeAddonOffers(
  tx: Tx,
  addon: { id: number; uuid: string },
  offers: ReadonlyArray<{ planId: string; mode: PlanAddonOfferMode; amount: string | null }>,
): Promise<string[]> {
  if (offers.length === 0) return [];
  const res = await tx.execute(sql`
    SELECT id::text AS id, uuid, slug, features FROM plans
    WHERE kind = 'plan' AND uuid = ANY(${`{${offers.map((o) => o.planId).join(',')}}`}::uuid[])
    FOR UPDATE`);
  const plans = new Map(
    (res.rows as Raw[]).map((r) => [
      r.uuid as string,
      { id: Number(r.id), slug: r.slug as string, features: (r.features ?? {}) as Raw },
    ]),
  );
  const unknown = offers.filter((o) => !plans.has(o.planId));
  if (unknown.length > 0)
    throw AppError.validation(
      'Unknown plan.',
      unknown.map((o) => ({ path: 'offers', message: `unknown_plan:${o.planId}` })),
    );
  const changedSlugs: string[] = [];
  for (const o of offers) {
    const plan = plans.get(o.planId)!;
    const { features, changed } = await writePlanOffers(tx, plan.id, [
      { addonId: addon.uuid, mode: o.mode, amount: o.amount },
    ]);
    const next = withOfferFeatures(plan.features, features);
    if (JSON.stringify(next) !== JSON.stringify(plan.features))
      await tx.execute(
        sql`UPDATE plans SET features = ${JSON.stringify(next)}::jsonb WHERE id = ${plan.id}`,
      );
    if (changed.length > 0) changedSlugs.push(plan.slug);
  }
  return changedSlugs;
}

/** The offers of the workspace's plan (by slug), keyed by pack row id. A pack with no row is absent (= paid at its own price). */
export async function offersOfPlanSlug(
  tx: Tx,
  planSlug: string,
): Promise<Map<number, ResolvedOffer>> {
  const res = await tx.execute(sql`
    SELECT o.addon_id::text AS addon_id, o.mode, o.amount::text AS amount
    FROM plan_addon_offers o JOIN plans p ON p.id = o.plan_id AND p.kind = 'plan'
    WHERE p.slug = ${planSlug}`);
  return new Map(
    (res.rows as Raw[]).map((r) => [
      Number(r.addon_id),
      { mode: r.mode as PlanAddonOfferMode, amount: (r.amount as string | null) ?? null },
    ]),
  );
}

/** The offer for one pack (paid at its own price when no row). */
export const offerOf = (offers: Map<number, ResolvedOffer>, addonId: number): ResolvedOffer =>
  offers.get(addonId) ?? { mode: 'paid', amount: null };

/**
 * After a pack's features changed: every plan that INCLUDES the pack gets the new features on and the dropped ones off, so "included" keeps meaning
 * "the plan carries every feature of the add-on". Paid and hidden plans are untouched (they never carried them).
 */
export async function resyncIncludedPlans(
  tx: Tx,
  addonId: number,
  before: readonly string[],
  after: readonly string[],
): Promise<void> {
  const dropped = before.filter((k) => !after.includes(k));
  if (dropped.length === 0 && after.every((k) => before.includes(k))) return;
  const implied: Record<string, boolean> = {
    ...Object.fromEntries(dropped.map((k) => [k, false])),
    ...Object.fromEntries(after.map((k) => [k, true])),
  };
  const res = await tx.execute(sql`
    SELECT p.id::text AS id, p.features FROM plans p
    JOIN plan_addon_offers o ON o.plan_id = p.id AND o.addon_id = ${addonId} AND o.mode = 'included'
    FOR UPDATE OF p`);
  for (const r of res.rows as Raw[]) {
    const next = withOfferFeatures((r.features ?? {}) as Raw, implied);
    await tx.execute(
      sql`UPDATE plans SET features = ${JSON.stringify(next)}::jsonb WHERE id = ${Number(r.id)}`,
    );
  }
  // Plans that chose Paid or Hidden do not carry the pack: a feature it newly grants is set off there too (a default-true key would otherwise
  // stay granted). Plans with no stored offer are left alone, like on a plan save.
  const added = after.filter((k) => !before.includes(k));
  if (added.length > 0) {
    const off = Object.fromEntries(added.map((k) => [k, false]));
    const notIncluded = await tx.execute(sql`
      SELECT p.id::text AS id, p.features FROM plans p
      JOIN plan_addon_offers o ON o.plan_id = p.id AND o.addon_id = ${addonId} AND o.mode IN ('paid', 'hidden')
      FOR UPDATE OF p`);
    for (const r of notIncluded.rows as Raw[]) {
      const next = withOfferFeatures((r.features ?? {}) as Raw, off);
      await tx.execute(
        sql`UPDATE plans SET features = ${JSON.stringify(next)}::jsonb WHERE id = ${Number(r.id)}`,
      );
    }
  }
  // A pack that no longer grants any feature cannot stay included (it is a capacity add-on now): those plans fall back to paid.
  if (after.length === 0)
    await tx.execute(
      sql`DELETE FROM plan_addon_offers WHERE addon_id = ${addonId} AND mode = 'included'`,
    );
}
