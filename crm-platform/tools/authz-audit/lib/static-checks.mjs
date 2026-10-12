// Static authorization checks. Each returns { id, controls, title, status, severity, summary, evidence[] }.
// status: pass | fail | needs-decision | info. A check that cannot find the code it expects reports `error`, never `pass`.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { REPO, SRC } from './routes.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const rel = (p) => relative(REPO, p).split(sep).join('/');

function walk(dir, test, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.next') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, test, out);
    else if (test(p)) out.push(p);
  }
  return out;
}

const grepLines = (file, re) =>
  read(file)
    .split('\n')
    .flatMap((line, i) =>
      re.test(line) ? [`${rel(file)}:${i + 1}: ${line.trim().slice(0, 160)}`] : [],
    );

const res = (o) => ({ evidence: [], ...o });

/** AUTHZ-003/010: how deny-by-default is enforced. */
function denyByDefault(routes) {
  const guard = join(SRC, 'modules/auth/guards/permissions.guard.ts');
  if (!existsSync(guard))
    return res({
      id: 'deny-by-default',
      controls: ['AUTHZ-003'],
      title: 'Deny by default',
      status: 'error',
      severity: 'high',
      summary: 'permissions.guard.ts not found',
    });
  const passThrough = grepLines(guard, /if \(!required \|\| required\.length === 0\) return true/);
  const spec = existsSync(
    join(REPO, 'apps/api/test/unit/roles-permissions/route-permission-coverage.spec.ts'),
  );
  const open = routes.filter((r) => r.gate === 'authenticated-only');
  return res({
    id: 'deny-by-default',
    controls: ['AUTHZ-003', 'AUTHZ-010'],
    title: 'A route without a permission declaration is denied by default',
    status: passThrough.length ? 'needs-decision' : 'pass',
    severity: 'medium',
    summary: passThrough.length
      ? `PermissionsGuard lets any authenticated route without @RequirePermission through (${open.length} routes today); the only net is the unit-test allow-list ${spec ? 'route-permission-coverage.spec.ts' : '(missing!)'} and tools/authz-audit/policy/self-service.json. Consider an explicit @SelfService()/@NoPermission(reason) decorator and failing closed in the guard.`
      : 'guard denies undeclared routes',
    evidence: passThrough,
  });
}

/** AUTHZ-010 / 066: every authenticated-only route is declared with a reason. */
function declaredPolicies(routes, policy) {
  const declared = new Set(Object.keys(policy.selfService ?? {}));
  const undeclared = routes.filter(
    (r) =>
      r.gate === 'authenticated-only' &&
      !declared.has(r.id) &&
      !declared.has(r.file) &&
      !declared.has(`${r.file}#${r.handler}`),
  );
  return res({
    id: 'policy-declared',
    controls: ['AUTHZ-001', 'AUTHZ-010', 'AUTHZ-066'],
    title: 'Every authenticated-only route has a documented policy',
    status: undeclared.length ? 'fail' : 'pass',
    severity: 'high',
    summary: undeclared.length
      ? `${undeclared.length} authenticated-only routes have no entry in tools/authz-audit/policy/self-service.json`
      : 'all authenticated-only routes are declared',
    evidence: undeclared.map((r) => `${r.id} (${r.file}#${r.handler})`),
  });
}

/** AUTHZ-008/021: coarse operator routes. */
function operatorGranularity(routes, decisions) {
  const coarse = routes.filter((r) => r.gate === 'operator-or-partner-coarse');
  const d = decisions['operator-routes-coarse'];
  return res({
    id: 'operator-granularity',
    controls: ['AUTHZ-008', 'AUTHZ-021', 'AUTHZ-025'],
    title: 'Platform operator routes are authorised per action, not only per actor kind',
    status:
      coarse.length === 0 ? 'pass' : d?.decision === 'accepted' ? 'accepted' : 'needs-decision',
    severity: 'medium',
    summary: `${coarse.length} operator/partner routes are reachable by any operator regardless of platform role (OperatorGuard only). Only ${routes.filter((r) => r.gate === 'operator-permission').length} use PlatformPermissionGuard. Decide which need a platform permission key.`,
    evidence: coarse.slice(0, 40).map((r) => `${r.id} (${r.file}#${r.handler})`),
  });
}

