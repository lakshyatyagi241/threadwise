#!/usr/bin/env node
// Static scan for operations that can block the Node.js event loop (ELM-011..020).
//
//   node tools/event-loop-audit/scan.mjs                 # write reports/event-loop/blocking-hotspots.json, print a summary
//   node tools/event-loop-audit/scan.mjs --check         # exit 1 when a runtime-path finding is NEW (not in baseline.json)
//   node tools/event-loop-audit/scan.mjs --write-baseline # accept today's runtime findings as the baseline
//
// A finding is a SUSPECT, not a defect: the scan sees syntax, not load. Each one needs a profile or a reproduction before code
// changes (docs/performance/event-loop/event-loop-observability-runbook.md). The gate exists so the count of suspects on request
// paths cannot grow silently: a new one must be fixed or added to the baseline in review, with a reason.
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const require = createRequire(join(root, 'package.json'));
const ts = require('typescript');

const args = new Set(process.argv.slice(2));
const SCAN_DIRS = [
  'apps/api/src',
  'apps/web/src',
  'packages/db/src',
  'packages/contracts/src',
  'packages/tax/src',
];
const SKIP_DIR = new Set(['node_modules', 'dist', '.next', 'coverage', '.turbo']);

/** Where a finding sits decides whether it can ever run beside live traffic. */
function classify(rel) {
  const p = rel.split(sep).join('/');
  if (
    /(\.spec|\.test|\.e2e)\.[cm]?tsx?$/.test(p) ||
    /\/__tests__\//.test(p) ||
    /\/(testing|test-support|test-messages|mock-server)\.[cm]?tsx?$/.test(p)
  )
    return 'test';
  if (
    /\/(cli|tools|scripts|migrations?|seed[^/]*)\//.test(p) ||
    /\.cli\.[cm]?tsx?$/.test(p) ||
    /\.(seed|main)\.[cm]?tsx?$/.test(p)
  )
    return 'offline';
  if (/\/(main|worker)\.ts$/.test(p) || /\/config\/|\/env\.schema|\.env\.ts$/.test(p))
    return 'startup';
  return 'runtime';
}

const SYNC_FS =
  /^(readFileSync|writeFileSync|appendFileSync|readdirSync|statSync|lstatSync|existsSync|mkdirSync|rmSync|rmdirSync|unlinkSync|copyFileSync|renameSync|readlinkSync|realpathSync|openSync|accessSync|cpSync)$/;
const SYNC_CP = /^(execSync|execFileSync|spawnSync)$/;
const SYNC_CRYPTO =
  /^(pbkdf2Sync|scryptSync|generateKeyPairSync|generatePrimeSync|hkdfSync|argon2Sync|hashSync|compareSync)$/;
const SYNC_ZLIB =
  /^(gzipSync|gunzipSync|deflateSync|inflateSync|deflateRawSync|inflateRawSync|brotliCompressSync|brotliDecompressSync|unzipSync)$/;

const RULES = {
  'sync-fs': {
    id: 'ELM-012',
    priority: 'P1',
    why: 'Synchronous filesystem call blocks every other request while the disk answers.',
    fix: 'Use fs/promises, or hoist to startup.',
  },
  'sync-child-process': {
    id: 'ELM-011',
    priority: 'P0',
    why: 'Synchronous child process blocks the loop for the whole child lifetime.',
    fix: 'Use execFile/spawn with promises, or a job.',
  },
  'sync-crypto': {
    id: 'ELM-014',
    priority: 'P1',
    why: 'CPU-heavy synchronous crypto runs on the main thread.',
    fix: 'Use the async variant (runs on the libuv pool).',
  },
  'sync-zlib': {
    id: 'ELM-015',
    priority: 'P1',
    why: 'Synchronous compression blocks in proportion to payload size.',
    fix: 'Use the async/stream zlib API.',
  },
  'json-deep-clone': {
    id: 'ELM-013',
    priority: 'P1',
    why: 'JSON.parse(JSON.stringify(x)) serialises and parses the whole value synchronously, twice the allocation of structuredClone.',
    fix: 'structuredClone, or avoid the copy.',
  },
  'atomics-wait': {
    id: 'ELM-011',
    priority: 'P0',
    why: 'Atomics.wait on the main thread freezes it.',
    fix: 'Use a worker thread or async wait.',
  },
  'unbounded-loop': {
    id: 'ELM-017',
    priority: 'P0',
    why: 'while(true) / for(;;) with no await inside never yields to the loop.',
    fix: 'Bound the iterations or yield (await setImmediate) between chunks.',
  },
  'regex-backtracking': {
    id: 'ELM-016',
    priority: 'P0',
    why: 'Nested quantifier or overlapping alternation can backtrack exponentially (ReDoS) on hostile input.',
    fix: 'Rewrite without nested quantifiers, bound the input length, or use a linear matcher.',
  },
};

