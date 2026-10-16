// Generated cross-tenant probe: one scenario family per tenant table, derived from the live catalog.
// Needs a migrated Postgres, an owner connection (superuser, seeds across tenants) and a restricted app connection
// (NOSUPERUSER NOBYPASSRLS, what DATABASE_URL points at in production).
//
// Per table with an org_id column (MT-011..015, MT-005, MT-026):
//   read-own    tenant A context sees its own row (positive control: without it every "sees nothing" below is vacuous)
//   read-xt     tenant A context sees no tenant B row
//   read-none   no context sees no row (fail closed, MT-005)
//   join-xt     a join, a subquery and a CTE cannot pair A's rows with B's (positive control: the same shapes within A) (MT-016)
//   update-xt   tenant A context cannot update B's row; B's row is verified unchanged by the owner
//   delete-xt   tenant A context cannot delete B's row; B's row is verified still present by the owner
//   insert-xt   tenant A context cannot insert a row for tenant B (RLS WITH CHECK, SQLSTATE 42501)
// A denial is verified against the owner's view of the data, never against the response alone.
// Statuses: PASSED, FAILED, BLOCKED (could not seed / unrelated error: not proof either way), NOT_APPLICABLE.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(
  fileURLToPath(new URL('../../../packages/db/package.json', import.meta.url)),
);
const { Client } = require('pg');

const q = (s) => `"${String(s).replace(/"/g, '""')}"`;

function dummy(col, tag, n) {
  const t = col.udt;
  if (col.enumLabel) return `'${col.enumLabel.replace(/'/g, "''")}'::${q(col.udtSchema)}.${q(t)}`;
  if (col.isArray) return `'{}'::${q(col.udtSchema)}.${q(t)}[]`;
  switch (t) {
    case 'int2':
    case 'int4':
    case 'int8':
    case 'numeric':
    case 'float4':
    case 'float8':
      return String(n);
    case 'bool':
      return 'false';
    case 'uuid':
      return 'gen_random_uuid()';
    case 'jsonb':
    case 'json':
      return `'{}'::${t}`;
    case 'timestamptz':
    case 'timestamp':
      return 'now()';
    case 'date':
      return 'current_date';
    case 'time':
    case 'timetz':
      return 'current_time';
    case 'interval':
      return `'1 day'::interval`;
    case 'bytea':
      return `decode('00${n}${n}', 'hex')`;
    case 'inet':
      return `'10.0.0.${n}'::inet`;
    case 'citext':
      return `'${tag}${n}'::citext`;
    case 'tsvector':
      return `to_tsvector('x')`;
    case 'vector':
      return `'[0]'::vector`;
    default:
      return `'${tag}-${col.name}-${n}'`;
  }
}

