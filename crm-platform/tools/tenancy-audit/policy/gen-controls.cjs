// Regenerates policy/controls.json from the proposed MT-001..100 list. Run: node tools/tenancy-audit/policy/gen-controls.cjs
// Statuses here are the ONLY place a control gets a basis; a control is PASSED only when run.mjs derives it from executed evidence.
const fs = require('fs');
const path = require('path');

const titles = [
  'Inventory every tenant-owned entity',
  'Classify every table global/tenant/user/shared',
  'Document trusted tenant-context resolution',
  'Reject unauthorized client-supplied tenant overrides',
  'Reject tenant-scoped requests with missing or invalid context',
  'Separate tenant membership from global user identity',
  'Prevent context leakage between simultaneous requests',
  'Explicit authorization for cross-tenant admin operations',
  'Preserve tenant boundaries across gateway/BFF and service calls',
  'Enforce tenant-scoping conventions via automated architecture rules',
  'Every tenant-owned record has a valid tenant association',
  'Scope all SELECT queries',
  'Scope UPDATE operations',
  'Scope DELETE operations',
  'Scope count/distinct/group/aggregate',
  'Prevent cross-tenant lookup/join leaks',
  'Prevent unsafe raw SQL bypassing scope',
  'Validate tenant integrity of foreign keys',
  'Tenant-aware uniqueness',
  'Tenant-scoped pagination and sorting',
  'Aggregation stage ordering cannot leak',
  'Audit transaction scope and rollback isolation',
  'Migrations/backfills preserve tenant ownership',
  'Per-tenant DB connections resolve correctly (if applicable)',
  'Audit indexes, query plans, pool contention by tenant',
  'Validate tenant membership on every protected operation',
  'Prevent cross-tenant use of session/JWT workspace claims',
  'Prevent tenant-switching permission inheritance',
  'Reject removed/suspended members',
  "Prevent tenant admins managing another tenant's staff",
  'Restrict API keys to their tenant',
  'Apply role/permission policies inside the tenant',
  'Prevent unauthorized system-admin impersonation',
  'Invalidate access after membership/role revocation',
  'Prevent stale authorization caches after workspace switch',
  'Namespace tenant-scoped cache keys',
  'Prevent reading foreign cached responses',
  "Prevent overwriting another tenant's cache",
  'Scope distributed locks',
  'Scope dedup and idempotency keys',
  'Scope rate-limit counters per policy',
  'Prevent cross-tenant pub/sub access',
  'Test tenant-specific cache invalidation',
  'Redis memory/eviction controls',
  'Redis-unavailable fallback behaviour',
  'Carry tenant identity with every job',
  'Validate tenant context before processing jobs',
  'Prevent worker context reuse across tenants',
  'Prevent retry/DLQ replay under the wrong tenant',
  'Scope scheduled tasks',
  'Events carry validated tenant context',
  'Prevent cross-tenant event subscriptions',
  'Prevent cross-tenant idempotency collisions',
  'Scope automation workflows, triggers, actions',
  'Prevent tenant credentials reused by another job',
  'Bulk jobs cannot process all tenants',
  'Tenant-aware queue concurrency/fairness',
  'Correct context across retries, failures, restarts',
  'Scope attachment upload/storage ownership',
  'Authorize before generating signed URLs',
  'Prevent foreign attachment preview/download',
  'Exports contain only authorized tenant data',
  'Prevent cross-tenant import updates/upserts',
  'Scope temp files and report jobs',
  'Scope full-text search',
  'Scope autocomplete/suggestions',
  'Prevent facet/count leaks',
  'Scope dashboards and saved reports',
  'Prevent shared CDN/browser caches exposing tenant data',
  'Restrict signed URLs to object, method, expiry',
  'Tenant-aware deletion and file retention',
  'Contacts isolation',
  'Companies isolation',
  'Inbox isolation',
  'WhatsApp tenant-to-WABA/number mapping',
  'Broadcast isolation',
  'Bot isolation',
  'Automation isolation',
  'Email/SMS/voice sender isolation',
  'Webhook source-to-tenant mapping',
  'Integration credential isolation',
  'Billing/wallet isolation',
  'Analytics isolation',
  'Realtime/WebSocket isolation',
  'Public/developer API isolation',
  'Tenant-scope knowledge base and vector retrieval',
  'Prevent cross-tenant conversation memory leakage',
  'Restrict agent tool calls to tenant',
  'Prompt injection cannot override tenant context',
  'Agent credentials and tools tenant-scoped',
  'No cross-tenant exposure in AI reports',
  'Isolate agent sessions, checkpoints, retries',
  'Per-tenant request/resource limits',
  'One tenant cannot exhaust pools/workers',
  'Secure tenant provisioning defaults',
  'Secure deactivation, deletion, retention',
  'Tenant identity in migration, backup, restore',
  'Admin tooling cannot bypass tenant scope',
  'Generate cross-tenant tests when tenant code changes',
  'Block releases on confirmed leakage',
];
if (titles.length !== 100) throw new Error('expected 100 titles, got ' + titles.length);

