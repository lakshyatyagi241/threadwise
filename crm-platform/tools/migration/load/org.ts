import { sql, withPrivileged, type Database } from './db';
import { digest, orgTables, type Baseline } from './baseline';
import { writeIdMap, type IdMap } from './engine';
import { uuidv5 } from '../util';

/**
 * The organization is NOT derived from Waboo's `project`: the team gives its name, slug and plan. Optionally an owner user is created
 * the way the app does it (TenantDirectory.provisionOrganization makes the first user the Owner with the admin preset role).
 */
export interface OrgInputs {
  name: string;
  slug: string;
  plan: string | null;
  ownerEmail: string | null;
  ownerName: string | null;
  /** Length of the trial, honoured only when the plan is free (the app's trialFor rule). Default: no trial. */
  trialDays?: number | null;
  /** Mark the owner's email as verified (the app's orgsForVerifiedEmail only lists verified owners). Default: not verified. */
  ownerVerified?: boolean;
}

/** The login schema is 2..40 characters of [A-Za-z0-9_-] starting alphanumeric. */
export const SLUG_MAX = 40;

export function normalizeSlug(input: string): string {
  const s = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
  if (s.length < 2)
    throw new Error(
      `org slug "${input}" has no usable characters (need 2..${SLUG_MAX} of a-z, 0-9, -)`,
    );
  return s;
}

/** `base` plus a suffix, truncated so the WHOLE slug stays within the limit. */
export function slugWithSuffix(base: string, suffix: string): string {
  return `${base.slice(0, SLUG_MAX - suffix.length - 1).replace(/-+$/g, '')}-${suffix}`;
}

export interface OrgEnv {
  client: string;
  db: Database;
  ownerDb: Database;
  idmap: IdMap;
  org: OrgInputs;
  dryRun: boolean;
  log: (line: string) => void;
}

export const ORG_COLLECTION = '_org';

/**
 * Mirrors provisionOrganization: organizations row, org_plan_state, `provision_workspace_presets()` (the five preset roles), then the
 * owner. The organizations insert trigger seeds the sales pipeline. Idempotent: the organization has a deterministic uuid, so even a
 * lost id_map finds it again. Creation is serialised by an advisory lock so two runs picking the same slug cannot collide.
 */
