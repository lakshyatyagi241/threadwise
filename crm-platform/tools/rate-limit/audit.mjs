#!/usr/bin/env node
// Rate-limit route audit (QA sheet 3, item 33). Static: reads the controllers and the deploy files; starts nothing.
//
//   node tools/rate-limit/audit.mjs            check docs/security/rate-limiting/route-inventory.json is current (exit 1 if not)
//   node tools/rate-limit/audit.mjs --write    regenerate it
//   node tools/rate-limit/audit.mjs --json     print the summary
//
// The inventory lists every route that invites abuse (public, credential, webhook, costly) with the limiter its code declares.
// A declared limiter is a claim; census.mjs proves it against a running API, and gate.mjs turns both into a release verdict.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enrich, parsePolicies, scanController } from './lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'docs/security/rate-limiting/route-inventory.json');

const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

/** The deploy files' settings that decide whether the limiter works at all. */
export function deployChecks(files) {
  const found = [];
  for (const { file, text } of files) {
    for (const m of text.matchAll(
      /^\s*(TRUST_PROXY|INFRA_RATE_LIMIT_ENABLED|INFRA_RATE_LIMIT_DEFAULT_PER_MINUTE)\s*[:=]\s*['"]?([^'"\n#]*)['"]?/gm,
    )) {
      found.push({ file, name: m[1], value: m[2].trim() });
    }
  }
  const problems = [];
  for (const f of found) {
    if (f.name === 'INFRA_RATE_LIMIT_ENABLED' && /^(false|0)$/i.test(f.value))
      problems.push({ ...f, why: 'the limiter is switched off in a deploy file' });
    if (f.name === 'TRUST_PROXY' && /^(true|\*|all|0\.0\.0\.0\/0|::\/0)$/i.test(f.value))
      problems.push({
        ...f,
        why: 'trusts every proxy: any client can forge X-Forwarded-For and dodge every per-address limit',
      });
    if (f.name === 'TRUST_PROXY' && f.value === '')
      problems.push({
        ...f,
        why: 'empty: behind a proxy every client shares the proxy address and one counter',
      });
  }
  return { found, problems };
}

/** Builds the inventory. `read` is injected so the tests need no disk. */
export function build({ controllers, policiesSrc, deploy }) {
  const policies = parsePolicies(policiesSrc);
  const all = controllers
    .flatMap((c) => scanController(c.text, c.file))
    .map((r) => enrich(r, policies));
  const keep = all.filter((r) => r.cls !== 'other' || r.limiter !== 'none');
  const routes = keep
    .map((r) => ({
      key: r.key,
      class: r.cls,
      public: r.public,
      ...(r.bodySchema ? { bodySchema: r.bodySchema } : {}),
      limiter: r.limiter,
      ...(r.throttle
        ? {
            throttle: r.throttle.policy
              ? r.throttle.policy
              : `${r.throttle.limit}/${r.throttle.windowSeconds}s by ${r.throttle.by}`,
          }
        : {}),
      ...(r.effective
        ? { effective: `${r.effective.limit}/${r.effective.windowSeconds}s by ${r.effective.by}` }
        : {}),
      severityIfUnlimited: r.severityIfUnlimited,
      file: r.file,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const count = (f) => all.filter(f).length;
  const summary = {
    routes: all.length,
    public: count((r) => r.public),
    withThrottle: count((r) => r.limiter === 'throttle'),
    skippedByDesign: count((r) => r.limiter === 'skipped'),
    byClass: Object.fromEntries(
      ['credential', 'public-write', 'webhook', 'public-read', 'costly'].map((c) => [
        c,
        {
          routes: count((r) => r.cls === c),
          declared: count((r) => r.cls === c && r.limiter !== 'none'),
          undeclared: count((r) => r.cls === c && r.limiter === 'none'),
        },
      ]),
    ),
  };
  return { policies, summary, deploy: deployChecks(deploy), routes };
}

export function load() {
  const files = walk(join(ROOT, 'apps/api/src')).filter((f) => /\.controller\.ts$/.test(f));
  const deployFiles = [
    ...walk(join(ROOT, 'deploy')).filter((f) => /\.(ya?ml|env[\w.]*)$/.test(f)),
    join(ROOT, '.env.example'),
  ].filter(existsSync);
  return {
    controllers: files.map((f) => ({ file: relative(ROOT, f), text: readFileSync(f, 'utf8') })),
    policiesSrc: readFileSync(
      join(ROOT, 'apps/api/src/modules/platform-infrastructure/rate-limit/rate-limit.policies.ts'),
      'utf8',
    ),
    deploy: deployFiles.map((f) => ({ file: relative(ROOT, f), text: readFileSync(f, 'utf8') })),
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const inv = build(load());
  const text =
    JSON.stringify({ generatedBy: 'tools/rate-limit/audit.mjs', ...inv }, null, 2) + '\n';
  if (process.argv.includes('--json')) console.log(JSON.stringify(inv.summary, null, 2));
  else if (process.argv.includes('--write')) {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, text);
    console.log(
      `wrote ${relative(ROOT, OUT)}: ${inv.summary.routes} routes, ${inv.routes.length} listed`,
    );
  } else {
    const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    console.log(
      `rate-limit audit: ${inv.summary.routes} routes, ${inv.summary.public} public, ${inv.summary.withThrottle} with @Throttle`,
    );
    for (const p of inv.deploy.problems)
      console.error(`deploy problem: ${p.file}: ${p.name}=${p.value}: ${p.why}`);
    if (cur !== text || inv.deploy.problems.length) {
      if (cur !== text)
        console.error(
          'docs/security/rate-limiting/route-inventory.json is out of date. Run: node tools/rate-limit/audit.mjs --write',
        );
      process.exit(1);
    }
  }
}