// One regex atom: an escape (\w, \d, \.), a character class ([a-z0-9]), a dot, or a literal word character.
const ATOM = String.raw`(?:\\.|\[(?:[^\]\\]|\\.)*\]|\.|\w)`;
// A group whose whole body is ONE quantified atom and which is itself quantified: (a+)+  ([a-z]*)*  (\w+)*  (.+)+
const NESTED = new RegExp(String.raw`\((?:\?:)?${ATOM}[+*]\)(?:[+*]|\{\d+,\d*\})`);
const REPEATED_ALT = /\(([^()|]+)\|\1\)[+*]/;

/**
 * Conservative ReDoS shapes only. A group with a required literal between repeats ((?:\.\w+)+, (-[a-z]+)*) is linear and is NOT
 * flagged. Also (a|a)+ with an identical alternative. Misses overlapping alternations such as (a|aa)+: a heuristic, not a proof.
 */
function riskyRegex(source) {
  if (NESTED.test(source)) return 'nested quantifier';
  if (REPEATED_ALT.test(source)) return 'repeated alternative';
  return null;
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.[cm]?tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function containsAwait(node) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (n.kind === ts.SyntaxKind.AwaitExpression) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/**
 * Can control leave this loop body? A return or throw outside any nested function, or a break that targets THIS loop (not an inner
 * loop or switch), counts. A labelled break is treated as an exit. Nested functions are skipped: their return leaves the callback.
 */
function containsExit(node) {
  let found = false;
  const visit = (n, nestedBreakable) => {
    if (found) return;
    if (ts.isFunctionLike(n)) return;
    if (ts.isReturnStatement(n) || ts.isThrowStatement(n)) {
      found = true;
      return;
    }
    if (ts.isBreakStatement(n) && (n.label || !nestedBreakable)) {
      found = true;
      return;
    }
    const breakable =
      nestedBreakable || ts.isIterationStatement(n, false) || ts.isSwitchStatement(n);
    ts.forEachChild(n, (c) => visit(c, breakable));
  };
  visit(node, false);
  return found;
}

function scanFile(file) {
  const rel = relative(root, file);
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const kind = classify(rel);
  const found = [];
  /** Nearest named function or method around a node: a baseline key that survives line shifts but notices a new call site. */
  const enclosingName = (node) => {
    for (let p = node.parent; p; p = p.parent) {
      if (
        (ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p) || ts.isClassDeclaration(p)) &&
        p.name
      )
        return p.name.getText(sf);
      if (ts.isVariableDeclaration(p) && p.initializer && ts.isFunctionLike(p.initializer))
        return p.name.getText(sf);
    }
    return '<module>';
  };
  const add = (rule, node, detail) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    found.push({
      rule,
      file: rel.split(sep).join('/'),
      line: line + 1,
      scope: kind,
      detail,
      in: enclosingName(node),
    });
  };
  const visit = (n) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : '';
      const obj = ts.isPropertyAccessExpression(callee) ? callee.expression.getText(sf) : '';
      if (SYNC_FS.test(name)) add('sync-fs', n, name);
      else if (SYNC_CP.test(name)) add('sync-child-process', n, name);
      else if (SYNC_CRYPTO.test(name)) add('sync-crypto', n, name);
      else if (SYNC_ZLIB.test(name)) add('sync-zlib', n, name);
      else if (name === 'wait' && obj === 'Atomics') add('atomics-wait', n, 'Atomics.wait');
      else if (obj === 'JSON' && name === 'parse' && n.arguments.length === 1) {
        const a = n.arguments[0];
        if (ts.isCallExpression(a) && a.expression.getText(sf) === 'JSON.stringify')
          add('json-deep-clone', n, 'JSON.parse(JSON.stringify(...))');
      }
    }
    if (ts.isRegularExpressionLiteral(n)) {
      const why = riskyRegex(n.text.slice(1, n.text.lastIndexOf('/')));
      if (why) add('regex-backtracking', n, `${why}: ${n.text.slice(0, 80)}`);
    }
    // Only loops with no way out and no await: a loop that breaks on data is bounded by its input, which needs a profile, not a rule.
    if (
      ts.isWhileStatement(n) &&
      n.expression.kind === ts.SyntaxKind.TrueKeyword &&
      !containsAwait(n.statement) &&
      !containsExit(n.statement)
    ) {
      add('unbounded-loop', n, 'while(true) without exit or await');
    }
    if (
      ts.isForStatement(n) &&
      !n.condition &&
      !containsAwait(n.statement) &&
      !containsExit(n.statement)
    ) {
      add('unbounded-loop', n, 'for(;;) without exit or await');
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/** apps/web is mostly browser code, which has no Node event loop to block: scan only what runs in the Next.js server. */
function isWebServerFile(rel, text) {
  const p = rel.split(sep).join('/');
  return (
    /\/app\/.*route\.[tj]sx?$/.test(p) ||
    /\/(middleware|proxy|instrumentation)\.[tj]s$/.test(p) ||
    /\/i18n\//.test(p) ||
    /actions\.[tj]sx?$/.test(p) ||
    /^\s*['"]use server['"]/m.test(text) ||
    /import ['"]server-only['"]/.test(text)
  );
}

const findings = [];
for (const d of SCAN_DIRS) {
  for (const f of walk(join(root, d))) {
    if (d.startsWith('apps/web') && !isWebServerFile(relative(root, f), readFileSync(f, 'utf8')))
      continue;
    findings.push(...scanFile(f));
  }
}

const withMeta = findings.map((f) => ({ ...f, ...RULES[f.rule] }));
const runtime = withMeta.filter((f) => f.scope === 'runtime');
// file + rule + what + where: replacing one suspect with another in the same file changes the key, so it cannot hide behind an equal count.
const countKey = (f) => `${f.file}::${f.rule}::${f.detail.slice(0, 60)}::${f.in}`;
const counts = {};
for (const f of runtime) counts[countKey(f)] = (counts[countKey(f)] ?? 0) + 1;

const baselinePath = join(here, 'baseline.json');
if (args.has('--write-baseline')) {
  writeFileSync(
    baselinePath,
    `${JSON.stringify({ note: 'Accepted runtime-path suspects. A count may go down freely; going up needs a reason in review.', counts }, null, 1)}\n`,
  );
  console.log(
    `baseline written: ${Object.keys(counts).length} file/rule pairs, ${runtime.length} findings`,
  );
}
const baseline = existsSync(baselinePath)
  ? JSON.parse(readFileSync(baselinePath, 'utf8')).counts
  : {};
const regressions = Object.entries(counts)
  .filter(([k, n]) => n > (baseline[k] ?? 0))
  .map(([k, n]) => ({ key: k, now: n, baseline: baseline[k] ?? 0 }));

const byRule = {};
for (const f of withMeta) {
  byRule[f.rule] ??= { runtime: 0, startup: 0, offline: 0, test: 0 };
  byRule[f.rule][f.scope]++;
}
const report = {
  generatedAt: new Date().toISOString(),
  scanned: SCAN_DIRS,
  note: 'Suspects from syntax only. NOT confirmed blocking: each needs a profile or reproduction first.',
  totals: { all: withMeta.length, runtime: runtime.length },
  byRule,
  regressionsVsBaseline: regressions,
  runtimeFindings: runtime,
};
const outDir = join(root, 'reports/event-loop');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'blocking-hotspots.json'), `${JSON.stringify(report, null, 1)}\n`);

console.log(
  `event-loop static scan: ${withMeta.length} suspects, ${runtime.length} on runtime paths`,
);
for (const [rule, c] of Object.entries(byRule))
  console.log(
    `  ${rule.padEnd(20)} runtime ${c.runtime}  startup ${c.startup}  offline ${c.offline}  test ${c.test}`,
  );
if (args.has('--check')) {
  if (regressions.length) {
    console.error(`\nNEW runtime-path suspects (not in tools/event-loop-audit/baseline.json):`);
    for (const r of regressions) console.error(`  ${r.key}: ${r.now} (baseline ${r.baseline})`);
    console.error('Fix them, or accept with --write-baseline and say why in the PR.');
    process.exit(1);
  }
  console.log('gate: no new runtime-path suspects');
}
