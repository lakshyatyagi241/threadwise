// Rate-limit audit library (QA sheet 3, item 33). Pure functions: they read controller source text and return facts, never touch a
// network or a database. The CLI (audit.mjs) and the live census (census.mjs) are built on them.
//
// What it answers, for every route the API serves: who can call it without signing in, what kind of abuse it invites (guessing a
// credential, flooding a public write, forging a webhook, draining a costly operation), and which limiter, if any, is declared on
// it. A declared limiter is a claim; the census proves it against a running API.

/** What a route invites, read from the WORDS of its path and handler (so "blog" is not "log-in"). The first matching class wins. */
export const CLASSES = [
  {
    id: 'credential',
    why: 'guessing a password, one-time code, reset token or invite, or making the system send a message to someone',
    words: new Set([
      'login',
      'signin',
      'signup',
      'register',
      'password',
      'forgot',
      'reset',
      'otp',
      'verify',
      'resend',
      'passcode',
      'code',
      'mfa',
      '2fa',
      'totp',
      'magic',
      'passkey',
      'webauthn',
      'invite',
      'invitations',
      'accept',
      'activate',
      'claim',
      'recover',
      'unlock',
      'refresh',
      'workspaces',
    ]),
    // a plain read of a setting that happens to share a word is not a credential route
    notWords: new Set(['policy', 'config', 'settings', 'options', 'languages', 'status']),
  },
  {
    id: 'webhook',
    why: 'a provider callback: signature checks cost CPU, and a flood hides real events',
    words: new Set([
      'webhook',
      'webhooks',
      'callback',
      'inbound',
      'ipn',
      'notify',
      'push',
      'compliance',
    ]),
  },
];

/** The lower-case words of a path and handler name: split on non-letters and on camelCase. */
export const wordsOf = (text) =>
  new Set(
    String(text)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );

/** Authenticated operations that cost money or capacity when repeated. */
export const COSTLY_RE =
  /(export|import|bulk|generate|\bai\b|send|broadcast|blast|upload|render|report|download)/i;

/** Severity of an UNLIMITED route, by class. Credential guessing is the one a release must never ship with. */
export const SEVERITY = {
  credential: 'Critical',
  'public-write': 'High',
  webhook: 'High',
  'public-read': 'Medium',
  costly: 'Medium',
  other: 'Info',
};

const VERBS = ['Get', 'Post', 'Put', 'Patch', 'Delete'];

