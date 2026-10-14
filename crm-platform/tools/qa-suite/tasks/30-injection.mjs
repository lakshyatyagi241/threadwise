// #30 Injection testing: static review of every place SQL or a command is built from strings, plus live payload attacks on query strings and JSON bodies.
import {
  ROOT,
  apiSrc,
  env,
  expectNone,
  fail,
  http,
  login,
  pass,
  read,
  rel,
  requireLocal,
  skip,
  unreviewed,
  warn,
} from '../lib/core.mjs';
import { lineAt, maskCode, matchClose } from '../lib/code.mjs';
import { routes } from '../lib/routes.mjs';

export const SQLI = [
  `' OR '1'='1`,
  `' OR 1=1--`,
  `"; DROP TABLE contacts;--`,
  `1; SELECT pg_sleep(4)--`,
  `' UNION SELECT NULL,NULL,NULL--`,
  `'||(SELECT pg_sleep(4))||'`,
  `1) OR (1=1`,
  `\\' OR \\'1`,
  `%27%20OR%20%271%27=%271`,
  `' AND (SELECT 1 FROM pg_sleep(4))--`,
  `$$ ; select 1 $$`,
  `1' ORDER BY 99--`,
  "'; SELECT current_setting('app.org_id');--",
  `\u0000`,
  `' OR org_id IS NOT NULL --`,
];
export const OTHER = [
  `{"$ne":null}`,
  `{"$gt":""}`,
  `; id`,
  `| cat /etc/passwd`,
  `$(sleep 4)`,
  '`sleep 4`',
  `../../../../etc/passwd`,
  `..%2f..%2f..%2fetc%2fpasswd`,
  `*)(uid=*))(|(uid=*`,
  `{{7*7}}`,
  `\${7*7}`,
  `<%= 7*7 %>`,
  `%0d%0aSet-Cookie:%20x=1`,
  `\r\nX-Injected: 1`,
  `file:///etc/passwd`,
];
const LEAK =
  /(syntax error at|SQLSTATE|pg_catalog|unterminated quoted|relation ".*" does not exist|column ".*" does not exist|invalid input syntax|at .*\.(ts|js):\d+|node_modules|stack trace|ECONNREFUSED|drizzle)/i;
const PARAMS = [
  'q',
  'search',
  'sort',
  'order',
  'cursor',
  'status',
  'name',
  'email',
  'filter',
  'tagId',
  'ownerId',
  'expand',
  'from',
  'to',
];

/** 'safe': literal, or every ${} is a module constant / number-ish; 'request': an interpolation reads request-shaped data; 'review': dynamic, needs a human. */
const REQ =
  /\b(req|request|body|query|params|dto|input|payload|filters?|search|searchTerm|q|sort|order|orderBy|dir|direction|column|field)\b/;