export async function ensureOrg(env: OrgEnv): Promise<{ orgId: number; warnings: string[] }> {
  const o = env.org;
  const slugWanted = normalizeSlug(o.slug);
  const orgUuid = uuidv5(`${env.client}|${ORG_COLLECTION}`);
  const warnings: string[] = [];

  const orgId = await withPrivileged(env.ownerDb, async (tx) => {
    // a dry run lives inside one long outer transaction: it must not hold the global lock that real runs queue on
    if (!env.dryRun)
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('migration:org-create'))`);
    const found = await tx.execute(
      sql`SELECT id, slug FROM organizations WHERE uuid = ${orgUuid}::uuid`,
    );
    let id: number;
    let slugUsed = slugWanted;
    let planSlug: string | null = null;
    let billingCycle: string | null = null;
    let ownerMade = false;
    if (found.rows[0]) {
      id = Number((found.rows[0] as { id: number | string }).id);
      slugUsed = String((found.rows[0] as { slug: string }).slug);
    } else {
      let n = 0;
      for (;;) {
        const taken = await tx.execute(
          sql`SELECT 1 FROM organizations WHERE lower(slug) = lower(${slugUsed}) LIMIT 1`,
        );
        if (taken.rows.length === 0) break;
        n++;
        slugUsed = slugWithSuffix(slugWanted, `${orgUuid.slice(0, 6)}${n > 1 ? n : ''}`);
        env.log(`  org                slug "${slugWanted}" is taken, using "${slugUsed}"`);
      }
      const settings = { legacy: { waboo: { client: env.client } } };
      // the app's 4-step default (pickDefaultPlan): the requested plan, else the first active plan flagged default, else the first
      // active free plan, else the literal 'starter'. A trial only starts on a free plan with --trial-days > 0 (trialFor).
      const plans = (
        await tx.execute(
          sql`SELECT slug, is_default, is_free FROM plans WHERE kind = 'plan' AND is_active ORDER BY sort_order, amount, slug`,
        )
      ).rows as Array<{ slug: string; is_default: boolean; is_free: boolean }>;
      const wanted = o.plan?.trim().toLowerCase();
      const picked =
        plans.find((p) => wanted && p.slug === wanted) ??
        plans.find((p) => p.is_default) ??
        plans.find((p) => p.is_free) ??
        null;
      planSlug = wanted && !picked ? wanted : (picked?.slug ?? 'starter');
      const trialDays = o.trialDays && o.trialDays > 0 && picked?.is_free ? o.trialDays : 0;
      billingCycle = trialDays > 0 ? 'trial' : 'monthly';
      const ins = await tx.execute(sql`
        INSERT INTO organizations (uuid, slug, name, plan, settings)
        VALUES (${orgUuid}::uuid, ${slugUsed}, ${o.name}, ${planSlug}, ${JSON.stringify(settings)}::jsonb)
        RETURNING id`);
      id = Number((ins.rows[0] as { id: number | string }).id);
      await tx.execute(sql`
        INSERT INTO org_plan_state (org_id, trial_ends_at, billing_cycle)
        VALUES (${id}, ${trialDays > 0 ? sql`now() + (${trialDays} * interval '1 day')` : sql`NULL`}, ${billingCycle})
        ON CONFLICT (org_id) DO NOTHING`);
      await tx.execute(sql`SELECT provision_workspace_presets(${id})`);
      await tx.execute(
        sql`INSERT INTO workspace_settings (org_id) VALUES (${id}) ON CONFLICT DO NOTHING`,
      );
      env.log(`  org                created organization ${id} (${slugUsed})`);
    }

    if (o.ownerEmail) {
      const email = o.ownerEmail.trim().toLowerCase();
      const have = await tx.execute(
        sql`SELECT id, uuid::text AS uuid FROM users WHERE org_id = ${id} AND email = ${email}`,
      );
      if (!have.rows[0]) {
        // the preset role provision_workspace_presets() returns is the Owner (locked top preset), as in provisionOrganization
        const role = await tx.execute(
          sql`SELECT id FROM roles WHERE org_id = ${id} AND name = 'Owner' ORDER BY id LIMIT 1`,
        );
        const roleId = Number((role.rows[0] as { id: number | string } | undefined)?.id);
        if (!Number.isInteger(roleId))
          throw new Error('the Owner preset role does not exist; cannot create the owner user');
        // an invited, not-yet-joined user: no password (NULL; the app uses an unusable random hash), no email sent, no token issued.
        // auth_subject stays NULL: the app links the account to its Clerk id on the owner's first sign-in with this email
        // (auth.service.ts). TODO(owner): if sign-in is not by Clerk, issue an invite/reset token through the app.
        const u = await tx.execute(sql`
          INSERT INTO users (org_id, email, full_name, password_hash, status, invited_at, joined_at)
          VALUES (${id}, ${email}, ${o.ownerName?.trim() || email}, NULL, 'active', now(), NULL)
          RETURNING id, uuid::text AS uuid`);
        const user = u.rows[0] as { id: number | string; uuid: string };
        await tx.execute(
          sql`INSERT INTO user_roles (org_id, user_id, role_id) VALUES (${id}, ${Number(user.id)}, ${roleId})`,
        );
        await tx.execute(sql`
          INSERT INTO user_security (org_id, user_id, email_verified_at)
          VALUES (${id}, ${Number(user.id)}, ${o.ownerVerified ? sql`now()` : sql`NULL`})
          ON CONFLICT (org_id, user_id) DO NOTHING`);
        await tx.execute(
          sql`INSERT INTO user_profiles (org_id, user_id) VALUES (${id}, ${Number(user.id)}) ON CONFLICT DO NOTHING`,
        );
        await tx.execute(sql`
          UPDATE organizations SET settings = settings || ${JSON.stringify({ ownerUserId: user.uuid })}::jsonb WHERE id = ${id}`);
        ownerMade = true;
        env.log(
          `  org                created owner user for the organization (invited, no password, no email sent)`,
        );
      }
    } else {
      const owners = await tx.execute(
        sql`SELECT 1 FROM user_roles ur JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id WHERE ur.org_id = ${id} AND r.name = 'Owner' LIMIT 1`,
      );
      if (owners.rows.length === 0) {
        warnings.push(
          'THE ORGANIZATION HAS NO OWNER. Nobody can sign in to it until a user with the Owner role exists (re-run with --owner-email / --owner-name).',
        );
      }
    }

    // what reconcile will hold the organization to
    const prior = await tx.execute(
      sql`SELECT counts FROM migration.run_log WHERE source_client = ${env.client} AND collection = ${ORG_COLLECTION} AND step = 'org'`,
    );
    const was = ((prior.rows[0] as { counts?: Record<string, unknown> } | undefined)?.counts ??
      {}) as Record<string, unknown>;
    const state = (
      await tx.execute(
        sql`SELECT billing_cycle, trial_ends_at IS NOT NULL AS has_trial FROM org_plan_state WHERE org_id = ${id}`,
      )
    ).rows[0] as { billing_cycle: string; has_trial: boolean } | undefined;
    const planNow = String(
      (
        (await tx.execute(sql`SELECT plan FROM organizations WHERE id = ${id}`)).rows[0] as {
          plan: string;
        }
      ).plan,
    );
    const expected = {
      ...was,
      slug: slugUsed,
      name: String(was.name ?? o.name),
      plan: String(was.plan ?? planSlug ?? planNow),
      status: 'active',
      billingCycle: String(was.billingCycle ?? billingCycle ?? state?.billing_cycle ?? 'monthly'),
      trial: Boolean(was.trial ?? state?.has_trial ?? false),
      ownerEmail: o.ownerEmail ? o.ownerEmail.trim().toLowerCase() : (was.ownerEmail ?? null),
      ownerVerified: ownerMade
        ? Boolean(o.ownerVerified)
        : Boolean(was.ownerVerified ?? o.ownerVerified ?? false),
    };
    // the digest of everything provisioning (and the owner) left behind; a later owner only refreshes the tables it touches
    const old = await tx.execute(
      sql`SELECT counts FROM migration.run_log WHERE source_client = ${env.client} AND collection = ${ORG_COLLECTION} AND step = 'baseline'`,
    );
    const had = ((old.rows[0] as { counts?: Baseline } | undefined)?.counts ??
      null) as Baseline | null;
    if (!had || ownerMade) {
      const touched = ['users', 'user_roles', 'user_security', 'user_profiles'];
      const names = had ? touched : await orgTables(tx);
      const fresh = await digest(tx, id, names);
      const baseline: Baseline = had ? { ...had, ...fresh } : fresh;
      if (had) for (const t of names) if (!(t in fresh)) delete baseline[t];
      // the organizations row (it carries ownerUserId after an owner was made)
      baseline.organizations = (await digest(tx, id, [])).organizations!;
      await tx.execute(sql`
        INSERT INTO migration.run_log (source_client, collection, step, run_id, last_key, state, counts)
        VALUES (${env.client}, ${ORG_COLLECTION}, 'baseline', 'org', 0, 'done', ${JSON.stringify(baseline)}::jsonb)
        ON CONFLICT (source_client, collection, step) DO UPDATE SET counts = EXCLUDED.counts, updated_at = now()`);
    }
    await tx.execute(sql`
      INSERT INTO migration.run_log (source_client, collection, step, run_id, last_key, state, counts)
      VALUES (${env.client}, ${ORG_COLLECTION}, 'org', 'org', 0, 'done', ${JSON.stringify(expected)}::jsonb)
      ON CONFLICT (source_client, collection, step) DO UPDATE SET counts = EXCLUDED.counts, updated_at = now()`);
    await writeIdMap(tx, env.client, id, [
      {
        collection: ORG_COLLECTION,
        key: env.client,
        kind: 'string_id',
        table: 'organizations',
        id,
        uuid: orgUuid,
      },
    ]);
    return id;
  });
  // inside a dry run's outer transaction the privileged flag would outlive the savepoint: put RLS back
  if (env.dryRun) await env.db.execute(sql`SELECT set_config('app.privileged', '', true)`);
  await env.idmap.load(env.db, env.client);
  return { orgId, warnings };
}
