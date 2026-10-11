#!/usr/bin/env node
// Authorization audit, phase 1: machine-readable route inventory.
//
//   node tools/authz-audit/inventory.mjs [--out reports/authz-audit/latest]
//
// A route with no gate is reported as `authenticated-only`, never as allowed. Output:
// authorization-route-inventory.json and authorization-route-summary.md.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { REPO, scanRoutes } from './lib/routes.mjs';

const outArg = process.argv.indexOf('--out');
const OUT = resolve(REPO, outArg > -1 ? process.argv[outArg + 1] : 'reports/authz-audit/latest');

const routes = scanRoutes();
const byGate = routes.reduce((a, r) => ((a[r.gate] = (a[r.gate] ?? 0) + 1), a), {});
const mutating = routes.filter((r) => r.method !== 'GET');
const summary = {
  generatedFrom: 'apps/api/src/**/*.controller.ts',
  routes: routes.length,
  byGate,
  mutatingAuthenticatedOnly: mutating.filter((r) => r.gate === 'authenticated-only').length,
  idorCandidates: routes.filter((r) => r.objectIdParams.length).length,
};

mkdirSync(OUT, { recursive: true });
// Generated evidence is never committed (same as reports/auth-audit).
writeFileSync(join(REPO, 'reports/authz-audit/.gitignore'), '*\n');
writeFileSync(join(OUT, 'authorization-route-inventory.json'), JSON.stringify({ summary, routes }, null, 2));

const list = (rs) => rs.map((r) => `- \`${r.id}\` — ${r.file}#${r.handler}`);
const ungated = routes.filter((r) => r.gate === 'authenticated-only');
const coarse = routes.filter((r) => r.gate === 'operator-or-partner-coarse');
const md = [
  '# Authorization route inventory',
  '',
  `Routes: **${summary.routes}** · by gate: ${Object.entries(byGate).map(([k, v]) => `${k} ${v}`).join(', ')}`,
  `IDOR candidates (object id in path): **${summary.idorCandidates}**`,
  '',
  `## Authenticated-only routes (no permission, guard or actor kind): ${ungated.length}`,
  '',
  'Each needs a documented policy (self-service, service-level check) or a `@RequirePermission`.',
  '',
  ...list(ungated),
  '',
  `## Operator/partner routes gated only by actor kind or OperatorGuard (no per-action permission): ${coarse.length}`,
  '',
  'Any platform operator (or partner agent) reaches these whatever their role: candidate BFLA among staff.',
  '',
  ...list(coarse),
  '',
].join('\n');
writeFileSync(join(OUT, 'authorization-route-summary.md'), md);
console.log(JSON.stringify(summary, null, 2));
console.log(`wrote ${relative(REPO, OUT)}`);