/** Lines of every match of `re` plus the following `after` lines, for checks that need the surrounding call. */
function windows(files, re, after) {
  const out = [];
  for (const f of files) {
    const lines = read(f).split('\n');
    lines.forEach((line, i) => {
      if (re.test(line))
        out.push({ at: `${rel(f)}:${i + 1}`, text: lines.slice(i, i + 1 + after).join('\n') });
    });
  }
  return out;
}

const firstLine = (w) => w.text.split('\n')[0].trim().slice(0, 140);

/** AUTHZ-041/042/045/046: privileged fields accepted in request schemas. */
function massAssignment() {
  const dir = join(REPO, 'packages/contracts/src');
  if (!existsSync(dir))
    return res({
      id: 'mass-assignment',
      controls: ['AUTHZ-041'],
      title: 'Mass assignment',
      status: 'error',
      severity: 'high',
      summary: 'packages/contracts/src not found',
    });
  const files = walk(dir, (p) => p.endsWith('.ts') && !p.endsWith('.d.ts'));
  const re =
    /^\s*(orgId|org_id|tenantId|workspaceId|isAdmin|is_admin|isOwner|isSuperAdmin|passwordHash|roleId|roleIds|permissions?|ownerId|createdBy)\??\s*:/;
  const hits = files.flatMap((f) => grepLines(f, re));
  return res({
    id: 'mass-assignment',
    controls: ['AUTHZ-041', 'AUTHZ-042', 'AUTHZ-045', 'AUTHZ-046'],
    title: 'Contract fields naming a tenant or privilege attribute',
    status: files.length < 50 ? 'error' : hits.length ? 'needs-decision' : 'pass',
    severity: 'high',
    summary: `${files.length} contract files scanned, ${hits.length} lines name a tenant/privilege field. Each must be a legitimate input to a privileged route (role assignment, owner reassignment guarded by a permission) or be a response-only field. Request schemas must also be strict (reject unknown keys); the dynamic field-level spec sends injected fields to every create/update route.`,
    evidence: hits.slice(0, 120),
  });
}

