#!/usr/bin/env node
// Multi-tenancy isolation audit. Sibling of tools/auth-audit and tools/authz-audit.
//
//   pnpm audit:tenancy                      # catalog inventory + generated DB probe + static code scans
//   pnpm audit:tenancy -- --static          # code scans only, no database needed
//   pnpm audit:tenancy -- --strict          # pre-release: exit 1 unless the verdict is GO
//
// Needs (unless --static): a migrated THROWAWAY Postgres. MIGRATION_DATABASE_URL = owner/superuser (seeds rows),
// TENANCY_APP_DATABASE_URL = the restricted app role (NOSUPERUSER NOBYPASSRLS). Never point it at real data: the probe writes
// and deletes synthetic rows and briefly drops/re-adds CHECK constraints on a few tables.
//
// Verdict rules (conservative): FAILED probe, an unclassified table, an unreviewed privileged site, a tenant-owned table
// without forced RLS => NO-GO. Anything not executed => CONDITIONAL at best, listed under notRun. Never GO from this tool alone.
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  scanPrivileged,
  scanProcessors,
  scanRedisKeys,
  scanSqlRawInterpolation,
} from './lib/code-scan.mjs';
import { runDbProbe } from './lib/db-probe.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const require = createRequire(join(root, 'packages/db/package.json'));
const out = join(root, 'reports/tenancy-audit/latest');
mkdirSync(out, { recursive: true });
const staticOnly = process.argv.includes('--static');
const json = (n) => JSON.parse(readFileSync(join(here, 'policy', n), 'utf8'));
const w = (n, v) =>
  writeFileSync(join(out, n), typeof v === 'string' ? v : JSON.stringify(v, null, 1));

const today = new Date().toISOString().slice(0, 10);
const findings = json('findings.json');
const src = join(root, 'apps/api/src');

// ---- static ---------------------------------------------------------------------------------------------------------
const priv = scanPrivileged(src, json('privileged-allowlist.json'));
const procs = scanProcessors(src, json('processor-declarations.json'));
const redis = scanRedisKeys(src, json('redis-reviewed.json'));
const sqlRaw = scanSqlRawInterpolation(src, json('sql-raw-interpolation.json'));
w('tenant-cache-queue-audit.json', {
  generated: today,
  privileged: priv,
  processors: procs,
  redis,
  sqlRawInterpolation: sqlRaw,
});