export function classify(arg, consts) {
  if (/^(['"])[^$]*\1$/.test(arg) || /^`[^$`]*`$/.test(arg)) return 'safe';
  if (/^[A-Za-z_$][\w$]*$/.test(arg)) return consts.has(arg) ? 'safe' : 'review';
  const exprs = [...arg.matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1].trim());
  if (!exprs.length) return 'review';
  if (exprs.some((e) => REQ.test(e))) return 'request';
  if (exprs.every((e) => consts.has(e.split(/[.(\[]/)[0]) || /^\d+$/.test(e))) return 'safe';
  return 'review';
}

export default {
  id: 30,
  priority: 'P1',
  name: 'Injection testing',
  owner: 'Punya',
  target: 'Automated on PR/daily/pre-release as applicable; zero Critical/High release blockers',
  async run() {
    const checks = [];
    // ---- static: how is raw SQL built?
    const rawBad = [],
      rawReview = [],
      concat = [],
      concatBad = [],
      cmd = [];
    let rawCount = 0;
    for (const f of apiSrc()) {
      const raw = read(f);
      if (!/sql\.raw|\.unsafe\(|\.query\(|exec|spawn/.test(raw)) continue;
      const m = maskCode(raw);
      const consts = new Set(
        [
          ...raw.matchAll(
            /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:['"`\[{]|Object\.freeze|\w+\s+as\s+const)/gm,
          ),
        ].map((x) => x[1]),
      );
      for (const mt of m.matchAll(/sql\.raw\s*\(/g)) {
        rawCount++;
        const open = mt.index + mt[0].length - 1,
          close = matchClose(m, open);
        if (close < 0) continue;
        const arg = raw.slice(open + 1, close).trim();
        const where = `${rel(f)}:${lineAt(raw, mt.index)}  sql.raw(${arg.replace(/\s+/g, ' ').slice(0, 70)})`;
        const verdict = classify(arg, consts);
        if (verdict === 'request') rawBad.push(where);
        else if (verdict === 'review') rawReview.push(where);
      }
      for (const mt of m.matchAll(/\.(query|execute)\s*\(\s*`/g)) {
        const close = matchClose(m, m.indexOf('(', mt.index));
        if (close < 0) continue;
        const body = raw.slice(mt.index, close);
        if (/sql`/.test(body)) continue;
        const verdict = classify(body.slice(body.indexOf('`')), consts);
        const where = `${rel(f)}:${lineAt(raw, mt.index)}  ${body.replace(/\s+/g, ' ').slice(0, 90)}`;
        if (verdict === 'request') concatBad.push(where);
        else if (verdict === 'review') concat.push(where);
      }
      for (const mt of m.matchAll(
        /(?<![.\w])(exec|execSync)\s*\(\s*`|(?<![.\w])(spawn|execFile)\s*\([^)]*shell:\s*true/g,
      ))
        cmd.push(`${rel(f)}:${lineAt(raw, mt.index)}`);
    }
    checks.push(
      expectNone(
        'inj-raw-request',
        'sql.raw is never given request-shaped data (search, sort, order, column, filter...) unless reviewed',
        unreviewed(30, rawBad),
        { severity: 'critical' },
      ),
    );
    checks.push(
      expectNone(
        'inj-raw-review',
        `sql.raw arguments that are neither a literal nor a module constant (${rawCount} sql.raw calls in total)`,
        unreviewed(30, rawReview),
        { level: 'warn' },
      ),
    );
    checks.push(
      expectNone(
        'inj-concat-request',
        'No query() / execute() template interpolates request-shaped data (search, sort, order, column, filter...)',
        unreviewed(30, concatBad),
        { severity: 'critical' },
      ),
    );
    checks.push(
      expectNone(
        'inj-concat',
        'query() / execute() templates with ${} (outside the sql`` tag) that are not module constants',
        unreviewed(30, concat),
        { level: 'warn' },
      ),
    );
    checks.push(
      expectNone('inj-cmd', 'No shell command built from a template string', cmd, {
        severity: 'high',
      }),
    );

    // ---- live
    const bad = requireLocal(env.api);
    let scenarios = 0;
    if (bad)
      checks.push(
        skip('inj-live', 'Live payload attacks (query strings, JSON bodies, headers)', bad),
      );
    else {
      const s = await login();
      const token = s.token;
      const gets = process.env.QA_INJECTION_ROUTES
        ? process.env.QA_INJECTION_ROUTES.split(',')
        : routes()
            .filter((r) => r.method === 'GET' && !r.dynamic)
            .map((r) => r.url);
      const list = [...new Set(gets)].slice(0, Number(process.env.QA_INJECTION_MAX ?? 60));
      const base = {};
      const problems = [],
        slow = [];
      for (const url of list) {
        const t0 = await http('GET', url, { token });
        base[url] = t0.ms;
        if (t0.status === 404) continue;
        for (const p of PARAMS.slice(0, 6))
          for (const pay of [...SQLI, ...OTHER]) {
            scenarios++;
            const r = await http('GET', `${url}?${p}=${encodeURIComponent(pay)}`, {
              token,
              timeout: 12000,
            });
            if (r.status >= 500 || r.status === 0)
              problems.push(`${r.status} GET ${url}?${p}=${pay.slice(0, 30)}`);
            else if (LEAK.test(r.text))
              problems.push(`error detail leaked: GET ${url}?${p}=${pay.slice(0, 30)}`);
            else if (/sleep|pg_sleep/.test(pay) && r.ms > base[url] + 3000)
              slow.push(
                `${Math.round(r.ms)}ms GET ${url}?${p}=${pay.slice(0, 30)} (baseline ${Math.round(base[url])}ms): the payload was executed`,
              );
          }
      }
      // JSON bodies on the public login and signup-style routes, and on any POST that accepts a body
      for (const url of ['/v2/auth/login', '/v2/auth/forgot-password', '/v2/auth/signup'])
        for (const pay of [...SQLI, ...OTHER]) {
          scenarios++;
          const r = await http('POST', url, {
            body: { email: pay, password: pay, orgSlug: pay, name: pay },
          });
          if (r.status >= 500 || LEAK.test(r.text))
            problems.push(`${r.status} POST ${url} email=${pay.slice(0, 30)}`);
          if (/sleep/.test(pay) && r.ms > 3500)
            slow.push(`${Math.round(r.ms)}ms POST ${url} (${pay.slice(0, 30)})`);
        }
      for (const pay of [...SQLI, ...OTHER].slice(0, 12)) {
        // header injection
        scenarios++;
        const r = await http('GET', '/v2/auth/session', {
          token,
          headers: {
            'x-request-id': pay,
            'user-agent': pay,
            'x-forwarded-for': pay,
            'accept-language': pay,
          },
        });
        if (r.status >= 500 || r.status === 0)
          problems.push(`${r.status} header payload ${pay.slice(0, 30)}`);
      }
      const same = await http('GET', '/v2/auth/session', { token });
      checks.push(
        expectNone(
          'inj-live-5xx',
          `No payload produced a 5xx, a database error or a stack trace (${scenarios} requests, ${list.length} GET routes)`,
          problems,
          { severity: 'high' },
        ),
      );
      checks.push(
        expectNone(
          'inj-live-time',
          'No time-based payload (pg_sleep, sleep) delayed a response',
          slow,
          { severity: 'critical' },
        ),
      );
      checks.push(
        same.status === 200
          ? pass('inj-live-alive', 'The API still serves normal requests afterwards')
          : fail(
              'inj-live-alive',
              'The API still serves normal requests afterwards',
              `HTTP ${same.status}`,
            ),
      );
    }
    return {
      checks,
      metrics: { 'sql.raw calls': rawCount, 'live requests': scenarios },
      target: {
        met:
          [rawBad, concatBad, cmd].every((x) => x.length === 0) && !bad
            ? true
            : [rawBad, concatBad, cmd].some((x) => x.length)
              ? false
              : null,
        text: 'Static: no request data in raw SQL/commands. Live attacks run only with API_URL (localhost) and QA_EMAIL/QA_PASSWORD.',
      },
    };
  },
};
