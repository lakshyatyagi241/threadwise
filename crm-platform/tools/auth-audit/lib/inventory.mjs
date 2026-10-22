// Inventories built from the source tree: HTTP routes (AUTH-001) and existing tests (traceability, AUTH-099).
// Both are plain line scanners, not a TypeScript parser: they are conservative and say so in the report.

import { read, rel, walk } from './util.mjs';

// ---------------------------------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------------------------------

const HTTP_DECORATORS = new Set([
  'Get',
  'Post',
  'Put',
  'Patch',
  'Delete',
  'All',
  'Head',
  'Options',
  'Sse',
]);

function controllerBase(decoratorText) {
  // @Controller('x') | @Controller({ path: 'x', version: '2' }) | @Controller()
  const obj = /@Controller\(\s*\{([\s\S]*?)\}\s*\)/.exec(decoratorText);
  let path = '';
  let version = null;
  if (obj) {
    path = /path:\s*['"`]([^'"`]*)['"`]/.exec(obj[1])?.[1] ?? '';
    version = /version:\s*['"`]([^'"`]*)['"`]/.exec(obj[1])?.[1] ?? null;
    // VERSION_NEUTRAL: the route has no version prefix (the widget embed, its legacy alias).
    if (/version:\s*VERSION_NEUTRAL\b/.test(obj[1])) version = '';
  } else {
    path = /@Controller\(\s*['"`]([^'"`]*)['"`]/.exec(decoratorText)?.[1] ?? '';
  }
  return { path, version };
}

const joinPath = (...parts) =>
  '/' +
  parts
    .map((p) => String(p ?? '').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');

/** NestJS default version in main.ts (`defaultVersion: '2'`); read from the source so the inventory follows it. */
function defaultVersion() {
  return /defaultVersion:\s*['"`](\w+)['"`]/.exec(read('apps/api/src/main.ts') ?? '')?.[1] ?? null;
}

export function scanRoutes() {
  const files = walk(
    'apps/api/src',
    (f) => f.endsWith('.controller.ts') && !f.endsWith('.spec.ts'),
  );
  const dv = defaultVersion();
  const routes = [];
  for (const file of files) {
    const text = read(file);
    if (!text) continue;
    const ls = text.split(/\r?\n/);

    // A file can hold several exported classes (a filter, then its controller). Each class reads the decorators between the
    // end of the previous class and its own `export class` line, and its methods up to its own closing brace.
    const classStarts = ls.flatMap((l, i) =>
      /^export\s+(abstract\s+)?class\s/.test(l) ? [i] : [],
    );
    let headStart = 0;
    for (const classIdx of classStarts) {
      const bodyClose = ls.findIndex((l, i) => i > classIdx && /^}/.test(l));
      const bodyEnd = bodyClose === -1 ? ls.length : bodyClose;
      const classHead = ls.slice(headStart, classIdx).join('\n');
      headStart = bodyEnd + 1;
      if (!/@Controller\(/.test(classHead)) continue;
      const base = controllerBase(classHead.slice(classHead.indexOf('@Controller(')));
      const version = base.version ?? dv;
      const classPublic = /@Public\(\)/.test(classHead);
      const classKinds =
        /@ActorKinds\(([^)]*)\)/.exec(classHead)?.[1]?.replace(/['"`\s]/g, '') ?? '';
      const classExcluded = /@ApiExcludeController\(/.test(classHead);
      const className = /^export\s+(?:abstract\s+)?class\s+(\w+)/.exec(ls[classIdx])?.[1] ?? '';

      let decorators = [];
      for (let i = classIdx + 1; i < bodyEnd; i++) {
        const line = ls[i];
        if (/^ {2}@\w+/.test(line)) {
          // join a multi-line decorator until its parentheses balance
          let text2 = line.trim();
          let depth = (text2.match(/\(/g) || []).length - (text2.match(/\)/g) || []).length;
          let j = i;
          while (depth > 0 && j + 1 < ls.length) {
            j++;
            text2 += ' ' + ls[j].trim();
            depth += (ls[j].match(/\(/g) || []).length - (ls[j].match(/\)/g) || []).length;
          }
          decorators.push({ text: text2, line: i + 1 });
          i = j;
          continue;
        }
        const sig =
          /^ {2}(?:public\s+|private\s+|protected\s+)?(?:async\s+)?(\w+)\s*(?:<[^>]*>)?\(/.exec(
            line,
          );
        if (sig && decorators.length) {
          const http = decorators.find((d) => HTTP_DECORATORS.has(/^@(\w+)/.exec(d.text)?.[1]));
          if (http) {
            const method = /^@(\w+)/.exec(http.text)[1].toUpperCase();
            const sub = /@\w+\(\s*['"`]([^'"`]*)['"`]/.exec(http.text)?.[1] ?? '';
            const names = decorators.map((d) => /^@(\w+)/.exec(d.text)?.[1]);
            const kinds = decorators.find((d) => d.text.startsWith('@ActorKinds('));
            routes.push({
              method,
              path: joinPath(version ? `v${version}` : '', base.path, sub),
              controller: className,
              handler: sig[1],
              file,
              line: http.line,
              public: classPublic || names.includes('Public'),
              actorKinds:
                (kinds
                  ? /@ActorKinds\(([^)]*)\)/.exec(kinds.text)?.[1]?.replace(/['"`\s]/g, '')
                  : '') ||
                classKinds ||
                null,
              throttle: names.includes('Throttle'),
              skipThrottle: names.includes('SkipThrottle'),
              allowWhileGated: names.includes('AllowWhileGated'),
              apiExcluded: classExcluded || names.includes('ApiExcludeEndpoint'),
            });
          }
        }
        if (!/^ {2}@/.test(line) && !/^\s*$/.test(line) && sig) decorators = [];
        // A closing brace at class-member indent also ends a decorator run (decorated property, etc.).
        if (/^ {2}\}/.test(line)) decorators = [];
      }
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

export const routeKey = (r) => `${r.method} ${r.path}`;

// ---------------------------------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------------------------------

const AUTH_TEST_PATH =
  /auth|session|mfa|login|password|operator|impersonat|api-?key|realtime|rbac|permission|tenan|workspace|recover|totp|csrf|cors|security|rate-?limit|throttle|logout|cookie|proxy|next-path|idle|remember|webhook-secret|crypto|token|sheets-auth|org-suspension|ip\.spec/i;

/** Test file -> controls it provides evidence for. Curated; a test not listed here is counted but not traced. */
export const TEST_CONTROL_MAP = [
  [/totp\.spec/, ['AUTH-047', 'AUTH-048']],
  [/mfa-attempt-limiter/, ['AUTH-048', 'AUTH-022']],
  [/mfa-login-request/, ['AUTH-045', 'AUTH-048']],
  [/recovery-codes/, ['AUTH-049']],
  [/password-policy-unicode/, ['AUTH-017', 'AUTH-016']],
  [/password-policy/, ['AUTH-012', 'AUTH-013', 'AUTH-014']],
  [/token-expiry/, ['AUTH-037', 'AUTH-055']],
  [/security-headers/, ['AUTH-043', 'AUTH-083']],
  [/audit-redaction-and-risk/, ['AUTH-089', 'AUTH-090', 'AUTH-091', 'AUTH-092']],
  [/crypto-key-ring/, ['AUTH-039', 'AUTH-047']],
  [/auth-registration-security\/ip\.spec/, ['AUTH-021']],
  [/api-rate-limit/, ['AUTH-021', 'AUTH-028']],
  [/privileged-access/, ['AUTH-044', 'AUTH-069']],
  [/security-policy-store/, ['AUTH-032', 'AUTH-041', 'AUTH-044']],
  [/org-suspension-gate/, ['AUTH-003', 'AUTH-067']],
  [/emergency-halt/, ['AUTH-018']],
  [/impersonation/, ['AUTH-069', 'AUTH-071']],
  [
    /auth-login-sessions\.e2e/,
    [
      'AUTH-029',
      'AUTH-030',
      'AUTH-031',
      'AUTH-032',
      'AUTH-033',
      'AUTH-034',
      'AUTH-036',
      'AUTH-038',
      'AUTH-041',
      'AUTH-042',
    ],
  ],
  [
    /auth-flows\.e2e/,
    ['AUTH-005', 'AUTH-054', 'AUTH-055', 'AUTH-056', 'AUTH-057', 'AUTH-058', 'AUTH-059'],
  ],
  [/auth-security-account\.e2e/, ['AUTH-046', 'AUTH-050', 'AUTH-052', 'AUTH-053']],
  [/auth-signup-social\.e2e/, ['AUTH-004', 'AUTH-007', 'AUTH-076']],
  [/otp-delivery/, ['AUTH-048']],
  [/webhook-secret-registry|webhook-rotation/, ['AUTH-080']],
  [/api-key/, ['AUTH-072', 'AUTH-073', 'AUTH-074', 'AUTH-075']],
  [/developer-rest-api-v1\/auth\.e2e/, ['AUTH-073', 'AUTH-079']],
  [/sheets-auth/, ['AUTH-079']],
  [/web\/.*(logout|cookies|idle-redirect|remember)/, ['AUTH-035', 'AUTH-086', 'AUTH-087']],
  [/web\/.*proxy/, ['AUTH-082']],
  [/web\/.*next-path/, ['AUTH-088', 'AUTH-077']],
  [/realtime/, ['AUTH-084', 'AUTH-085']],
  [/rbac|permission/, ['AUTH-066', 'AUTH-068']],
];

export function controlsForTestFile(file) {
  const out = new Set();
  for (const [re, ids] of TEST_CONTROL_MAP) if (re.test(file)) ids.forEach((i) => out.add(i));
  return [...out];
}

function layerOf(file) {
  if (file.startsWith('apps/web/e2e/')) return 'web-e2e';
  if (file.startsWith('apps/web/')) return 'web-unit';
  if (file.includes('/test/e2e/')) return 'api-e2e';
  if (file.includes('/test/integration/')) return 'api-integration';
  if (file.includes('/test/unit/')) return 'api-unit';
  return 'other';
}

export function scanTests() {
  const apiTests = walk('apps/api/test', (f) => /\.(spec|test)\.ts$/.test(f));
  const webTests = walk('apps/web', (f) => /\.(spec|test)\.tsx?$/.test(f));
  const out = [];
  for (const file of [...apiTests, ...webTests]) {
    if (!AUTH_TEST_PATH.test(file)) continue;
    const text = read(file) ?? '';
    const count = (text.match(/^\s*(?:it|test)(?:\.(?:only|skip|concurrent))?\s*\(/gm) || [])
      .length;
    const each = (text.match(/^\s*(?:it|test)\.each\b/gm) || []).length;
    const skipped = (text.match(/^\s*(?:it|test|describe)\.skip\b|^\s*(?:it|test)\.todo\b/gm) || [])
      .length;
    const only = (text.match(/\b(?:it|test|describe)\.only\s*\(/g) || []).length;
    out.push({
      file,
      layer: layerOf(file),
      declared: count + each,
      parameterised: each,
      skipped,
      only,
      controls: controlsForTestFile(file),
    });
  }
  return out;
}

export { rel };
