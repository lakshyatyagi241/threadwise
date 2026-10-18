// #47 Constraint audit: PKs, tenant-composite keys, FKs, RLS, enum-like columns, public ids.
import { expectNone, unreviewed } from '../lib/core.mjs';
import { buildSchema, isTenant } from '../lib/schema.mjs';

export default {
  id: 47,
  priority: 'P1',
  name: 'Constraint audit',
  owner: 'Punya',
  target: '100% critical data paths reviewed; measurable before/after evidence',
  async run() {
    const all = buildSchema();
    const tables = [...all.values()].filter((t) => t.columns.size > 1 && t.name.length > 2);
    const tenant = tables.filter(isTenant);
    const f = {
      noPk: tables.filter((t) => !t.pk && !t.partitionChild).map((t) => `${t.name} [${t.file}]`),
      pkNoOrg: tenant
        .filter((t) => t.pk && !t.pk.includes('org_id') && !t.partitioned)
        .map((t) => `${t.name} pk(${t.pk})`),
      fkNoOrg: tenant.flatMap((t) =>
        t.fks
          .filter(
            (k) =>
              all.get(k.ref) &&
              isTenant(all.get(k.ref)) &&
              k.ref !== 'organizations' &&
              !k.cols.includes('org_id'),
          )
          .map((k) => `${t.name}(${k.cols}) -> ${k.ref}: cross-tenant reference possible`),
      ),
      noRls: tenant
        .filter((t) => !t.rls || !t.forced)
        .map((t) => `${t.name}: RLS ${t.rls ? '' : 'not enabled '}${t.forced ? '' : 'not forced'}`),
      noOrgFk: tenant
        .filter((t) => t.name !== 'organizations' && !t.fks.some((k) => k.ref === 'organizations'))
        .map((t) => t.name),
      enumLike: tenant.flatMap((t) =>
        [...t.columns]
          .filter(
            ([n, c]) =>
              /^(status|state|kind|type|role|direction|channel)$/.test(n) &&
              /^(text|varchar|character)/i.test(c.type) &&
              !t.checks,
          )
          .map(([n]) => `${t.name}.${n} is free text with no CHECK`),
      ),
      nullableOrg: tenant
        .filter(
          (t) =>
            t.columns.get('org_id') &&
            !t.columns.get('org_id').notNull &&
            !(t.pk ?? []).includes('org_id'),
        )
        .map((t) => t.name),
    };
    const checks = [
      expectNone('con-pk', 'Every table has a primary key', f.noPk, { severity: 'high' }),
      expectNone(
        'con-pk-org',
        'Tenant table primary keys include org_id (partition/RLS key)',
        unreviewed(47, f.pkNoOrg),
        { level: 'warn' },
      ),
      expectNone(
        'con-fk-composite',
        'Foreign keys between tenant tables are composite on org_id (cross-tenant refs impossible)',
        f.fkNoOrg,
        { severity: 'high' },
      ),
      expectNone('con-rls', 'Every tenant table has RLS enabled AND forced', f.noRls, {
        severity: 'critical',
      }),
      expectNone(
        'con-org-fk',
        'Every tenant table references organizations(id)',
        unreviewed(47, f.noOrgFk),
        {
          level: 'warn',
        },
      ),
      expectNone(
        'con-enum',
        'Enum-like text columns (status/type/kind...) are constrained',
        f.enumLike,
        { level: 'warn' },
      ),
      expectNone(
        'con-org-notnull',
        'org_id is NOT NULL on tenant tables (nullable = global rows: confirm the RLS policy hides them from tenants)',
        unreviewed(47, f.nullableOrg),
        { level: 'warn' },
      ),
    ];
    const pass = checks.filter((c) => c.status === 'pass').length;
    return {
      checks,
      metrics: {
        tables: tables.length,
        'tenant tables': tenant.length,
        FKs: tables.reduce((a, t) => a + t.fks.length, 0),
        'rules passing': `${pass}/${checks.length}`,
      },
      target: {
        met: checks.every((c) => c.status === 'pass') ? true : null,
        text: 'Static replay of the SQL migrations. Confirm with `pnpm db:verify-schema` against a live database.',
      },
    };
  },
};
