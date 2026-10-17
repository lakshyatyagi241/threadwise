import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES, setMarketPricingSchema, type MarketOperatorAppDetail } from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { AuthAuditService } from '../../auth';
import { OperatorCatalogueService } from '../operator-catalogue.service';
import { OperatorCatalogueStore } from '../operator-catalogue.store';
import { OperatorPricingService } from '../operator-pricing.service';
import type { SeedAppOptions } from './seed-app.args';
import type { SeedAppConfig } from './seed-app.config';

/**
 * What the platform operator would do in the console to turn a seeded first-party listing (Appointments, Forms; see seed-app.config.ts) into a live, paid app, done through the same
 * services the console calls (so validation, the billing add-on, entitlements and audit rows behave exactly as they do there):
 *
 *   1. set the price (creates the add-on pack that sells the app)       OperatorPricingService.setPricing
 *   2. comp: the workspaces already using the feature (Appointments only), or the ones named by --workspace / --all-workspaces
 *                                                                       OperatorPricingService.grandfather / .comp
 *   3. approve the first version and publish the listing                 OperatorCatalogueService.approve / .publish
 *   4. where the plan -> add-on visibility table exists, enable the add-on on every active plan
 *   5. install the app in every workspace comped for it (a subscription alone turns nothing on: the app must be installed too, so a
 *      seeded demo that only comped would show a locked menu); the same thing the install button does, without the consent screen
 *
 * Comp comes before publish on purpose: the comp reads what each workspace has now (docs/api/marketplace.md, "Appointments is the first
 * paid first-party app").
 *
 * It never overwrites a decision an operator took: an existing price stays (unless `force`), a published, hidden or killed listing is not
 * touched, and a workspace that already has a subscription is not comped again. A second run changes nothing.
 */

export interface Snapshot {
  status: string;
  price: string;
  pack: string;
  version: string;
  subscriptions: string;
  visibility: string;
}

export interface SeedOutcome {
  /** One line per thing done (or, in a dry run, that would be done). Empty = nothing to do. */
  actions: string[];
  /** Things deliberately left alone, with the reason. */
  notes: string[];
  before: Snapshot;
  after: Snapshot;
  operator: { id: number; email: string; role: string } | null;
}

const asAppError = (err: unknown, code: string): AppError | null =>
  err instanceof AppError && (err.code as string) === code ? err : null;

export const priceLabel = (p: { amount: string | null; currency: string | null }): string =>
  p.amount === null ? 'not set' : `${p.amount} ${p.currency ?? ''}`.trim();

type Raw = Record<string, unknown>;

