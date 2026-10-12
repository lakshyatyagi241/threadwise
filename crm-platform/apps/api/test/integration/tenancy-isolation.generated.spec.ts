import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';
// @ts-expect-error plain ESM tool, no types; shared with `pnpm audit:tenancy`
import { runDbProbe } from '../../../../tools/tenancy-audit/lib/db-probe.mjs';

interface ProbeResult {
  table: string;
  scenario: string;
  control: string;
  status: 'PASSED' | 'FAILED' | 'BLOCKED' | 'NOT_APPLICABLE';
  detail: string;
}

/**
 * Cross-tenant isolation for EVERY table with an org_id column, generated from the live catalog (MT-011..015, MT-005).
 *
 * rls.spec.ts proves the mechanism on a few tables; this proves it on all of them, so a new tenant table that forgets
 * RLS, FORCE, or a WITH CHECK fails here the day it is added. Per table: own rows visible (positive control), foreign rows
 * invisible, no context sees nothing, cross-tenant UPDATE/DELETE touch nothing, cross-tenant INSERT hits WITH CHECK.
 * A denial is verified against the owner's view of the data, not against the response.
 *
 * BLOCKED (a table the generic seed could not fill) fails the suite too: an unproven table is not a passing table.
 * Fix by teaching tools/tenancy-audit/lib/db-probe.mjs how to seed it, never by skipping it.
 */
describe('generated cross-tenant isolation (all tenant tables)', () => {
  let container: StartedPostgreSqlContainer;
  let results: ProbeResult[] = [];

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    const owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await owner.query(
      `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    await owner.end();
    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../packages/db/migrations'),
      log: () => undefined,
    });
    const appUrl = new URL(container.getConnectionUri());
    appUrl.username = 'crm_app_user';
    appUrl.password = 'test';
    results = await runDbProbe({
      ownerUrl: container.getConnectionUri(),
      appUrl: appUrl.toString(),
    });
  }, 600_000);

  afterAll(async () => {
    await container?.stop();
  });

  it('connects as a role that cannot bypass RLS (otherwise nothing below means anything)', () => {
    const r = results.find((x) => x.scenario === 'app-role-restricted');
    expect(r?.status, r?.detail).toBe('PASSED');
  });

  it('probes every tenant table', () => {
    const tables = new Set(results.filter((r) => r.table !== '*').map((r) => r.table));
    expect(tables.size).toBeGreaterThan(250);
  });

  it('has no failed scenario', () => {
    const failed = results.filter((r) => r.status === 'FAILED');
    expect(failed.map((r) => `${r.table}:${r.scenario} ${r.detail}`)).toEqual([]);
  });

  it('has no unproven (blocked) table', () => {
    const blocked = results.filter((r) => r.status === 'BLOCKED');
    expect(blocked.map((r) => `${r.table}:${r.scenario} ${r.detail}`)).toEqual([]);
  });
});
