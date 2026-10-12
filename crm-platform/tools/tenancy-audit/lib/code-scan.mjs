// Static tenant-scoping scans over apps/api/src. Heuristics, not proof: each result is either a finding, an allowlisted
// (reviewed) exception, or a new unreviewed site that fails the audit until someone reads it and records a reason.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (e === 'node_modules' || e === 'dist') continue;
      walk(p, out);
    } else if (p.endsWith('.ts') && !/\.(spec|test|d)\.ts$/.test(p)) out.push(p);
  }
  return out;
};

const rel = (root, p) => relative(root, p).split(sep).join('/');

/** MT-008/098: every place that lifts RLS. The allowlist is the reviewed set; a new file is a failure until reviewed. */
export function scanPrivileged(srcRoot, allow) {
  const sites = [];
  for (const f of walk(srcRoot)) {
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    lines.forEach((l, i) => {
      if (/\.privileged\(|withPrivileged\(/.test(l) && !/^\s*(\/\/|\*)/.test(l)) {
        sites.push({ file: rel(srcRoot, f), line: i + 1 });
      }
    });
  }
  const files = [...new Set(sites.map((s) => s.file))].sort();
  const byFile = files.map((file) => ({
    file,
    sites: sites.filter((s) => s.file === file).length,
    reviewed: allow[file] ?? null,
  }));
  return {
    totalSites: sites.length,
    files: byFile,
    unreviewed: byFile.filter((b) => !b.reviewed).map((b) => b.file),
    stale: Object.keys(allow).filter((k) => !files.includes(k)),
  };
}

/** MT-047/048: a BullMQ processor must establish a tenant context from the job (or be declared tenant-free). */
export function scanProcessors(srcRoot, allow) {
  const out = [];
  for (const f of walk(srcRoot)) {
    const src = readFileSync(f, 'utf8');
    if (!/@Processor\(|extends WorkerHost|new Worker\(/.test(src)) continue;
    const file = rel(srcRoot, f);
    const establishes =
      /withTenant\(|\.txAs\(|\.tenant\(|runInTenant|RequestContextStore\.run\(|\.privileged\(|inTenant\(/.test(
        src,
      );
    out.push({ file, establishesTenantContext: establishes, declared: allow[file] ?? null });
  }
  return {
    processors: out,
    unproven: out.filter((p) => !p.establishesTenantContext && !p.declared).map((p) => p.file),
  };
}

const KEY_CALL =
  /redis\.(get|set|del|incr|expire|hget|hset|hgetall|lpush|rpush|publish|setnx|exists|ttl|decr|incrby)\(\s*([^,)]+)/g;
const TENANT_TOKEN = /org(Id|_id)?|tenant|workspace|ctx\.org|channel\.orgId/i;

/** MT-036..043: Redis keys built from a template. A key with no org token is listed for review, never assumed safe. */
export function scanRedisKeys(srcRoot, allow) {
  const hits = [];
  for (const f of walk(srcRoot)) {
    const file = rel(srcRoot, f);
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    lines.forEach((l, i) => {
      for (const m of l.matchAll(KEY_CALL)) {
        const arg = m[2].trim();
        // resolve a variable to its definition within 40 lines above
        let def = arg;
        if (/^[A-Za-z_][\w.]*$/.test(arg)) {
          for (let j = i; j >= Math.max(0, i - 40); j--) {
            const d = lines[j].match(
              new RegExp(`(?:const|let)\\s+${arg.replace('.', '\\.')}\\s*=\\s*(.+)`),
            );
            if (d) {
              def = d[1];
              break;
            }
          }
        }
        hits.push({
          file,
          line: i + 1,
          op: m[1],
          expr: def.slice(0, 140),
          hasTenantToken: TENANT_TOKEN.test(def) || TENANT_TOKEN.test(arg),
        });
      }
    });
  }
  const noToken = hits.filter((h) => !h.hasTenantToken);
  const keyOf = (h) => `${h.file}`;
  return {
    calls: hits.length,
    withoutTenantToken: noToken,
    unreviewed: [...new Set(noToken.filter((h) => !allow[keyOf(h)]).map(keyOf))].sort(),
  };
}

// A `sql.raw(` call whose template literal interpolates something (the template has to be open at a `${`).
const RAW_WITH_INTERPOLATION = /sql\.raw\(\s*`(?:[^`\\]|\\.)*?\$\{/g;

/**
 * MT-017: `sql.raw(...)` writes its argument into the statement unescaped. A call whose template interpolates something is the only
 * shape that can carry attacker-influenced text, so each FILE that has one must be read and listed with why the interpolated value
 * is a constant, a typed enum or an integer-coerced number. A new file with one fails the audit until it is.
 */
export function scanSqlRawInterpolation(srcRoot, allow) {
  const hits = [];
  for (const f of walk(srcRoot)) {
    const matches = readFileSync(f, 'utf8').match(RAW_WITH_INTERPOLATION);
    if (!matches) continue;
    const file = rel(srcRoot, f);
    hits.push({ file, calls: matches.length, reviewed: allow[file] ?? null });
  }
  return {
    files: hits,
    unreviewed: hits.filter((h) => !h.reviewed).map((h) => h.file),
    stale: Object.keys(allow).filter((k) => !hits.some((h) => h.file === k)),
  };
}