export async function runSeedApp(
  app: INestApplicationContext,
  config: SeedAppConfig,
  opts: SeedAppOptions,
  say: (line: string) => void = () => undefined,
): Promise<SeedOutcome> {
  const APP_SLUG = config.slug;
  const compNote = config.grandfatherExisting
    ? `Existing ${config.usageNoun} users keep it (local development seed)`
    : 'Comped for local development (seed)';
  const catalogue = app.get(OperatorCatalogueService, { strict: false });
  const pricing = app.get(OperatorPricingService, { strict: false });
  const store = app.get(OperatorCatalogueStore, { strict: false });
  const audit = app.get(AuthAuditService, { strict: false });

  // --- who acts ---------------------------------------------------------------------------------------------------------------------
  // The services take a platform operator's id (it is stored on the comp and on the audit rows). A developer who never opened the console
  // still has the seeded super admin (`seed:auth`), so that one is the actor.
  const operator = await store.tx(async (tx) => {
    const res = await tx.execute(sql`
      SELECT id, email, role FROM platform_operators
      WHERE status = 'active' AND role = 'super_admin' ORDER BY id LIMIT 1`);
    const r = res.rows[0] as Raw | undefined;
    return r ? { id: Number(r.id), email: String(r.email), role: String(r.role) } : null;
  });
  if (!operator && !opts.dryRun)
    throw new Error(
      'There is no active platform operator with the super_admin role to act as. Run `pnpm --filter @crm/api seed:auth` (creates operator@example.test) or `operator:create`, then run this again.',
    );

  const operatorId = operator?.id ?? 0;
  return RequestContextStore.run(
    {
      requestId: randomUUID(),
      orgId: 0,
      actorType: 'platform_operator',
      actorId: operator?.id ?? null,
      userId: null,
      operatorRole: 'super_admin',
    },
    async () => {
      const actions: string[] = [];
      const notes: string[] = [];
      const dry = opts.dryRun;
      const would = (text: string): string => (dry ? `would ${text}` : text);

      const load = async (): Promise<MarketOperatorAppDetail> => {
        try {
          return await catalogue.getApp(APP_SLUG);
        } catch (err) {
          if (asAppError(err, ERROR_CODES.MKT_APP_NOT_FOUND))
            throw new Error(
              `The "${config.slug}" listing does not exist. Run the database migrations first (pnpm db:migrate): migration ${config.migration} seeds it.`,
            );
          throw err;
        }
      };

      let detail = await load();
      const before = await snapshot(store, detail, APP_SLUG);
      say(
        operator
          ? `acting as: platform operator ${operator.email} (${operator.role}, id ${operator.id}), the seeded operator found by role, no console sign-in needed`
          : 'acting as: (none: dry run, and no super_admin operator exists yet)',
      );

      // --- 1. price and add-on ---------------------------------------------------------------------------------------------------------
      const p = detail.pricing;
      const priced = p.model === 'paid_monthly' && p.amount !== null;
      const same = priced && p.amount === opts.price && p.currency === opts.currency;
      if (priced && !same && !opts.force) {
        notes.push(
          `price: an operator already set ${priceLabel(p)}; kept (the requested ${opts.price} ${opts.currency} is not applied without --force)`,
        );
      } else if (!priced || !same || p.packSlug === null) {
        const input = setMarketPricingSchema.parse({
          rowVersion: detail.rowVersion,
          model: 'paid_monthly',
          amount: opts.price,
          currency: opts.currency,
          annualAmount: p.annualAmount,
          billingMode: p.billingMode,
          trialDays: p.trialDays,
          purchasable: p.purchasable,
          includedPlanFeature: p.includedPlanFeature,
          includedMinPlan: p.includedMinPlan,
          grantsPlanFeatures: [...new Set([...p.grantsPlanFeatures, config.feature])],
          grandfatherExisting: config.grandfatherExisting,
        });
        if (!dry) await pricing.setPricing(APP_SLUG, input, operatorId);
        actions.push(
          priced && !same
            ? would(
                `replace the price ${priceLabel(p)} with ${opts.price} ${opts.currency} (--force) and refresh the add-on`,
              )
            : would(
                `set the price to ${opts.price} ${opts.currency} per month and create the add-on that sells the app`,
              ),
        );
        if (!dry) detail = await load();
      } else {
        notes.push(
          `price: already ${priceLabel(p)} with its add-on (${p.packSlug}); nothing to do`,
        );
      }

      // --- 2. comp ----------------------------------------------------------------------------------------------------------------
      // --workspace / --all-workspaces name who is comped. Otherwise an app with existing users (Appointments) comps the workspaces
      // already using the feature; an app without any (Forms) comps nobody.
      const priceNowSet =
        detail.pricing.model === 'paid_monthly' &&
        detail.pricing.amount !== null &&
        detail.pricing.packSlug !== null;
      if (opts.workspace) {
        await compWorkspaces([opts.workspace]);
      } else if (opts.allWorkspaces) {
        const all = await store.tx(async (tx) => {
          const res = await tx.execute(
            sql`SELECT slug FROM organizations WHERE status = 'active' ORDER BY id`,
          );
          return (res.rows as Raw[]).map((r) => String(r.slug));
        });
        say(`--all-workspaces: ${all.length} workspace(s): ${all.join(', ') || '(none)'}`);
        await compWorkspaces(all);
      } else if (!config.grandfatherExisting) {
        notes.push(
          `comp: nobody is comped (no workspace used ${config.label} before it existed); use --workspace <slug> to comp one workspace`,
        );
      } else if (!priceNowSet) {
        // Dry run on an unpriced listing: there is no add-on to comp against yet.
        actions.push(
          `would then comp every workspace already using ${config.usageNoun} (counted once the price is set)`,
        );
      } else {
        try {
          const found = await pricing.grandfather(
            APP_SLUG,
            { months: null, note: compNote, dryRun: true },
            operatorId,
          );
          if (found.matched === 0) {
            notes.push(
              `comp: no workspace is waiting for it (everyone already using ${config.usageNoun} has a subscription)`,
            );
          } else {
            if (!dry)
              await pricing.grandfather(
                APP_SLUG,
                { months: null, note: compNote, dryRun: false },
                operatorId,
              );
            actions.push(
              would(
                `comp ${found.matched} workspace(s) already using ${config.usageNoun}: ${found.sample
                  .slice(0, 5)
                  .map((s) => s.name)
                  .join(', ')}${found.matched > 5 ? ', ...' : ''}`,
              ),
            );
          }
        } catch (err) {
          const refused = asAppError(err, ERROR_CODES.MKT_SUBSCRIPTION_STATE);
          if (!refused) throw err;
          notes.push(`comp: skipped, ${refused.message}`);
        }
      }

      // --- 3. approve the version and publish ------------------------------------------------------------------------------------------
      if (detail.status === 'published') {
        notes.push('publish: the listing is already published; nothing to do');
      } else if (detail.status === 'draft' || detail.status === 'in_review') {
        const latest =
          detail.versions.find((v) => v.version === config.version) ?? detail.versions[0];
        if (!latest) throw new Error(`The ${config.slug} listing has no version to publish.`);
        if (!priceNowSet && !dry)
          throw new Error('The price is not set, so the listing cannot be published.');
        if (!dry) {
          if (latest.status === 'rejected') await catalogue.submit(APP_SLUG, latest.id);
          if (
            latest.status === 'draft' ||
            latest.status === 'in_review' ||
            latest.status === 'rejected'
          )
            await catalogue.approve(APP_SLUG, latest.id, {}, operatorId);
          await catalogue.publish(APP_SLUG, { versionId: latest.id }, operatorId);
        }
        actions.push(
          would(
            `${latest.status === 'approved' ? '' : `approve version ${latest.version} and `}publish the listing (${detail.status} -> published)`,
          ),
        );
      } else if (detail.status === 'hidden' && opts.force) {
        if (!dry) await catalogue.unhide(APP_SLUG);
        actions.push(would('show the hidden listing again (--force)'));
      } else {
        notes.push(
          `publish: the listing is ${detail.status}, which an operator chose; left alone${detail.status === 'hidden' ? ' (--force shows it again)' : ''}`,
        );
      }

      // --- 4. plan visibility (only where the table exists) ----------------------------------------------------------------------------
      await planVisibility();

      // --- 5. install in the comped workspaces ------------------------------------------------------------------------------------------
      await installComped();

      const afterDetail = dry ? detail : await load();
      return {
        actions,
        notes,
        before,
        after: dry ? before : await snapshot(store, afterDetail, APP_SLUG),
        operator,
      };

      // ---------------------------------------------------------------------------------------------------------------------------------

      async function compWorkspaces(slugs: string[]): Promise<void> {
        let comped = 0;
        let already = 0;
        const compedNames: string[] = [];
        for (const slug of slugs) {
          const org = await store.tx(async (tx) => {
            const res = await tx.execute(
              sql`SELECT id, uuid, name FROM organizations WHERE slug = ${slug}`,
            );
            const r = res.rows[0] as Raw | undefined;
            if (!r) return null;
            const sub = await tx.execute(sql`
              SELECT s.status FROM marketplace_subscriptions s JOIN marketplace_apps a ON a.id = s.app_id
              WHERE s.org_id = ${Number(r.id)} AND a.slug = ${APP_SLUG}`);
            return {
              uuid: String(r.uuid),
              name: String(r.name),
              subscription: (sub.rows[0] as Raw | undefined)?.status as string | undefined,
            };
          });
          if (!org) throw new Error(`There is no workspace with the slug "${slug}".`);
          if (org.subscription === 'active') {
            already += 1;
            if (slugs.length === 1)
              notes.push(
                `comp: workspace "${slug}" already has a subscription to the app; nothing to do`,
              );
            continue;
          }
          if (!priceNowSet) {
            actions.push(`would then comp workspace "${slug}" (${org.name}) once the price is set`);
            continue;
          }
          if (!dry)
            await pricing.comp(
              APP_SLUG,
              { workspaceId: org.uuid, months: null, note: compNote },
              operatorId,
            );
          comped += 1;
          compedNames.push(`"${slug}" (${org.name})`);
        }
        if (comped > 0)
          actions.push(
            would(
              slugs.length === 1
                ? `comp workspace ${compedNames[0]} with no end date`
                : `comp ${comped} workspace(s) with no end date: ${compedNames.join(', ')}`,
            ),
          );
        if (slugs.length > 1 && already > 0)
          notes.push(
            `comp: ${already} workspace(s) already have a subscription to the app; left as is`,
          );
      }

      async function installComped(): Promise<void> {
        const waiting = await store.tx(async (tx) => {
          const res = await tx.execute(sql`
            SELECT s.org_id FROM marketplace_subscriptions s JOIN marketplace_apps a ON a.id = s.app_id
            WHERE a.slug = ${APP_SLUG} AND s.status = 'active' AND s.source = 'comp' AND NOT s.cancel_at_period_end
              AND NOT EXISTS (SELECT 1 FROM workspace_app_installations i WHERE i.org_id = s.org_id AND i.app_id = s.app_id)`);
          return (res.rows as Raw[]).map((r) => Number(r.org_id));
        });
        if (waiting.length === 0) {
          notes.push(
            'install: every comped workspace already has the app installed; nothing to do',
          );
          return;
        }
        if (!dry) {
          await store.tx(async (tx) => {
            await tx.execute(sql`SELECT set_config('app.privileged', 'on', true)`);
            await tx.execute(sql`
              WITH v AS (
                SELECT a.id AS app_id, ver.id AS version_id, ver.scopes
                FROM marketplace_apps a JOIN marketplace_app_versions ver ON ver.app_id = a.id
                WHERE a.slug = ${APP_SLUG}
                ORDER BY (ver.status = 'published') DESC, ver.id DESC LIMIT 1),
              made AS (
                INSERT INTO workspace_app_installations (org_id, app_id, installed_version_id, status, granted_scopes)
                SELECT o, v.app_id, v.version_id, 'active', v.scopes
                FROM unnest(${`{${waiting.join(',')}}`}::bigint[]) AS o, v
                ON CONFLICT (org_id, app_id) DO NOTHING
                RETURNING org_id, id, app_id, installed_version_id, granted_scopes)
              INSERT INTO marketplace_consents (org_id, installation_id, app_id, version_id, action, scopes, previous_scopes)
              SELECT org_id, id, app_id, installed_version_id, 'install', granted_scopes, '{}'::text[] FROM made`);
          });
        }
        actions.push(would(`install the app in ${waiting.length} comped workspace(s)`));
      }

      async function planVisibility(): Promise<void> {
        const exists = await store.tx(async (tx) => {
          const res = await tx.execute(
            sql`SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'plan_visible_addons'`,
          );
          return res.rows.length > 0;
        });
        if (!exists) {
          notes.push(
            'plan visibility: this database has no plan_visible_addons table (an older schema); skipped',
          );
          return;
        }
        if (!priceNowSet) {
          actions.push('would then enable the add-on on every active plan (once the price is set)');
          return;
        }
        const state = await store.tx(async (tx) => {
          const res = await tx.execute(sql`
            SELECT ap.id AS pack_id,
                   (SELECT count(*) FROM plan_visible_addons v WHERE v.addon_plan_id = ap.id)::int AS enabled,
                   (SELECT count(*) FROM plans p WHERE p.kind = 'plan' AND p.is_active
                       AND NOT EXISTS (SELECT 1 FROM plan_visible_addons v WHERE v.plan_id = p.id AND v.addon_plan_id = ap.id))::int AS missing
            FROM plans ap JOIN marketplace_apps a ON a.id = ap.marketplace_app_id
            WHERE a.slug = ${APP_SLUG} AND ap.kind = 'addon'`);
          return res.rows[0] as Raw | undefined;
        });
        if (!state) {
          notes.push('plan visibility: the add-on does not exist yet; skipped');
          return;
        }
        const enabled = Number(state.enabled);
        const missing = Number(state.missing);
        if (missing === 0) {
          notes.push(
            'plan visibility: the add-on is already enabled on every active plan; nothing to do',
          );
          return;
        }
        if (enabled > 0 && !opts.force) {
          notes.push(
            `plan visibility: an operator already enabled it on ${enabled} plan(s) and left ${missing} out; kept (--force enables it on every active plan)`,
          );
          return;
        }
        if (!dry) {
          await store.tx(async (tx) => {
            await tx.execute(sql`
              INSERT INTO plan_visible_addons (plan_id, addon_plan_id)
              SELECT p.id, ${Number(state.pack_id)} FROM plans p WHERE p.kind = 'plan' AND p.is_active
              ON CONFLICT DO NOTHING`);
            await audit.record(tx, {
              event: 'platform.plan.visible_addons_seeded',
              status: 'success',
              payload: {
                app: APP_SLUG,
                plans: missing,
                operator: operatorId,
                source: config.command,
              },
            });
          });
        }
        actions.push(would(`enable the add-on on ${missing} active plan(s)`));
      }
    },
  );
}