/** AUTHZ-019/089: Redis and cache keys. */
function cacheKeys() {
  const files = walk(SRC, (p) => p.endsWith('.ts') && !p.includes('.spec.'));
  const sites = windows(
    files,
    /(this\.(redis|cache)|redis)\.(get|set|setex|hget|hset|hgetall|sadd|incr|expire)\(/,
    1,
  );
  const tenantTokens = /org|tenant|workspace|ws[:_]/i;
  const literalFirstArg = sites.filter((w) => /\(\s*[`'"]/.test(w.text.split('\n')[0]));
  const suspicious = literalFirstArg.filter((w) => !tenantTokens.test(w.text.split('\n')[0]));
  return res({
    id: 'cache-keys',
    controls: ['AUTHZ-019', 'AUTHZ-089'],
    title: 'Redis/cache keys written with a literal key and no org segment',
    status: sites.length < 20 ? 'error' : suspicious.length ? 'needs-decision' : 'info',
    severity: 'medium',
    summary: `${sites.length} cache call sites found; ${literalFirstArg.length} pass a literal/template key directly, ${suspicious.length} of those show no org/tenant token. Calls that pass a variable key are not analysed (reading cannot prove them); the dynamic cache-and-races spec checks the user-visible cache layers across tenants. Not proof of absence.`,
    evidence: suspicious.slice(0, 80).map((w) => `${w.at}: ${firstLine(w)}`),
  });
}

/** AUTHZ-018/079: queue payloads carry the tenant. */
function jobTenantContext() {
  const files = walk(SRC, (p) => p.endsWith('.ts') && !p.includes('.spec.'));
  const sites = windows(files, /(queue|Queue)\w*\.(add|addBulk)\(|\.enqueue\(|\.schedule\(/, 8);
  const noOrg = sites.filter((w) => !/org/i.test(w.text));
  return res({
    id: 'job-tenant-context',
    controls: ['AUTHZ-018', 'AUTHZ-079', 'AUTHZ-080'],
    title: 'Queue add/enqueue/schedule calls whose payload does not mention an org',
    status: sites.length < 10 ? 'error' : noOrg.length ? 'needs-decision' : 'info',
    severity: 'medium',
    summary: `${sites.length} enqueue sites; ${noOrg.length} show no org id within 8 lines (may be platform-level jobs, or the id may come from a variable). Every worker must set the tenant context from the job payload before any query and re-check authorization for user-initiated jobs; the dynamic workers spec asserts this per processor.`,
    evidence: noOrg.slice(0, 80).map((w) => `${w.at}: ${firstLine(w)}`),
  });
}

/** AUTHZ-076/077: WebSocket rooms. */
function websocketRooms() {
  const dir = join(SRC, 'realtime');
  if (!existsSync(dir))
    return res({
      id: 'ws-rooms',
      controls: ['AUTHZ-076'],
      title: 'WebSocket rooms',
      status: 'error',
      severity: 'high',
      summary: 'apps/api/src/realtime not found',
    });
  const files = walk(dir, (p) => p.endsWith('.ts') && !p.includes('.spec.'));
  const joins = files.flatMap((f) => grepLines(f, /\.(join|to)\(/));
  const authz = files.flatMap((f) =>
    grepLines(f, /authori[sz]e|canJoin|assertCan|room.*(org|tenant)/i),
  );
  return res({
    id: 'ws-rooms',
    controls: ['AUTHZ-076', 'AUTHZ-077', 'AUTHZ-078'],
    title: 'Every room join is authorised',
    status: 'info',
    severity: 'high',
    summary: `${joins.length} room join/emit sites, ${authz.length} authorisation references. Dynamic coverage lives in test/e2e/authz/realtime.e2e.spec.ts.`,
    evidence: [...joins.slice(0, 30), ...authz.slice(0, 30)],
  });
}

/** AUTHZ-060/067: API key scope model exists and is enforced. */
function apiKeyScopes() {
  const dir = join(SRC, 'modules/developer-rest-api-v1');
  const files = walk(dir, (p) => p.endsWith('.ts') && !p.includes('.spec.'));
  const scope = files.flatMap((f) => grepLines(f, /scope/i));
  const emptyMeansAll = files.flatMap((f) =>
    grepLines(f, /scopes?\.length\s*===?\s*0|!.*scopes?\.length|empty.*scope|scope.*empty/i),
  );
  return res({
    id: 'api-key-scopes',
    controls: ['AUTHZ-060', 'AUTHZ-067'],
    title: 'API key scope semantics',
    status: emptyMeansAll.length ? 'needs-decision' : 'info',
    severity: 'high',
    summary:
      'An empty scope list historically means unrestricted. A restricted key with no granted permissions must be distinguishable from an unrestricted key, and editing scopes must never broaden access. Dynamic coverage: test/e2e/authz/api-key-scopes.e2e.spec.ts.',
    evidence: emptyMeansAll.slice(0, 20).concat(scope.slice(0, 20)),
  });
}

/** AUTHZ-010 on the web side: route table for client guards is not authorisation. Info only. */
function rlsInvariant() {
  const spec = join(REPO, 'apps/api/test/integration/schema-invariants.spec.ts');
  return res({
    id: 'rls-invariants',
    controls: ['AUTHZ-011', 'AUTHZ-014', 'AUTHZ-015'],
    title: 'Forced row-level security on every tenant table (schema-invariants.spec.ts)',
    status: existsSync(spec) ? 'info' : 'error',
    severity: 'critical',
    summary: existsSync(spec)
      ? 'RLS is the tenant-isolation backstop; its invariants run in the integration suite. The audit report records the suite result when run with --full.'
      : 'schema-invariants.spec.ts missing',
    evidence: existsSync(spec) ? [rel(spec)] : [],
  });
}

export function runStaticChecks(routes, policy, decisions) {
  return [
    denyByDefault(routes),
    declaredPolicies(routes, policy),
    operatorGranularity(routes, decisions),
    massAssignment(),
    cacheKeys(),
    jobTenantContext(),
    websocketRooms(),
    apiKeyScopes(),
    rlsInvariant(),
  ];
}