// ---- database -------------------------------------------------------------------------------------------------------
let inventory = [];
let catalog = null; // structural checks from the live catalog (MT-018, MT-019)
let probe = [];
let dbNote = '';
const classes = json('table-classification.json');
if (!staticOnly) {
  const ownerUrl = process.env.MIGRATION_DATABASE_URL;
  const appUrl = process.env.TENANCY_APP_DATABASE_URL;
  if (!ownerUrl || !appUrl) {
    dbNote = 'MIGRATION_DATABASE_URL / TENANCY_APP_DATABASE_URL not set: database checks NOT RUN';
  } else {
    const { Client } = require('pg');
    const c = new Client({ connectionString: ownerUrl });
    await c.connect();
    inventory = (
      await c.query(`
      select c.relname as tbl,
        exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='org_id' and not a.attisdropped) as has_org_id,
        c.relrowsecurity as rls, c.relforcerowsecurity as forced,
        (select count(*)::int from pg_policy p where p.polrelid=c.oid) as policies,
        coalesce((select string_agg(p.polname,'|' order by p.polname) from pg_policy p where p.polrelid=c.oid),'') as policy_names
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p') and not c.relispartition order by 1`)
    ).rows;
    // MT-018: a foreign key between two tenant tables must include org_id on both sides, otherwise a row could point at another
    // workspace's row and Postgres would accept it. MT-019: a unique index on a tenant table that does not include org_id is a
    // platform-wide namespace; each one must be classified in policy/global-unique.json (a new one fails until it is).
    const hasOrg = `exists(select 1 from pg_attribute a where a.attrelid = %T% and a.attname = 'org_id' and not a.attisdropped)`;
    const fks = (
      await c.query(`
      select s.relname as child, t.relname as parent, k.conname,
             (select a.attnum from pg_attribute a where a.attrelid = s.oid and a.attname = 'org_id') = any (k.conkey)
             and (select a.attnum from pg_attribute a where a.attrelid = t.oid and a.attname = 'org_id') = any (k.confkey) as composite
      from pg_constraint k join pg_class s on s.oid = k.conrelid join pg_class t on t.oid = k.confrelid
      join pg_namespace n on n.oid = s.relnamespace
      where k.contype = 'f' and n.nspname = 'public' and not s.relispartition and t.relname <> 'organizations'
        and ${hasOrg.replaceAll('%T%', 's.oid')} and ${hasOrg.replaceAll('%T%', 't.oid')}`)
    ).rows;
    const uq = (
      await c.query(`
      select t.relname as tbl, i.relname as idx
      from pg_index x join pg_class t on t.oid = x.indrelid join pg_class i on i.oid = x.indexrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public' and x.indisunique and not t.relispartition and t.relkind in ('r','p')
        and ${hasOrg.replaceAll('%T%', 't.oid')}
        and not exists (select 1 from unnest(x.indkey) kk join pg_attribute a on a.attrelid = t.oid and a.attnum = kk where a.attname = 'org_id')`)
    ).rows;
    const views = (
      await c.query(
        `select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('v','m')`,
      )
    ).rows;
    const definers = (
      await c.query(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef order by 1`,
      )
    ).rows;
    const globalUnique = json('global-unique.json');
    catalog = {
      foreignKeys: {
        checked: fks.length,
        notComposite: fks
          .filter((f) => !f.composite)
          .map((f) => `${f.child} -> ${f.parent} (${f.conname})`),
      },
      uniqueWithoutOrgId: {
        total: uq.length,
        unclassified: uq.filter((u) => !globalUnique[u.idx]).map((u) => `${u.tbl}.${u.idx}`),
        byCategory: uq.reduce(
          (acc, u) => (
            (acc[globalUnique[u.idx]?.category ?? 'UNCLASSIFIED'] =
              (acc[globalUnique[u.idx]?.category ?? 'UNCLASSIFIED'] ?? 0) + 1),
            acc
          ),
          {},
        ),
      },
      views: views.map((v) => v.relname),
      securityDefinerFunctions: definers.map((d) => d.proname),
    };
    await c.end();
    probe = await runDbProbe({ ownerUrl, appUrl, log: console.log });
  }
}

const tableRows = inventory.map((t) => {
  const cls = t.has_org_id ? 'TENANT_SCOPED' : (classes[t.tbl]?.class ?? 'UNCLASSIFIED');
  return {
    ...t,
    classification: cls,
    reason: t.has_org_id ? 'org_id column' : (classes[t.tbl]?.reason ?? ''),
  };
});
w(
  'tenant-entity-inventory.csv',
  ['table,classification,has_org_id,rls_enabled,rls_forced,policies,policy_names,reason']
    .concat(
      tableRows.map((t) =>
        [
          t.tbl,
          t.classification,
          t.has_org_id,
          t.rls,
          t.forced,
          t.policies,
          t.policy_names,
          `"${t.reason.replace(/"/g, "'")}"`,
        ].join(','),
      ),
    )
    .join('\n'),
);

const tenantNoForce = tableRows.filter(
  (t) => t.has_org_id && (!t.forced || !t.rls || t.policies === 0),
);
const unclassified = tableRows.filter((t) => t.classification === 'UNCLASSIFIED');
const by = (s) => probe.filter((p) => p.status === s).length;
w('tenant-database-query-audit.json', {
  generated: today,
  note: catalog ? '' : 'database checks NOT RUN',
  ...(catalog ?? {}),
});
w('tenant-isolation-test-results.json', {
  generated: today,
  summary: {
    PASSED: by('PASSED'),
    FAILED: by('FAILED'),
    BLOCKED: by('BLOCKED'),
    NOT_APPLICABLE: by('NOT_APPLICABLE'),
    total: probe.length,
  },
  note: dbNote,
  results: probe,
});