export async function runDbProbe({ ownerUrl, appUrl, log = () => {} }) {
  const owner = new Client({ connectionString: ownerUrl });
  const app = new Client({ connectionString: appUrl });
  await owner.connect();
  await app.connect();
  const results = [];
  const add = (table, scenario, control, status, detail = '') =>
    results.push({ table, scenario, control, status, detail });

  // The probe is vacuous if the app connection bypasses RLS: assert it first.
  const w = (
    await app.query(`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`)
  ).rows[0];
  const restricted = !w.rolsuper && !w.rolbypassrls;
  add('*', 'app-role-restricted', 'MT-011', restricted ? 'PASSED' : 'FAILED', JSON.stringify(w));
  if (!restricted) {
    await owner.end();
    await app.end();
    return results;
  }

  const mkOrg = async (slug) =>
    Number(
      (
        await owner.query(
          `insert into organizations (slug, name, plan) values ($1, $1, 'starter')
           on conflict (slug) do update set name = excluded.name returning id`,
          [slug],
        )
      ).rows[0].id,
    );
  const A = await mkOrg('mt-audit-a');
  const B = await mkOrg('mt-audit-b');

  const cols = (
    await owner.query(`
    select c.relname as tbl, a.attname as name, a.attnotnull as notnull, a.attidentity <> '' as ident,
           a.attgenerated <> '' as generated, a.atthasdef as hasdef, t.typname as udt, tn.nspname as udt_schema,
           (t.typcategory = 'A') as is_array, et.typname as elem, t.typtype = 'e' as is_enum,
           case when t.typtype = 'e' then (select enumlabel from pg_enum e where e.enumtypid = t.oid order by enumsortorder limit 1) end as enum_label
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    join pg_type t on t.oid = a.atttypid join pg_namespace tn on tn.oid = t.typnamespace
    left join pg_type et on et.oid = t.typelem and t.typcategory = 'A'
    where n.nspname = 'public' and c.relkind in ('r','p') and not c.relispartition
    order by c.relname, a.attnum`)
  ).rows;
  const byTable = new Map();
  for (const r of cols) {
    if (!byTable.has(r.tbl)) byTable.set(r.tbl, []);
    byTable.get(r.tbl).push({
      name: r.name,
      notnull: r.notnull,
      ident: r.ident,
      generated: r.generated,
      hasdef: r.hasdef,
      udt: r.is_array ? r.elem : r.udt,
      udtSchema: r.udt_schema,
      isArray: r.is_array,
      enumLabel: r.is_enum ? r.enum_label : null,
    });
  }
  const tenantTables = [...byTable.entries()]
    .filter(([, cs]) => cs.some((c) => c.name === 'org_id'))
    .map(([t]) => t)
    .sort();

  const withCtx = async (orgId, fn) => {
    await app.query('begin');
    try {
      if (orgId !== null)
        await app.query(`select set_config('app.org_id', $1, true)`, [String(orgId)]);
      return await fn();
    } finally {
      await app.query('rollback');
    }
  };
  const countAs = (orgId, table, where) =>
    withCtx(orgId, async () =>
      Number((await app.query(`select count(*) n from ${q(table)} where ${where}`)).rows[0].n),
    );
  const ownerCount = async (table, where) =>
    Number((await owner.query(`select count(*) n from ${q(table)} where ${where}`)).rows[0].n);

  const restore = [];
  for (const table of tenantTables) {
    const cs = byTable.get(table);
    const need = cs.filter(
      (c) => !c.generated && (c.name === 'org_id' || (c.notnull && !c.hasdef && !c.ident)),
    );
    const insertSql = (org, n, tag) => {
      const names = need.map((c) => q(c.name));
      const vals = need.map((c) => (c.name === 'org_id' ? String(org) : dummy(c, tag, n)));
      return `insert into ${q(table)} (${names.join(',')}) values (${vals.join(',')})`;
    };
    const seedRow = async (org, n, tag) => {
      await owner.query('begin');
      try {
        await owner.query(`set local session_replication_role = replica`);
        await owner.query(insertSql(org, n, tag));
        await owner.query('commit');
        return null;
      } catch (e) {
        await owner.query('rollback');
        return e;
      }
    };
    // Dummy values cannot satisfy every CHECK. Throwaway databases only: drop the table's CHECKs, seed, re-add them NOT VALID
    // (new rows are still checked), and VALIDATE again once the seed rows are gone, so the schema ends up unchanged.
    const relaxed = [];
    const seedRelaxed = async (org, n, tag) => {
      const checks = (
        await owner.query(
          `select conname, pg_get_constraintdef(oid) def from pg_constraint where conrelid = $1::regclass and contype = 'c'`,
          [`public.${q(table)}`],
        )
      ).rows;
      await owner.query('begin');
      try {
        await owner.query(`set local session_replication_role = replica`);
        for (const c of checks)
          await owner.query(`alter table ${q(table)} drop constraint ${q(c.conname)}`);
        await owner.query(insertSql(org, n, tag));
        for (const c of checks)
          await owner.query(
            `alter table ${q(table)} add constraint ${q(c.conname)} ${c.def.replace(/ NOT VALID$/, '')} not valid`,
          );
        await owner.query('commit');
        for (const c of checks) if (!relaxed.includes(c.conname)) relaxed.push(c.conname);
        return null;
      } catch (e) {
        await owner.query('rollback');
        return e;
      }
    };
    const clean = () =>
      owner
        .query(
          `begin; set local session_replication_role = replica; delete from ${q(table)} where org_id in (${A},${B}); commit`,
        )
        .catch(() => owner.query('rollback').catch(() => {}));
    await clean();
    let eA = await seedRow(A, 1, 'a');
    if (eA && eA.code === '23514') eA = await seedRelaxed(A, 1, 'a');
    let eB = eA ? eA : await seedRow(B, 2, 'b');
    if (!eA && eB && eB.code === '23514') eB = await seedRelaxed(B, 2, 'b');
    if (eA || eB) {
      const msg = (eA || eB).message.split('\n')[0];
      for (const [s, c] of [
        ['read-own', 'MT-012'],
        ['read-xt', 'MT-012'],
        ['read-none', 'MT-005'],
        ['join-xt', 'MT-016'],
        ['update-xt', 'MT-013'],
        ['delete-xt', 'MT-014'],
      ])
        add(table, s, c, 'BLOCKED', `seed failed: ${msg}`);
    } else {
      // A platform-owned table (its only policies are privileged-only, e.g. the lifecycle log, the purge queue and the operator's
      // migration runs) has no tenant policy by design: a tenant seeing its own rows there is not a control to pass. The denial
      // checks below still apply to it, so a tenant reading or writing a foreign row is still a failure.
      const policies = (
        await owner.query(
          `select qual, with_check from pg_policies where schemaname = 'public' and tablename = $1`,
          [table],
        )
      ).rows;
      const platformOnly =
        policies.length > 0 &&
        policies.every(
          (p) =>
            /app_is_privileged\(\)/.test(`${p.qual ?? ''}${p.with_check ?? ''}`) &&
            !/current_org_id\(\)/.test(`${p.qual ?? ''}${p.with_check ?? ''}`),
        );
      const own = await countAs(A, table, `org_id = ${A}`);
      if (platformOnly) {
        add(
          table,
          'read-own',
          'MT-012',
          'NOT_APPLICABLE',
          'platform-owned: privileged-only policy, no tenant rows by design',
        );
      } else {
        add(table, 'read-own', 'MT-012', own >= 1 ? 'PASSED' : 'FAILED', `rows=${own}`);
      }
      const xt = await countAs(A, table, `org_id = ${B}`);
      add(table, 'read-xt', 'MT-012', xt === 0 ? 'PASSED' : 'FAILED', `rows=${xt}`);
      const none = await countAs(null, table, `org_id in (${A},${B})`);
      add(table, 'read-none', 'MT-005', none === 0 ? 'PASSED' : 'FAILED', `rows=${none}`);

      // A join, a subquery and a CTE are scans of the same table, so each one is filtered by the policy; this pairs a visible row of
      // workspace A with a row of workspace B in every shape and expects nothing back, with a same-workspace pairing as the control.
      const joinCount = (whereB) =>
        withCtx(A, async () => {
          const q1 = `select count(*)::int n from ${q(table)} x join ${q(table)} y on true where x.org_id = ${A} and y.org_id = ${whereB}`;
          const q2 = `select count(*)::int n from ${q(table)} x where x.org_id = ${A} and exists (select 1 from ${q(table)} y where y.org_id = ${whereB})`;
          const q3 = `with y as (select org_id from ${q(table)} where org_id = ${whereB}) select count(*)::int n from ${q(table)} x, y where x.org_id = ${A}`;
          const out = [];
          for (const text of [q1, q2, q3]) out.push(Number((await app.query(text)).rows[0].n));
          return out;
        });
      const foreignJoins = await joinCount(B);
      if (platformOnly) {
        // No tenant pairs to control with; the foreign pairings must still come back empty.
        add(
          table,
          'join-xt',
          'MT-016',
          foreignJoins.every((n) => n === 0) ? 'PASSED' : 'FAILED',
          `foreign=${foreignJoins.join('/')} (platform-owned: no tenant pairs to control)`,
        );
      } else {
        const ownJoins = await joinCount(A);
        add(
          table,
          'join-xt',
          'MT-016',
          foreignJoins.every((n) => n === 0) && ownJoins.every((n) => n >= 1) ? 'PASSED' : 'FAILED',
          `foreign=${foreignJoins.join('/')} own=${ownJoins.join('/')}`,
        );
      }

      const mutate = async (scenario, control, sql) => {
        let affected = -1;
        let err = '';
        await withCtx(A, async () => {
          try {
            affected = (await app.query(sql)).rowCount ?? 0;
          } catch (e) {
            err = e.message.split('\n')[0];
          }
        });
        const after = await ownerCount(table, `org_id = ${B}`);
        const ok = affected <= 0 && after === 1;
        add(
          table,
          scenario,
          control,
          ok ? 'PASSED' : 'FAILED',
          `affected=${affected} bRowsAfter=${after}${err ? ' err=' + err : ''}`,
        );
      };
      const upd = cs.find(
        (c) =>
          !['org_id', 'id', 'uuid'].includes(c.name) &&
          !c.ident &&
          !c.generated &&
          c.udt === 'text' &&
          !c.isArray &&
          !c.enumLabel,
      );
      if (upd)
        await mutate(
          'update-xt',
          'MT-013',
          `update ${q(table)} set ${q(upd.name)} = ${q(upd.name)} where org_id = ${B}`,
        );
      else add(table, 'update-xt', 'MT-013', 'NOT_APPLICABLE', 'no plain text column to touch');
      await mutate('delete-xt', 'MT-014', `delete from ${q(table)} where org_id = ${B}`);
    }
    await clean();
    for (const c of relaxed) restore.push([table, c]);

    // Inserting a row for the other tenant from A's context must hit WITH CHECK before any constraint.
    let code = '';
    let msg = '';
    await withCtx(A, async () => {
      try {
        await app.query(insertSql(B, 9, 'x'));
      } catch (e) {
        code = e.code || '';
        msg = e.message.split('\n')[0];
      }
    });
    const leaked = await ownerCount(table, `org_id = ${B}`);
    const status = code === '42501' ? 'PASSED' : code === '' || leaked > 0 ? 'FAILED' : 'BLOCKED';
    add(
      table,
      'insert-xt',
      'MT-013',
      status,
      `sqlstate=${code || 'none'} bRows=${leaked} ${msg}`.trim(),
    );
    await clean();
  }
  // Put the schema back exactly: every CHECK the probe relaxed is validated again; a failure is reported, never hidden.
  for (const [table, c] of restore) {
    try {
      await owner.query(`alter table ${q(table)} validate constraint ${q(c)}`);
    } catch (e) {
      add(table, 'schema-restored', 'MT-023', 'FAILED', `${c}: ${e.message.split('\n')[0]}`);
    }
  }
  log(`probed ${tenantTables.length} tenant tables`);
  await owner.end();
  await app.end();
  return results;
}