const balance = (s) => (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length;
const unquote = (s) => (s || '').replace(/^['"`]|['"`]$/g, '');

/** `@Throttle('auth')` or `@Throttle({ limit: 5, windowSeconds: 3600, by: 'ip' })` as a plain object. */
export function parseThrottle(decorator) {
  const named = /@Throttle\(\s*['"]([\w-]+)['"]\s*\)/.exec(decorator);
  if (named) return { policy: named[1] };
  const obj = /@Throttle\(\s*\{([\s\S]*?)\}\s*\)/.exec(decorator);
  if (!obj) return { unparsed: true };
  const num = (k) => {
    const m = new RegExp(`${k}\\s*:\\s*(\\d+)`).exec(obj[1]);
    return m ? Number(m[1]) : undefined;
  };
  const by = /by\s*:\s*['"](\w[\w-]*)['"]/.exec(obj[1]);
  return {
    limit: num('limit'),
    windowSeconds: num('windowSeconds'),
    by: by ? by[1] : 'actor-or-ip',
  };
}

/** The named policies of rate-limit.policies.ts, read from its source so a changed number is picked up. */
export function parsePolicies(src) {
  const out = {};
  const block = /RATE_POLICIES\s*=\s*\{([\s\S]*?)\}\s*as const/.exec(src);
  if (!block) return out;
  for (const m of block[1].matchAll(
    /['"]?([\w-]+)['"]?\s*:\s*\{\s*limit:\s*(\d+),\s*windowSeconds:\s*(\d+),\s*by:\s*['"]([\w-]+)['"]/g,
  )) {
    out[m[1]] = { limit: Number(m[2]), windowSeconds: Number(m[3]), by: m[4] };
  }
  return out;
}

/** The base path and version a controller decorator declares. */
function controllerPath(decorator) {
  const obj = /@(?:V1)?Controller\(\s*\{([\s\S]*?)\}\s*\)/.exec(decorator);
  if (obj) {
    const p = /path\s*:\s*(\[[^\]]*\]|['"`][^'"`]*['"`])/.exec(obj[1]);
    const v = /version\s*:\s*(?:\[\s*)?['"`]([\w.]+)['"`]/.exec(obj[1]);
    const first = p
      ? unquote(
          p[1]
            .replace(/^\[\s*/, '')
            .split(',')[0]
            .trim(),
        )
      : '';
    return { path: first, version: v ? v[1] : null };
  }
  const str = /@(?:V1)?Controller\(\s*(['"`][^'"`]*['"`])?\s*\)/.exec(decorator);
  return { path: str && str[1] ? unquote(str[1]) : '', version: null };
}

const join = (...parts) =>
  '/' +
  parts
    .flatMap((p) => String(p ?? '').split('/'))
    .filter(Boolean)
    .join('/');

/** What a route invites. `public` is "no sign-in": the @Public decorator, or a V1 (API key) controller. */
export function classify({ method, path, handler, public: isPublic }) {
  const subject = `${path} ${handler}`;
  const words = wordsOf(subject);
  if (isPublic) {
    for (const c of CLASSES) {
      if (c.notWords && method === 'GET' && [...c.notWords].some((w) => words.has(w))) continue;
      if ([...c.words].some((w) => words.has(w))) return c.id;
    }
    return method === 'GET' || method === 'HEAD' ? 'public-read' : 'public-write';
  }
  if (method !== 'GET' && COSTLY_RE.test(subject)) return 'costly';
  return 'other';
}

/**
 * Routes of one controller file. `Public` and `Throttle` can sit on the class or the handler; a handler's own limit wins.
 * @returns {Array<{method,path,handler,public,limiter,throttle,skip,permission,file,class}>}
 */
export function scanController(src, file = '') {
  const routes = [];
  // one region per @Controller / @V1Controller: from its decorator block to the next one
  const starts = [...src.matchAll(/^@(?:V1)?Controller\(/gm)].map((m) => m.index);
  if (!starts.length) return routes;
  starts.forEach((start, i) => {
    // the class decorators sit just above `export class`; walk back over decorator lines from the @Controller start
    let head0 = start;
    const before = src.slice(0, start).split('\n');
    for (let k = before.length - 1; k >= 0; k--) {
      const t = before[k].trim();
      if (
        t.startsWith('@') ||
        t === '' ||
        t.startsWith('//') ||
        t.startsWith('*') ||
        t.startsWith('/*') ||
        t.endsWith('*/')
      ) {
        head0 -= before[k].length + 1;
        if (t === '' && k < before.length - 1) break;
      } else break;
    }
    const end = i + 1 < starts.length ? starts[i + 1] : src.length;
    const region = src.slice(Math.max(0, head0), end);
    const classLine = /export\s+(?:abstract\s+)?class\s+(\w+)/.exec(region);
    if (!classLine) return;
    const head = region.slice(0, classLine.index);
    const body = region.slice(classLine.index + classLine[0].length);
    const ctrl = controllerPath(head);
    const v1 = /@V1Controller\(/.test(head);
    const classPublic = /@Public\(\)/.test(head) || v1;
    const classThrottle = /@Throttle\(/.test(head)
      ? parseThrottle(head.slice(head.indexOf('@Throttle(')))
      : null;
    const classSkip = /@SkipThrottle\(\)/.test(head) || v1;

    let pending = [];
    let open = '';
    const lines = body.split('\n');
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const t = line.trim();
      if (open) {
        open += ' ' + t;
        if (balance(open) <= 0) {
          pending.push(open);
          open = '';
        }
        continue;
      }
      if (t.startsWith('@')) {
        if (balance(t) > 0) open = t;
        else pending.push(t);
        continue;
      }
      if (pending.length && /^((public|private|protected|async|static)\s+)*\w+\s*[(<]/.test(t)) {
        const verb = pending.find((p) => new RegExp(`^@(${VERBS.join('|')})\\(`).test(p));
        if (verb) {
          const m = new RegExp(`^@(${VERBS.join('|')})\\(\\s*([\\s\\S]*?)\\)$`).exec(verb);
          const sub =
            m && m[2]
              ? unquote(
                  m[2]
                    .replace(/^\[\s*/, '')
                    .split(',')[0]
                    .trim(),
                )
              : '';
          const method = m[1].toUpperCase();
          const handler =
            /(\w+)\s*[(<]/.exec(
              t.replace(/^((public|private|protected|async|static)\s+)*/, ''),
            )?.[1] ?? '';
          const prefix = v1 ? '/api/v1' : ctrl.version ? `/v${ctrl.version}` : '';
          const full = join(prefix, v1 ? '' : ctrl.path, v1 ? ctrl.path : '', sub);
          const own = pending.find((p) => p.startsWith('@Throttle('));
          const ownSkip = pending.some((p) => p.startsWith('@SkipThrottle('));
          const throttle = own ? parseThrottle(own) : classThrottle;
          const skip = ownSkip || (!own && classSkip);
          // the body schema sits in the parameter list, which can run over several lines
          let sig = t;
          for (
            let k = li + 1, depth = balance(t);
            depth > 0 && k < lines.length && k < li + 40;
            k++
          ) {
            sig += ' ' + lines[k].trim();
            depth += balance(lines[k]);
          }
          const bodySchema = /@Body\(\s*(?:\w*[pP]ipe\()?\s*(\w+Schema)\b/.exec(sig)?.[1] ?? null;
          routes.push({
            bodySchema,
            method,
            path: full,
            handler,
            class: classLine[1],
            file,
            public: pending.some((p) => p.startsWith('@Public(')) || classPublic,
            limiter: throttle ? 'throttle' : skip ? 'skipped' : 'none',
            throttle: throttle ?? null,
            skip,
            v1,
            permission: pending.some((p) => p.startsWith('@RequirePermission(')),
          });
        }
        pending = [];
      } else if (t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')) {
        pending = [];
      }
    }
  });
  return routes;
}

/** Adds the class, the severity if unlimited, and the effective limit (a named policy resolved to numbers). */
export function enrich(route, policies = {}) {
  const cls = classify(route);
  let effective = null;
  if (route.throttle && route.throttle.policy) effective = policies[route.throttle.policy] ?? null;
  else if (route.throttle && route.throttle.limit) effective = route.throttle;
  return {
    ...route,
    key: `${route.method} ${route.path}`,
    cls,
    severityIfUnlimited: SEVERITY[cls],
    effective,
  };
}