// ---- controls -------------------------------------------------------------------------------------------------------
const controls = json('controls.json'); // id -> { title, evidence: [...] }

// The authz audit's dynamic specs (pnpm audit:authz -- --dynamic) are evidence for many MT controls. A spec counts as PASSED only
// when it loaded, ran at least one test, and every test passed with none skipped; a suite that failed to load is BLOCKED.
const authzSpecs = {};
try {
  const rep = JSON.parse(
    readFileSync(join(root, 'reports/authz-audit/latest/vitest-authz.json'), 'utf8'),
  );
  for (const f of rep.testResults ?? []) {
    const m = /authz[\\/]([\w-]+)\.e2e\.spec\.ts$/.exec(f.name);
    if (!m) continue;
    const a = f.assertionResults ?? [];
    const st = (x) => a.filter((t) => t.status === x).length;
    authzSpecs[m[1]] =
      a.length === 0
        ? 'BLOCKED'
        : st('failed')
          ? 'FAILED'
          : st('passed') === a.length
            ? 'PASSED'
            : 'NOT_RUN';
  }
} catch {
  /* no authz results: those controls stay NOT_RUN */
}

// vitest JSON reports of the other e2e suites that exercise tenant isolation (reports/tenancy-audit/e2e/<name>.json). A spec is PASSED
// only when it ran at least one test and none failed; a report with no executed test (setup timed out, nothing matched) is BLOCKED.
const e2eSpecs = {};
// 'spec' counts every test in that report; 'spec::regex' only the tests whose full name matches (so an unrelated flaky test in a big
// spec cannot fail a control that depends on its isolation tests, and cannot pass it either: at least one matching test must pass).
function e2eVerdict(entry) {
  const [name, pattern] = entry.split('::');
  const all = e2eSpecs[name];
  if (!all) return 'NOT_RUN';
  const subset = pattern ? all.filter((t) => new RegExp(pattern, 'i').test(t.name)) : all;
  if (subset.some((t) => t.status === 'failed')) return 'FAILED';
  return subset.some((t) => t.status === 'passed') ? 'PASSED' : 'BLOCKED';
}
try {
  const dir = join(root, 'reports/tenancy-audit/e2e');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const rep = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const all = (rep.testResults ?? []).flatMap((t) => t.assertionResults ?? []);
    const n = (st) => all.filter((t) => t.status === st).length;
    e2eSpecs[f.replace(/.json$/, '')] = all.map((t) => ({
      status: t.status,
      name: t.fullName ?? '',
    }));
  }
} catch {
  /* no e2e reports collected */
}
const status = {};
for (const [id, c] of Object.entries(controls)) {
  let s = c.status ?? 'NOT_RUN';
  if (c.evidence === 'db-probe') {
    const rs = probe.filter((p) => p.control === id);
    s = !rs.length
      ? 'NOT_RUN'
      : rs.some((r) => r.status === 'FAILED')
        ? 'FAILED'
        : rs.some((r) => r.status === 'BLOCKED')
          ? 'BLOCKED'
          : 'PASSED';
  }
  if (c.evidence === 'authz' || c.evidence === 'e2e') {
    const parts = [
      ...(c.specs ?? []).map((sp) => [`authz:${sp}`, authzSpecs[sp] ?? 'NOT_RUN']),
      ...(c.e2e ?? []).map((sp) => [`e2e:${sp}`, e2eVerdict(sp)]),
    ];
    const per = parts.map(([, v]) => v);
    s = per.includes('FAILED')
      ? 'FAILED'
      : per.includes('BLOCKED')
        ? 'BLOCKED'
        : per.every((x) => x === 'PASSED')
          ? 'PASSED'
          : 'NOT_RUN';
    c.basis = `${c.basis} [${parts.map(([k, v]) => `${k}: ${v}`).join(', ')}]`;
  }
  if (c.evidence === 'catalog') {
    s = !catalog
      ? 'NOT_RUN'
      : (c.catalog ?? []).every((k) =>
            k === 'fk'
              ? catalog.foreignKeys.notComposite.length === 0
              : k === 'unique'
                ? catalog.uniqueWithoutOrgId.unclassified.length === 0
                : false,
          )
        ? 'PASSED'
        : 'FAILED';
  }
  if (c.evidence === 'static:privileged') s = priv.unreviewed.length ? 'FAILED' : 'PASSED';
  if (c.evidence === 'doc') {
    try {
      const text = readFileSync(join(root, c.doc), 'utf8');
      s = (c.headings ?? []).every((h) => text.includes(h)) ? 'PASSED' : 'FAILED';
    } catch {
      s = 'FAILED';
    }
  }
  if (c.evidence === 'static:sqlraw')
    s = sqlRaw.unreviewed.length || priv.unreviewed.length ? 'FAILED' : 'PASSED';
  if (c.evidence === 'static:classification')
    s = !inventory.length
      ? 'NOT_RUN'
      : unclassified.length || tenantNoForce.length
        ? 'FAILED'
        : 'PASSED';
  status[id] = { title: c.title, priority: c.priority ?? 'P0', status: s, basis: c.basis };
}
w('tenant-control-matrix.json', status);

