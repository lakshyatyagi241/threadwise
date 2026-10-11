// Static route scanner shared by the audit CLI and the generated e2e matrix.
// Reads apps/api/src/**/*.controller.ts; never executes application code.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const SRC = join(REPO, 'apps/api/src');

function walkTs(dir, keep, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walkTs(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}

const strArgs = (s) => [...s.matchAll(/['"`]([^'"`]*)['"`]/g)].map((m) => m[1]);

// `export const NAME = 'literal'` across contracts and the API, so `@RequirePermission(EXT_SHEETS_USE_PERMISSION)` resolves to its key.
let constants;
function constantMap() {
  if (constants) return constants;
  constants = new Map();
  const roots = [join(REPO, 'packages/contracts/src'), SRC];
  for (const root of roots) {
    for (const f of walkTs(root, (p) => p.endsWith('.ts') && !p.endsWith('.d.ts'))) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/export const ([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*['"`]([^'"`$]+)['"`]/g)) {
        constants.set(m[1], m[2]);
      }
    }
  }
  return constants;
}

/** String literals and resolvable constants in a decorator's arguments; an unresolved identifier stays as `$NAME`. */
function tokenArgs(s) {
  const out = [];
  // `...anyPropertyPermission('read')` builds both moduleKeys' keys (apps/api/src/modules/crm/field-metadata-permission.ts).
  s = s.replace(/\.\.\.anyPropertyPermission\(\s*['"](\w+)['"]\s*\)?/g, (_m, action) => {
    out.push(`record.contact-properties.${action}`, `record.company-properties.${action}`);
    return '';
  });
  for (const m of s.matchAll(/['"`]([^'"`]*)['"`]|\b([A-Z][A-Z0-9_]{2,})\b/g)) {
    if (m[1] !== undefined) out.push(m[1]);
    else out.push(constantMap().get(m[2]) ?? `$${m[2]}`);
  }
  return out;
}

const decoratorArgs = (text, name) => {
  const out = [];
  for (const m of text.matchAll(new RegExp(`@${name}\\(([^)]*)\\)`, 'g'))) {
    out.push(...(name === 'RequirePermission' ? tokenArgs(m[1]) : strArgs(m[1])));
  }
  return out;
};
const has = (text, name) => new RegExp(`@${name}\\b`).test(text);

function gateOf(text) {
  return {
    public: has(text, 'Public'),
    permissions: decoratorArgs(text, 'RequirePermission'),
    actorKinds: decoratorArgs(text, 'ActorKinds'),
    guards: [...text.matchAll(/@UseGuards\(([^)]*)\)/g)].flatMap((m) => m[1].split(',').map((s) => s.trim())),
    v1Api: has(text, 'V1Controller'),
    planFeature: decoratorArgs(text, 'RequirePlanFeature'),
    idempotent: has(text, 'Idempotent'),
  };
}

export function classify(g) {
  if (g.v1Api) return 'api-key';
  if (g.public) return 'public';
  if (g.permissions.length) return 'permission';
  if (g.guards.includes('PlatformPermissionGuard')) return 'operator-permission';
  if (g.guards.includes('OperatorGuard') || g.actorKinds.some((k) => k !== 'user')) {
    return 'operator-or-partner-coarse';
  }
  return 'authenticated-only';
}

/** Every HTTP handler of every controller, with its effective gates and its real URL. */
export function scanRoutes() {
  const routes = [];
  const files = walkTs(SRC, (p) => p.endsWith('.controller.ts')).sort();
  for (const path of files) {
    const file = relative(SRC, path).split(sep).join('/');
    const src = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
    const chunks = src.split(/^export class /m);
    for (let i = 1; i < chunks.length; i += 1) {
      const prev = chunks[i - 1];
      const classDeco = prev.slice(Math.max(prev.lastIndexOf('\n\n'), 0));
      const v1 = /@V1Controller\(\s*['"`]([^'"`]*)['"`]/.exec(classDeco);
      // `@Controller('x')`, `@Controller({ path: 'x', version })`, or `@Controller({ version })` with no prefix at all.
      const ctl = /@Controller\(([^)]*)\)/.exec(classDeco)?.[1] ?? '';
      const controllerPath = ctl.trim().startsWith('{') ? (/path:\s*['"`]([^'"`]*)['"`]/.exec(ctl)?.[1] ?? '') : (strArgs(ctl)[0] ?? '');
      const prefix = v1 ? `api/v1/${v1[1]}` : controllerPath;
      const neutral = Boolean(v1) || /VERSION_NEUTRAL/.test(classDeco);
      const version = neutral ? null : (/version:\s*['"`](\d+)/.exec(classDeco)?.[1] ?? '2');
      const classGate = gateOf(classDeco);
      const body = chunks[i];
      const className = /^(\w+)/.exec(body)?.[1] ?? '?';
      const re = /@(Get|Post|Put|Patch|Delete|All)\(([^)]*)\)/g;
      for (let m = re.exec(body); m; m = re.exec(body)) {
        const start = Math.max(body.lastIndexOf('\n\n', m.index), 0);
        // The handler is the first method signature after the HTTP decorator, async or not.
        const sigRe = /\n {2}(?:public |private |protected )?(?:async )?(\w+)\s*[(<]/g;
        sigRe.lastIndex = m.index;
        const sm = sigRe.exec(body);
        if (!sm) continue;
        const end = sm.index;
        const deco = body.slice(start, end);
        const sigEnd = body.indexOf('{', end);
        const sig = body.slice(end, sigEnd === -1 ? end + 600 : sigEnd);
        const sub = strArgs(m[2])[0] ?? '';
        const routePath = '/' + [prefix, sub].filter(Boolean).join('/').replace(/\/+/g, '/').replace(/^\//, '');
        const mg = gateOf(deco);
        const gate = {
          public: classGate.public || mg.public,
          permissions: [...new Set([...classGate.permissions, ...mg.permissions])],
          actorKinds: [...new Set([...classGate.actorKinds, ...mg.actorKinds])],
          guards: [...new Set([...classGate.guards, ...mg.guards])],
          v1Api: classGate.v1Api,
          planFeature: [...new Set([...classGate.planFeature, ...mg.planFeature])],
          idempotent: mg.idempotent,
        };
        const pathParams = [...routePath.matchAll(/:(\w+)/g)].map((x) => x[1]);
        routes.push({
          id: `${m[1].toUpperCase()} ${version ? `/v${version}` : ''}${routePath}`,
          file,
          className,
          handler: sm[1],
          method: m[1].toUpperCase(),
          path: routePath,
          url: `${version ? `/v${version}` : ''}${routePath}`,
          gate: classify(gate),
          ...gate,
          objectIdParams: pathParams.filter((p) => /id$|Id$|slug|key|token|uuid/i.test(p)),
          pathParams,
          hasBody: /@Body\(/.test(sig),
          hasQuery: /@Query\(/.test(sig),
        });
      }
    }
  }
  return routes;
}
