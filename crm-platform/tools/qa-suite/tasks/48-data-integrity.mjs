// #48 Data integrity testing: schema-level guarantees (static) and the state of a real database (live): unvalidated constraints, tenant isolation fails closed, partition leaks, sequences, unique public ids.
import {
  expectNone,
  fail,
  migrations,
  pass,
  pgClient,
  read,
  sh,
  skip,
  unreviewed,
  warn,
} from '../lib/core.mjs';
import { neverValidated } from '../lib/not-valid.mjs';
import { buildSchema, isTenant } from '../lib/schema.mjs';

export default {
  id: 48,
  priority: 'P0',
  name: 'Data integrity testing',
  owner: 'Punya',
  target: '100% critical data paths reviewed; measurable before/after evidence',
  async run() {
    const checks = [];
    const tables = [...buildSchema().values()].filter(
      (t) => t.columns.size > 1 && t.name.length > 2,
    );
    const uuidTables = tables.filter(
      (t) =>
        isTenant(t) &&
        t.columns.has('uuid') &&
        ![...t.uniques, ...t.indexes.filter((i) => i.unique).map((i) => i.cols)].some((c) =>
          c.includes('uuid'),
        ),
    );
    // A partitioned table cannot enforce uniqueness without its partition key, so a random uuid there is unique by probability only:
    // reported as a review item, not a failure.
    const isPartitioned = (t) => t.partitioned || /_(log|logs|events|ledger)$/.test(t.name);
    const noUuidUnique = uuidTables
      .filter((t) => !isPartitioned(t))
      .map(
        (t) =>
          `${t.name}: has a uuid column but no unique constraint on it (two rows could share a public id)`,
      );
    const partUuid = uuidTables
      .filter(isPartitioned)
      .map(
        (t) =>
          `${t.name}: uuid is not unique-constrained (partitioned/stream table); confirm lookups always include org_id and the time range`,
      );
    checks.push(
      expectNone('int-uuid-unique', 'Public uuid columns are unique', noUuidUnique, {
        severity: 'high',
      }),
    );
    checks.push(
      expectNone(
        'int-uuid-partitioned',
        'Partitioned/stream tables whose uuid cannot be unique-constrained',
        unreviewed(48, partUuid),
        { level: 'warn' },
      ),
    );
    const notValid = neverValidated(migrations().map((f) => ({ file: f, sql: read(f) }))).map(
      (x) =>
        `${x.file.split('/').pop()}: ${x.name} is NOT VALID and no later migration validates it`,
    );
    checks.push(
      expectNone(
        'int-notvalid',
        'Constraints added NOT VALID are later validated',
        unreviewed(48, notValid),
        {
          level: 'warn',
        },
      ),
    );

    const { client, error } = await pgClient();
    if (!client) {
      for (const [id, t] of [
        ['int-validated', 'All constraints are validated'],
        [
          'int-failclosed',
          'Tenant tables return no rows without a tenant context (RLS fails closed)',
        ],
        ['int-default-part', 'No rows leaked into DEFAULT partitions'],
        ['int-sequences', 'No sequence is close to exhausting'],
        ['int-verify-schema', 'pnpm db:verify-schema passes'],
        ['int-roles', 'Runtime roles cannot bypass RLS'],
      ])
        checks.push(skip(id, t, error));
    } else {
      const nv = (
        await client.query(
          `SELECT conrelid::regclass::text t, conname FROM pg_constraint WHERE NOT convalidated`,
        )
      ).rows.map((r) => `${r.t}.${r.conname}`);
      checks.push(
        expectNone('int-validated', 'All constraints are validated (no NOT VALID leftovers)', nv, {
          severity: 'high',
        }),
      );
      const roles = (
        await client.query(
          `SELECT rolname FROM pg_roles WHERE rolname IN ('crm_app','crm_worker') AND (rolsuper OR rolbypassrls)`,
        )
      ).rows.map((r) => r.rolname);
      checks.push(
        expectNone(
          'int-roles',
          'Runtime roles crm_app / crm_worker are neither superuser nor BYPASSRLS',
          roles,
          { severity: 'critical' },
        ),
      );
      const notForced = (
        await client.query(
          `SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND relkind IN ('r','p') AND relispartition=false AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='org_id' AND NOT a.attisdropped) AND NOT (relrowsecurity AND relforcerowsecurity)`,
        )
      ).rows.map((r) => r.relname);
      checks.push(
        expectNone(
          'int-rls-live',
          'Every table with org_id has RLS enabled and forced in the live database',
          notForced,
          { severity: 'critical' },
        ),
      );
      // fail-closed: as crm_app with no tenant set, every tenant table must show zero rows
      const leaks = [];
      try {
        const names = (
          await client.query(
            `SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND relkind IN ('r','p') AND relispartition=false AND relrowsecurity ORDER BY 1 LIMIT 400`,
          )
        ).rows.map((r) => r.relname);
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE crm_app');
        for (const n of names) {
          try {
            await client.query('SAVEPOINT s');
            const c = (
              await client.query(`SELECT count(*)::int c FROM "${n}" WHERE org_id IS NOT NULL`)
            ).rows[0].c;
            if (c > 0) leaks.push(`${n}: ${c} tenant rows visible with no tenant set`);
            await client.query('RELEASE s');
          } catch {
            await client.query('ROLLBACK TO s');
          }
        }
        await client.query('ROLLBACK');
        checks.push(
          expectNone(
            'int-failclosed',
            `With no tenant context, ${names.length} RLS tables return zero rows to crm_app`,
            leaks,
            { severity: 'critical' },
          ),
        );
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        checks.push(
          skip(
            'int-failclosed',
            'RLS fails closed for crm_app',
            `could not SET ROLE crm_app: ${e.message}`,
          ),
        );
      }
      const defaults = [];
      for (const r of (
        await client.query(
          `SELECT c.relname FROM pg_class c JOIN pg_inherits i ON i.inhrelid=c.oid WHERE c.relname LIKE '%\\_default'`,
        )
      ).rows) {
        const n = (await client.query(`SELECT count(*)::int c FROM "${r.relname}"`)).rows[0].c;
        if (n) defaults.push(`${r.relname}: ${n} rows (a month partition is missing)`);
      }
      checks.push(
        expectNone('int-default-part', 'No rows have leaked into DEFAULT partitions', defaults, {
          level: 'warn',
        }),
      );
      const seqs = (
        await client.query(
          `SELECT sequencename s, round(100.0*coalesce(last_value,0)/max_value,2)::float pct FROM pg_sequences WHERE coalesce(last_value,0)::float/max_value > 0.5`,
        )
      ).rows.map((r) => `${r.s}: ${r.pct}% used`);
      checks.push(
        expectNone('int-sequences', 'No sequence is more than 50% exhausted', seqs, {
          severity: 'high',
        }),
      );
      await client.end();
      const v = sh('pnpm', ['--filter', '@crm/db', 'verify-schema'], {
        // verify-schema reads MIGRATION_DATABASE_URL (the repo's .env points it at the dev cluster): check the database under test
        env: { ...process.env, MIGRATION_DATABASE_URL: process.env.DATABASE_URL },
        timeout: 300000,
      });
      checks.push(
        v.status === 0
          ? pass('int-verify-schema', 'pnpm db:verify-schema passes')
          : fail(
              'int-verify-schema',
              'pnpm db:verify-schema passes',
              (v.stdout + v.stderr).slice(-400),
            ),
      );
    }
    return {
      checks,
      metrics: { tables: tables.length, 'tenant tables': tables.filter(isTenant).length },
      target: {
        met: checks.some((c) => c.status === 'fail')
          ? false
          : checks.some((c) => c.status === 'skip')
            ? null
            : true,
        text: 'P0. Static guarantees are checked here; row-level behaviour is proven by the Docker integration suites (docs/quality/integration-testing.md).',
      },
    };
  },
};
