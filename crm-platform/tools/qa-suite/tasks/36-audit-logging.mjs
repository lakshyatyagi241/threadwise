// #36 Audit logging: every mutating module audits, audit rows cannot be altered or deleted, and carry no secrets.
import {
  ROOT,
  apiSrc,
  exists,
  expectNone,
  fail,
  migrations,
  pass,
  read,
  rel,
  unreviewed,
  walk,
  warn,
} from '../lib/core.mjs';
import { lineAt, maskCode, matchClose } from '../lib/code.mjs';
import { buildSchema } from '../lib/schema.mjs';
import { join } from 'node:path';

const MODULES = join(ROOT, 'apps/api/src/modules');
// Modules whose writes are not user actions: inbound provider webhooks, the platform's own housekeeping. Listed so the exception is visible.
const NOT_USER_ACTIONS = /^(health|metrics|webhooks?-inbound|public-.*)$/;

export default {
  id: 36,
  priority: 'P1',
  name: 'Audit logging',
  owner: 'Punya',
  target: 'Automated on PR/daily/pre-release as applicable; zero Critical/High release blockers',
  async run() {
    const mod = new Map(); // name -> { mutating routes, audit calls, files }
    for (const f of apiSrc().filter((p) => p.startsWith(MODULES))) {
      const name = f.slice(MODULES.length + 1).split('/')[0];
      const m = mod.get(name) ?? { routes: 0, audits: 0, controllers: [] };
      mod.set(name, m);
      const raw = read(f);
      if (/\.controller\.ts$/.test(f)) {
        const n = [...raw.matchAll(/@(Post|Put|Patch|Delete)\(([\s\S]{0,260})/g)].filter(
          (x) =>
            !/RequirePermission\('[^']*\.read'\)/.test(
              x[2].split(/@(Post|Put|Patch|Delete|Get)\(/)[0],
            ),
        ).length;
        m.routes += n;
        if (n) m.controllers.push(rel(f));
      }
      m.audits += (
        raw.match(/\baudit\.record\(|\bauditLog\.|AuditService|\baudit\.write\(/g) ?? []
      ).length;
    }
    const unaudited = [...mod]
      .filter(([n, m]) => m.routes > 0 && m.audits === 0 && !NOT_USER_ACTIONS.test(n))
      .map(([n, m]) => `${n}: ${m.routes} mutating route(s), 0 audit calls  (${m.controllers[0]})`);

    // audit calls must not put secrets into the delta
    const secrets = [];
    let calls = 0;
    for (const f of apiSrc()) {
      const raw = read(f);
      if (!raw.includes('audit.record')) continue;
      const m = maskCode(raw);
      for (const mt of m.matchAll(/audit\.record\s*\(/g)) {
        calls++;
        const open = mt.index + mt[0].length - 1,
          close = matchClose(m, open);
        if (close < 0) continue;
        const body = m.slice(open, close);
        const hit = body.match(
          /\b(password|passwd|secret|apiKey|api_key|accessToken|refreshToken|token|otp|cvv|cardNumber)\b\s*(?::\s*[A-Za-z_$][\w$.]*\s*[,}\n]|[,}])/i,
        );
        if (hit)
          secrets.push(
            `${rel(f)}:${lineAt(raw, open + hit.index)}  audit.record(... ${hit[1]} ...)`,
          );
      }
    }

    // the audit table itself
    const sql = migrations()
      .map((f) => read(f))
      .join('\n');
    const appendOnly =
      /CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+\w+\s+BEFORE\s+(?:UPDATE|DELETE)[^;]*?\bON\s+audit_log(?![\w])|REVOKE\s+[^;]*\b(?:UPDATE|DELETE)\b[^;]*\bON\s+(?:TABLE\s+)?audit_log(?![\w])/i.test(
        sql,
      );
    const al = buildSchema().get('audit_log');
    const need = ['actor_id', 'at', 'module', 'record_id', 'action', 'request_id'];
    const missingCols = al ? need.filter((c) => !al.columns.has(c)) : need;
    const e2e = exists('apps/api/test/e2e/audit-log');
    const checks = [
      expectNone(
        'aud-module-coverage',
        'Every module with mutating routes writes audit rows',
        unreviewed(36, unaudited),
        { severity: 'high' },
      ),
      expectNone(
        'aud-no-secrets',
        'No password/token/secret value is placed in an audit delta',
        secrets,
        { severity: 'critical' },
      ),
      appendOnly
        ? pass(
            'aud-append-only',
            'audit_log rows cannot be UPDATEd or DELETEd by the application role',
          )
        : fail(
            'aud-append-only',
            'audit_log rows cannot be UPDATEd or DELETEd by the application role',
            'No trigger or REVOKE found. crm_app has UPDATE and DELETE on audit_log (0007 grants them), so a bug or a stolen session can rewrite history. Other ledgers (wallet, payments) are append-only by trigger; audit_log is not.',
            [],
            'high',
          ),
      missingCols.length
        ? fail(
            'aud-columns',
            'audit_log records who, what, which record, when, request id',
            `missing: ${missingCols}`,
          )
        : pass('aud-columns', 'audit_log records who, what, which record, when, request id'),
      e2e
        ? pass(
            'aud-e2e',
            'An end-to-end suite for the audit log exists (apps/api/test/e2e/audit-log)',
          )
        : warn('aud-e2e', 'An end-to-end suite for the audit log exists'),
    ];
    const routes = [...mod.values()].reduce((a, m) => a + m.routes, 0);
    return {
      checks,
      metrics: {
        modules: mod.size,
        'mutating routes': routes,
        'audit.record calls': calls,
        'modules without audit': unaudited.length,
      },
      target: {
        met: checks.every((c) => c.status !== 'fail'),
        text: 'Zero Critical/High findings from the static checks above. Behaviour (a row appears after a real mutation) is covered by apps/api/test/e2e/audit-log (Docker).',
      },
    };
  },
};