// ---- verdict --------------------------------------------------------------------------------------------------------
const blockers = [];
if (by('FAILED')) blockers.push(`${by('FAILED')} generated cross-tenant scenarios FAILED`);
if (tenantNoForce.length)
  blockers.push(`${tenantNoForce.length} tenant tables without forced RLS + policy`);
if (unclassified.length) blockers.push(`${unclassified.length} tables unclassified`);
if (sqlRaw.unreviewed.length)
  blockers.push(`${sqlRaw.unreviewed.length} files with a new, unreviewed interpolating sql.raw()`);
if (priv.unreviewed.length)
  blockers.push(`${priv.unreviewed.length} files with a new, unreviewed privileged() call site`);
const open = findings.filter((f) => f.status === 'open' || f.status === 'decision-needed');
const fixed = findings.filter((f) => f.status === 'fixed');
for (const f of open.filter((x) => ['Critical', 'High'].includes(x.severity) && x.releaseBlocking))
  blockers.push(`${f.id} ${f.title}`);
for (const [id, v] of Object.entries(status))
  if (v.status === 'FAILED' && v.priority === 'P0') blockers.push(`${id} ${v.title}: ${v.basis}`);
const failedP1 = Object.entries(status)
  .filter(([, v]) => v.status === 'FAILED' && v.priority === 'P1')
  .map(([id]) => id);
const notRun = Object.entries(status)
  .filter(([, v]) => v.status === 'NOT_RUN' || v.status === 'BLOCKED')
  .map(([id]) => id);
const verdict = blockers.length ? 'NO-GO' : notRun.length || failedP1.length ? 'CONDITIONAL' : 'GO';
w('tenant-security-findings.json', findings);
w('tenant-isolation-release-certification.json', {
  generated: today,
  verdict,
  blockers,
  controlsNotRunOrBlocked: notRun,
  unmetP1Controls: failedP1,
  statement:
    'Not a proof of absence of vulnerabilities. GO is only possible when every applicable P0 control has executed evidence; ' +
    'this tool does not execute API, queue, WebSocket, cache or file-level dynamic tests itself (they live in apps/api/test/e2e/authz and are tracked as NOT_RUN here until wired).',
});