/** The state a developer cares about, one line each, read straight from the database. */
export async function snapshot(
  store: OperatorCatalogueStore,
  detail: MarketOperatorAppDetail,
  slug: string,
): Promise<Snapshot> {
  const extra = await store.tx(async (tx) => {
    const subs = await tx.execute(sql`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE s.source = 'comp')::int AS comped
      FROM marketplace_subscriptions s JOIN marketplace_apps a ON a.id = s.app_id WHERE a.slug = ${slug}`);
    const has = await tx.execute(
      sql`SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'plan_visible_addons'`,
    );
    let visibility = 'n/a (no plan_visible_addons table)';
    if (has.rows.length > 0) {
      const v = await tx.execute(sql`
        SELECT (SELECT count(*) FROM plan_visible_addons pv JOIN plans ap ON ap.id = pv.addon_plan_id
                  JOIN marketplace_apps a ON a.id = ap.marketplace_app_id WHERE a.slug = ${slug})::int AS enabled,
               (SELECT count(*) FROM plans WHERE kind = 'plan' AND is_active)::int AS active`);
      const r = v.rows[0] as Raw;
      visibility = `enabled on ${Number(r.enabled)} of ${Number(r.active)} active plans`;
    }
    const r = subs.rows[0] as Raw;
    return {
      subscriptions: `${Number(r.total)} (${Number(r.comped)} comped)`,
      visibility,
    };
  });
  const latest = detail.versions[0];
  return {
    status: detail.status,
    price:
      detail.pricing.model !== 'paid_monthly'
        ? 'free'
        : detail.pricing.amount === null
          ? 'not set'
          : `${priceLabel(detail.pricing)} per month`,
    pack: detail.pricing.packSlug ?? 'none',
    version: latest ? `${latest.version} (${latest.status})` : 'none',
    subscriptions: extra.subscriptions,
    visibility: extra.visibility,
  };
}
