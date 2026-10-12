import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlanEntitlementService } from '../../../src/modules/plans-subscriptions-trials';
import { runSeedForms } from '../../../src/modules/marketplace/cli/seed-forms.runner';
import { parseArgs } from '../../../src/modules/marketplace/cli/seed-forms.args';
import { Api, startHarness, type Harness, type Tenant } from './support';

/**
 * Owner decision 2026-10-08: a Marketplace app's plan features (Forms: `form_builder`) are on only while the workspace is subscribed AND
 * has the app installed and running. Real Postgres, real AppModule, row-level security forced.
 */
let h: Harness;
let api: Api;
let A: Tenant; // subscribed (comped) by the seed
let B: Tenant; // never subscribed: its plan carries the feature itself in one test
let C: Tenant; // bystander

const one = async <T = Record<string, unknown>>(query: string, params: unknown[] = []) =>
  (await h.owner.query(query, params)).rows[0] as T;
const on = (t: Tenant) => h.app.get(PlanEntitlementService).featureEnabled(t.orgId, 'form_builder');
const roles = async (t: Tenant) => {
  const res = await api.as(t.admin).get('/v2/permissions?includeLocked=1');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.data as Array<{ key: string; lock?: { kind: string; slug?: string } }>).find(
    (p) => p.key === 'record.forms.read',
  )!;
};
const formsRoute = (t: Tenant) => api.as(t.admin).get('/v2/forms');
const setInstall = async (t: Tenant, status: 'active' | 'disabled' | 'killed' | null) => {
  await h.owner.query(`DELETE FROM workspace_app_installations WHERE org_id = $1`, [t.orgId]);
  if (status === null) return;
  await h.owner.query(
    `INSERT INTO workspace_app_installations (org_id, app_id, installed_version_id, status)
     SELECT $1, a.id, v.id, $2 FROM marketplace_apps a JOIN marketplace_app_versions v ON v.app_id = a.id WHERE a.slug = 'forms' LIMIT 1`,
    [t.orgId, status],
  );
};

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  await h.owner.query(
    `INSERT INTO plans (slug, kind, name, amount, currency, sort_order, is_free) VALUES ('freebie', 'plan', 'Freebie', 0, 'USD', 1, true)`,
  );
  A = await api.signup('instA');
  B = await api.signup('instB');
  C = await api.signup('instC');
  await h.owner.query(`UPDATE organizations SET plan = 'freebie' WHERE id = ANY($1::bigint[])`, [
    [A.orgId, B.orgId, C.orgId],
  ]);
  const parsed = parseArgs(['--workspace', A.slug]);
  if (parsed.kind !== 'options') throw new Error(JSON.stringify(parsed));
  await runSeedForms(h.app, parsed.options);
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('app access requires the app to be installed', () => {
  it('the seed comps A and installs the app, so the demo works', async () => {
    expect(await on(A)).toBe(true);
    expect((await formsRoute(A)).status).toBe(200);
    expect((await roles(A)).lock).toBeUndefined();
  });

  it('subscribed but not installed: off everywhere, locked with the app badge', async () => {
    await setInstall(A, null);
    expect(
      Number(
        (
          await one<{ n: string }>(
            `SELECT count(*) n FROM marketplace_subscriptions WHERE org_id = $1`,
            [A.orgId],
          )
        ).n,
      ),
    ).toBe(1);
    expect(await on(A)).toBe(false);
    const res = await formsRoute(A);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PLAN_FEATURE_LOCKED');
    expect(JSON.stringify(res.body)).toContain('app_not_installed');
    expect((await roles(A)).lock).toEqual({ kind: 'app', slug: 'forms' });
    const ent = await api.as(A.admin).get('/v2/billing/entitlements');
    expect(ent.body.features).not.toContain('form_builder');
  });

  it('installed and active: on', async () => {
    await setInstall(A, 'active');
    expect(await on(A)).toBe(true);
    expect((await formsRoute(A)).status).toBe(200);
    expect((await roles(A)).lock).toBeUndefined();
    expect((await api.as(A.admin).get('/v2/billing/entitlements')).body.features).toContain(
      'form_builder',
    );
  });

  it.each(['disabled', 'killed'] as const)(
    '%s: runtime refused, the Roles editor still lets the admin manage it',
    async (status) => {
      await setInstall(A, status);
      expect(await on(A)).toBe(false);
      const res = await formsRoute(A);
      expect(res.status).toBe(422);
      expect(JSON.stringify(res.body)).toContain('app_paused');
      expect((await roles(A)).lock).toBeUndefined();
    },
  );

  it('uninstalled again: off', async () => {
    await setInstall(A, null);
    expect(await on(A)).toBe(false);
  });

  it('a feature the PLAN carries stays on without any installation', async () => {
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"form_builder":true}}'::jsonb WHERE org_id = $1`,
      [B.orgId],
    );
    expect(await on(B)).toBe(true);
    expect((await roles(B)).lock).toBeUndefined();
    expect((await formsRoute(B)).status).toBe(200);
  });

  it('another workspace is unaffected by A, and without a subscription is plainly plan-locked', async () => {
    await setInstall(A, 'active');
    expect(await on(C)).toBe(false);
    expect((await roles(C)).lock).toEqual({ kind: 'plan_feature', key: 'form_builder' });
    expect(JSON.stringify((await formsRoute(C)).body)).toContain('feature_disabled');
  });

  it('the migration backfill installs a subscribed workspace that already has forms, and nobody else', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const migration = readFileSync(
      resolve(
        __dirname,
        '../../../../../packages/db/migrations/20261113090000_mkt_app_access_requires_install.sql',
      ),
      'utf8',
    );
    const installs = async (t: Tenant) =>
      Number(
        (
          await one<{ n: string }>(
            `SELECT count(*) n FROM workspace_app_installations WHERE org_id = $1`,
            [t.orgId],
          )
        ).n,
      );
    await setInstall(A, null);
    // subscribed, no data: left alone
    await h.owner.query(migration);
    expect(await installs(A)).toBe(0);
    // subscribed with a form: installed once, with a consent row; a second run adds nothing
    await h.owner.query(
      `INSERT INTO web_forms (org_id, name, public_key, draft_definition) VALUES ($1, 'Existing', 'abcdefghijklmnopqrstuv', '{}'::jsonb)`,
      [A.orgId],
    );
    const consents = async () =>
      Number(
        (
          await one<{ n: string }>(
            `SELECT count(*) n FROM marketplace_consents WHERE org_id = $1 AND action = 'install'`,
            [A.orgId],
          )
        ).n,
      );
    const consentsBefore = await consents();
    await h.owner.query(migration);
    await h.owner.query(migration);
    expect(await installs(A)).toBe(1);
    expect((await consents()) - consentsBefore).toBe(1);
    expect(await on(A)).toBe(true);
    // not subscribed (C), even with a form: nothing
    await h.owner.query(
      `INSERT INTO web_forms (org_id, name, public_key, draft_definition) VALUES ($1, 'Other', 'abcdefghijklmnopqrstuw', '{}'::jsonb)`,
      [C.orgId],
    );
    await h.owner.query(migration);
    expect(await installs(C)).toBe(0);
  });
});