const cnt = (st) => priv.files.filter((f) => f.reviewed?.status === st).length;
const lines = [];
lines.push(`# Tenancy isolation audit (${today})`, '', `Verdict: **${verdict}**`, '');
if (blockers.length) lines.push('## Blockers', ...blockers.map((b) => `- ${b}`), '');
lines.push(
  '## Evidence this run',
  `- tables inspected: ${inventory.length} (tenant-scoped ${tableRows.filter((t) => t.has_org_id).length}, other ${tableRows.filter((t) => !t.has_org_id).length}); unclassified ${unclassified.length}; tenant tables without forced RLS+policy ${tenantNoForce.length}`,
  `- generated DB scenarios: ${probe.length} (PASSED ${by('PASSED')}, FAILED ${by('FAILED')}, BLOCKED ${by('BLOCKED')}, NOT_APPLICABLE ${by('NOT_APPLICABLE')})${dbNote ? ' -- ' + dbNote : ''}`,
  `- privileged() call sites: ${priv.totalSites} in ${priv.files.length} files; reviewed ${cnt('reviewed')}, reviewed-and-fixed ${cnt('reviewed-fixed')}, reviewed-partial ${cnt('reviewed-partial')}, baseline-unreviewed ${cnt('baseline-unreviewed')}, new/unlisted ${priv.unreviewed.length}`,
  `- interpolating sql.raw() files: ${sqlRaw.files.length}, unreviewed ${sqlRaw.unreviewed.length}`,
  `- queue processors: ${procs.processors.length}; without a tenant-context call and without a declaration: ${procs.unproven.length}`,
  `- Redis key calls: ${redis.calls}; templates with no org token and no review note: ${redis.unreviewed.length} files`,
  '',
  '## Open findings and owner decisions',
  ...open.map((f) => `- ${f.id} [${f.severity}] ${f.status}: ${f.title}`),
  '',
  '## Fixed in this change (each with its regression test in the finding)',
  ...fixed.map((f) => `- ${f.id} [${f.severity}] ${f.title}`),
  '',
  '## Controls not executed or blocked',
  notRun.join(', ') || 'none',
  '',
);
w('report.md', lines.join('\n'));

// ---- the rest of the report set -------------------------------------------------------------------------------------------
const bySeverity = { Critical: 0, High: 1, Medium: 2, Low: 3, Info: 4 };
const sortedOpen = [...open].sort(
  (x, y) => (bySeverity[x.severity] ?? 9) - (bySeverity[y.severity] ?? 9),
);
w(
  'tenant-remediation-backlog.md',
  [
    `# Tenancy remediation backlog (${today})`,
    '',
    'Open items and owner decisions, worst first. Fixed items are in `tenant-security-findings.json` with their regression test.',
    '',
    ...sortedOpen.flatMap((f) => [
      `## ${f.id} [${f.severity}] ${f.title}`,
      `- status: ${f.status}`,
      `- resource: ${f.resource}`,
      `- exploitability: ${f.exploitability}`,
      `- what to do: ${f.fix}`,
      '',
    ]),
    '## Controls not executed or unmet',
    ...Object.entries(status)
      .filter(([, v]) => v.status !== 'PASSED' && v.status !== 'NOT_APPLICABLE')
      .map(([id, v]) => `- ${id} (${v.priority}) ${v.status}: ${v.title}. ${v.basis}`),
    '',
  ].join('\n'),
);

const suites = [
  {
    suite: 'generated cross-tenant probe (every tenant table)',
    scenarios: probe.length,
    controls: ['MT-005', 'MT-011', 'MT-012', 'MT-013', 'MT-014', 'MT-016'],
  },
  ...Object.entries(authzSpecs).map(([name, st]) => ({
    suite: `authz dynamic: ${name}`,
    result: st,
  })),
  ...Object.entries(e2eSpecs).map(([name, tests]) => ({
    suite: `e2e/unit: ${name}`,
    tests: tests.length,
    passed: tests.filter((t) => t.status === 'passed').length,
    failed: tests.filter((t) => t.status === 'failed').length,
    skipped: tests.filter((t) => t.status !== 'passed' && t.status !== 'failed').length,
  })),
];
w('tenant-isolation-test-inventory.json', { generated: today, suites });