// What was only READ (not executed). Never counted as a pass.
const manual = {
  4: 'tenant is derived server-side from the authenticated identity (realtime.gateway roomName(identity.orgId, ref)); client cannot choose it. Not executed in this tool.',
  7: 'withTenant uses transaction-local set_config; not tested under concurrency here.',
  17: 'raw sql in services reviewed by sampling only.',
  18: 'catalog query found 0 non-composite FKs between org_id tables; no dynamic cross-tenant relationship insert test yet.',
  19: 'PKs are (org_id, id); other unique indexes not audited.',
  31: 'covered by existing apps/api/test/e2e/authz/api-key-scopes.e2e.spec.ts; not run in this session.',
  36: 'key templates scanned (tenant-cache-queue-audit.json): 12 files reviewed, 26 baseline-unreviewed.',
  40: 'idempotency key idem:<orgId>:<key> read; not executed.',
  39: 'every lock call site carries the org (SenderLease.key(orgId, ...), camp:run:<orgId>:<id>, the device lease takes (orgId, deviceId)); Postgres advisory locks are per org. Read, not executed.',
  47: 'processor scan: 20 of 24 establish a tenant context in code; the other 4 are declared with reasons.',
  75: 'live phone_number_id is globally unique (uq_wa_provider_configs_waba_phone); the waba_id fallback is not (TI-003).',
  80: 'inbound routing read (waba_route_lookup, ecom_store_lookup); signature verification not re-tested here.',
  84: 'room names derive from server-side identity.orgId; existing realtime e2e not run here.',
  86: 'The knowledge base passage search filters org_id and assistant_id explicitly and under RLS (read).',
};

// MT control -> the authz dynamic specs (apps/api/test/e2e/authz/<name>.e2e.spec.ts) whose passing run is its evidence.
// Only controls a spec really exercises are listed; the rest stay NOT_RUN. The authz audit's own control table
// (tools/authz-audit/lib/controls.mjs) is the source for what each spec covers.
const authz = {
  4: ['field-level', 'idor-families'],
  7: ['cache-and-races'],
  15: ['idor-families'],
  26: ['lifecycle'],
  27: ['lifecycle'],
  28: ['lifecycle'],
  29: ['lifecycle'],
  30: ['lifecycle'],
  31: ['api-key-scopes'],
  32: ['route-matrix', 'lifecycle'],
  34: ['lifecycle', 'cache-and-races'],
  35: ['lifecycle', 'cache-and-races'],
  37: ['cache-and-races'],
  38: ['cache-and-races'],
  43: ['cache-and-races'],
  46: ['workers'],
  47: ['workers'],
  49: ['workers'],
  54: ['idor-families'],
  56: ['bulk-export'],
  58: ['workers'],
  59: ['bulk-export', 'idor-families'],
  60: ['bulk-export', 'idor-families'],
  61: ['bulk-export', 'idor-families'],
  62: ['bulk-export'],
  63: ['bulk-export'],
  65: ['idor-families'],
  67: ['idor-families'],
  68: ['idor-families'],
  70: ['bulk-export'],
  72: ['idor-families'],
  73: ['idor-families'],
  74: ['idor-families'],
  75: ['idor-families'],
  76: ['workers', 'idor-families'],
  77: ['idor-families'],
  78: ['idor-families'],
  79: ['workers'],
  80: ['workers'],
  81: ['idor-families'],
  82: ['idor-families'],
  83: ['idor-families'],
  84: ['realtime'],
  6: ['lifecycle'],
  36: ['cache-and-races'],
  40: ['cache-and-races'],
  42: ['realtime'],
  48: ['workers'],
  52: ['realtime'],
  55: ['workers'],
  96: ['cache-and-races'],
  53: ['cache-and-races'],
  20: ['idor-families', 'route-matrix'],
  51: ['workers'],
  85: ['api-key-scopes'],
};

// MT control -> vitest JSON reports in reports/tenancy-audit/e2e/<name>.json (module isolation suites run with -t "isolation|...",
// plus the audit's own regression and concurrency specs). Same rule: PASSED only if the spec ran and none of it failed.
const e2e = {
  7: ['tenancy-concurrency'],
  72: ['contact-groups'],
  74: ['message-send', 'channels'],
  75: ['waba-connect'],
  76: ['broadcast-wizard'],
  77: ['widgets-admin', 'widget-public'],
  78: ['flows::tenant isolation'],
  82: ['invoicing'],
  86: ['ai-training'],
  80: ['tenancy-regressions'],
  33: ['impersonation'],
  22: ['tenancy-concurrency'],
  9: ['web-proxy'],
  79: ['catalog-bridge'],
  41: ['throttle-http'],
  45: ['rate-limiter', 'throttle-http::Redis is down|unreachable'],
  85: ['api-key-throttle'],
  69: ['tenancy-concurrency'],
  87: ['widget-public'],
  88: ['ai-training'],
  90: ['ai-keys'],
  39: ['lock-scoping'],
  64: ['media-purge-isolation', 'storage-key-owner'],
  66: ['typeahead-scoping'],
  71: ['media-purge-isolation', 'storage-key-owner'],
};

// What a unit-spec-backed control does NOT cover, appended to its basis so a PASSED is never read as the whole boundary.
const scope = {
  39: 'Redis leases (SenderLease) and every Postgres advisory-lock call site by static scan; not the BullMQ job locks.',
  64: 'chat-media keys, temporary links and the erase purge; the audit-log / consent export files and report jobs are NOT exercised here.',
  66: 'the contacts and companies pickers only; other pickers (deals, users, tags, templates) are NOT exercised.',
  71: 'the erase purge and chat-media removal only; per-module retention sweeps are reviewed by the privileged() allowlist, not run.',
};

// Requirements the audit found NOT met: recorded as FAILED with the finding, never as NOT_RUN.
const unmet = {
  57: 'TI-016: BullMQ queues have no per-tenant fairness or concurrency limit',
  93: 'TI-015: the default request throttle is off and there is no per-workspace subject',
  44: 'TI-017: docker-compose.prod.yml starts Redis with noeviction but no maxmemory (deploy/hostinger sets one)',
};

const P1 = new Set([25, 44, 57, 71, 93, 94]); // the P1 controls in the standard; every other control is P0
const out = {};
titles.forEach((title, i) => {
  const n = i + 1;
  const id = 'MT-' + String(n).padStart(3, '0');
  const e = {
    title,
    priority: P1.has(n) ? 'P1' : 'P0',
    status: 'NOT_RUN',
    basis: manual[n]
      ? 'manual read only, no executed test: ' + manual[n]
      : 'no executed evidence in this tool yet',
  };
  if ([5, 11, 12, 13, 14, 16].includes(n)) {
    e.evidence = 'db-probe';
    e.basis =
      'generated catalog-driven scenarios (tools/tenancy-audit/lib/db-probe.mjs), also run as apps/api/test/integration/tenancy-isolation.generated.spec.ts';
  }
  if (authz[n] && !e.evidence) {
    e.evidence = 'authz';
    e.specs = authz[n];
    e.basis = 'executed by the authz dynamic specs: ' + authz[n].join(', ');
  }
  if (e2e[n]) {
    e.evidence = e.evidence === 'authz' ? 'authz' : 'e2e';
    e.e2e = e2e[n];
    e.basis =
      (e.evidence === 'authz' ? e.basis + '; ' : '') + 'executed e2e suites: ' + e2e[n].join(', ');
  }
  if (scope[n]) e.basis += ' Scope: ' + scope[n];
  if (unmet[n]) {
    e.status = 'FAILED';
    e.basis = 'requirement not met: ' + unmet[n];
  }
  if (n === 18 || n === 19) {
    e.evidence = 'catalog';
    e.catalog = n === 18 ? ['fk'] : ['unique'];
    e.basis =
      n === 18
        ? 'catalog: every foreign key between tenant tables includes org_id on both sides (a cross-tenant reference is structurally impossible); see tenant-database-query-audit.json'
        : 'catalog: every unique index on a tenant table that lacks org_id is classified in policy/global-unique.json (tokens, external identities, public names, partitioned PKs); a new one fails until classified';
  }
  if (n === 3) {
    e.evidence = 'doc';
    e.doc = 'docs/architecture/tenant-context.md';
    e.headings = [
      '## 1. HTTP requests',
      '## 2. Before a tenant exists',
      '## 3. Background work',
      '## 4. Realtime',
    ];
    e.basis =
      'a documentation control: docs/architecture/tenant-context.md maps how the tenant identity is resolved and carried (HTTP, pre-tenant lookups, jobs, outbox, realtime, caches, operators); the check is that it exists and covers those paths, not that the code obeys it (the other controls test that)';
  }
  if (n === 17) {
    e.evidence = 'static:sqlraw';
    e.basis =
      'three parts: raw SQL under a tenant transaction is covered by RLS (generated probe); raw SQL under privileged() is on the reviewed allowlist (ratchet); every file with an interpolating sql.raw() was read and is listed in policy/sql-raw-interpolation.json (a new one fails)';
  }
  if (n === 21) {
    e.status = 'NOT_APPLICABLE';
    e.basis =
      'MongoDB aggregation pipeline stage ordering: the platform is PostgreSQL; the equivalent (aggregates under RLS) is covered by MT-015 and the generated read scenarios';
  }
  if (n === 24) {
    e.status = 'NOT_APPLICABLE';
    e.basis =
      'shared database: there are no per-tenant databases or connections (tenant = org_id + RLS in one database)';
  }
  if (n === 1 || n === 2) {
    e.evidence = 'static:classification';
    e.basis =
      'catalog inventory: every table classified and every tenant table has forced RLS + a policy';
  }
  if (n === 8 || n === 10 || n === 50 || n === 98) {
    e.evidence = 'static:privileged';
    e.basis =
      'every privileged() call-site file is on the reviewed allowlist (a new site fails); 60 files are baseline-unreviewed (TI-002)';
  }
  out[id] = e;
});
fs.writeFileSync(path.join(__dirname, 'controls.json'), JSON.stringify(out, null, 1));
console.log('controls.json written');