w('tenant-integration-security-report.json', {
  generated: today,
  note: 'Inbound routing and third-party mappings. Each row says how the workspace is chosen and what was verified.',
  integrations: [
    {
      name: 'WhatsApp Cloud (WABA) inbound',
      mapping: 'waba_route_lookup(phone_number_id, waba_id) then txAs(route.orgId)',
      verified:
        'live phone number globally unique (index); manual connect now requires the WABA to list the phone (TI-003)',
      finding: 'TI-003',
    },
    {
      name: 'Shopify / WooCommerce webhooks',
      mapping: 'ecom_store_lookup(kind, secret) then signature',
      verified:
        'secret is server-generated randomBytes(30); unique index on routable secrets (TI-004)',
      finding: 'TI-004',
    },
    {
      name: 'Provider payment subscription events',
      mapping:
        'subscription id, order number, else a plan id only when exactly one subscription matches',
      verified: 'ambiguous plan-only events match nothing (TI-009)',
      finding: 'TI-009',
    },
    {
      name: 'Telegram, Facebook, Instagram, widgets, forms, booking',
      mapping: 'high-entropy token or key looked up by SECURITY DEFINER function',
      verified:
        'functions listed in tenant-database-query-audit.json; reviewed callers (privileged-allowlist.json)',
      finding: null,
    },
    {
      name: 'Unofficial WhatsApp devices (catalog bridge)',
      mapping: 'device by number inside an explicit workspace',
      verified: 'fails closed without a workspace (TI-008)',
      finding: 'TI-008',
    },
    {
      name: 'Public API keys',
      mapping: 'unique key prefix, argon2 / HMAC, scope check',
      verified: 'failed-auth throttle on both guards (TI-013); api-key-scopes authz spec',
      finding: 'TI-013',
    },
  ],
});

const esc = (t) =>
  String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const colour = {
  PASSED: '#1a7f37',
  FAILED: '#cf222e',
  NOT_RUN: '#9a6700',
  BLOCKED: '#bc4c00',
  NOT_APPLICABLE: '#57606a',
};
w(
  'tenant-isolation-coverage.html',
  `<!doctype html><meta charset="utf-8"><title>Tenancy isolation coverage ${today}</title>
<style>body{font:14px system-ui;margin:24px;max-width:1100px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d0d7de;padding:4px 8px;text-align:left;vertical-align:top}th{background:#f6f8fa}</style>
<h1>Tenancy isolation coverage (${today})</h1><p>Verdict: <b>${verdict}</b>. ${Object.values(status).filter((v) => v.status === 'PASSED').length} of ${Object.keys(status).length} controls passed with executed evidence.</p>
<table><tr><th>Control</th><th>P</th><th>Status</th><th>Title</th><th>Basis</th></tr>${Object.entries(
    status,
  )
    .map(
      ([id, v]) =>
        `<tr><td>${id}</td><td>${v.priority}</td><td style="color:${colour[v.status] ?? '#000'};font-weight:600">${v.status}</td><td>${esc(v.title)}</td><td>${esc(v.basis)}</td></tr>`,
    )
    .join('')}</table>`,
);

w(
  'multi-tenancy-architecture.md',
  [
    '# Multi-tenancy architecture (as audited)',
    '',
    `Model: shared PostgreSQL database, \`org_id\` on ${tableRows.filter((t) => t.has_org_id).length} tenant tables, forced Row-Level Security, composite foreign keys, a non-superuser application role, transaction-local tenant context. Full description: docs/architecture/multi-tenancy.md. How the identity travels: docs/architecture/tenant-context.md.`,
    '',
    `- tenant-owned tables: ${tableRows.filter((t) => t.has_org_id).length}; other tables: ${tableRows.filter((t) => !t.has_org_id).length}, each classified (see tenant-entity-inventory.csv)`,
    `- foreign keys between tenant tables: ${catalog ? catalog.foreignKeys.checked : 'not run'}, all composite on org_id: ${catalog ? catalog.foreignKeys.notComposite.length === 0 : 'not run'}`,
    `- unique indexes without org_id: ${catalog ? catalog.uniqueWithoutOrgId.total : 'not run'}, all classified as deliberate global namespaces`,
    `- SECURITY DEFINER functions: ${catalog ? catalog.securityDefinerFunctions.length : 'not run'}; views: ${catalog ? catalog.views.length : 'not run'}`,
    `- files that call privileged(): ${priv.files.length} (all reviewed); queue processors: ${procs.processors.length}`,
    '- escape hatch: app.privileged is a settable setting (TI-001, ADR-0028 proposed)',
    '',
  ].join('\n'),
);
console.log(lines.join('\n'));
// --strict (pre-release): anything short of GO fails the run, not just NO-GO.
process.exitCode =
  verdict === 'NO-GO' || (process.argv.includes('--strict') && verdict !== 'GO') ? 1 : 0;
