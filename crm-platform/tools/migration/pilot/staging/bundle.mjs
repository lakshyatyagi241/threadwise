#!/usr/bin/env node
/**
 * Builds the two single-file programs that run on the staging server with plain `node` (no node_modules) inside the desk-api image
 * (node:22-alpine, see apps/api/Dockerfile):
 *
 *   dist/waboo-migrate.cjs     tools/migration/cli.ts and everything it imports (packages/db/src pieces, pg, pg-connection-string, drizzle)
 *   dist/waboo-preflight.cjs   pilot/staging/preflight.ts (the migrations of this checkout are embedded as a fallback list)
 *   dist/BUILD-INFO.json       git sha, date, node target, tool version, sha256 of each file, the embedded maps, every fs read
 *
 *   node pilot/staging/bundle.mjs            (from tools/migration; esbuild comes with tsx, nothing is added)
 *
 * The build FAILS when a source file outside node_modules reads the file system, or resolves a path from __dirname / import.meta /
 * process.cwd(), in a way that is not on the reviewed list below: such a read would break (or silently read the wrong place) once the code
 * is one file in another directory. access/config.ts reads its two JSON maps from __dirname: they are embedded instead, at build time.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = resolve(HERE, '../..');
const REPO = resolve(TOOL, '../..');
const DIST = join(HERE, 'dist');
const NODE_TARGET = 'node22'; // apps/api/Dockerfile: FROM node:22-alpine

const require = createRequire(join(TOOL, 'package.json'));
const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild');

/**
 * Every place outside node_modules that touches the file system or computes a path from the code's own location, each with why it is safe
 * in the bundle. `file` is relative to tools/migration. A hit that is not listed fails the build; a listed one that no longer exists
 * also fails (the list must stay true).
 */
const REVIEWED = [
  {
    file: 'access/config.ts',
    api: '__dirname',
    why: 'default dir of the two access maps: replaced by the embedded copies at build time',
  },
  {
    file: 'access/config.ts',
    api: 'readFileSync',
    why: 'reads the two access maps: served from the embedded copies when dir is the default',
  },
  {
    file: 'cli.ts',
    api: '__dirname',
    why: 'DEFAULT dumps and out dirs only: the runbook always passes SOURCE_DUMPS_DIR and --out (in the bundle __dirname is dist/)',
  },
  {
    file: 'credits/config.ts',
    api: 'existsSync',
    why: 'the --credit-opening file, a path given on the command line',
  },
  {
    file: 'credits/config.ts',
    api: 'readFileSync',
    why: 'the --credit-opening file, a path given on the command line',
  },
  {
    file: 'extract/manifest.ts',
    api: 'createReadStream',
    why: 'dump files under SOURCE_DUMPS_DIR',
  },
  {
    file: 'extract/manifest.ts',
    api: 'existsSync',
    why: 'manifest.json / dump files under SOURCE_DUMPS_DIR',
  },
  { file: 'extract/manifest.ts', api: 'readFileSync', why: 'manifest.json under SOURCE_DUMPS_DIR' },
  {
    file: 'extract/manifest.ts',
    api: 'writeFileSync',
    why: 'manifest command only: writes manifest.json under SOURCE_DUMPS_DIR',
  },
  { file: 'load/core.ts', api: 'readFileSync', why: 'dumps/<client>/core.json under SOURCE_DUMPS_DIR (geta_core facts, no credentials)' },
  { file: 'load/walletsync.ts', api: 'readFileSync', why: 'dumps/<client>/core.json under SOURCE_DUMPS_DIR (the geta_core balance, no credentials)' },
  { file: 'reconcile/credits.ts', api: 'readFileSync', why: 'dumps/<client>/core.json next to the dump files (the verifier recomputes the wallet history from it; no credentials)' },
  { file: 'load/wallethistory.ts', api: 'readFileSync', why: 'dumps/<client>/core.json under SOURCE_DUMPS_DIR (the geta_core balance, timezone, top-ups and purchases; no credentials)' },
  { file: 'load/cutover.ts', api: 'readFileSync', why: 'the reconcile.md report under --out (/mig/out/<client>/reconcile.md), a path the caller passes in; no credentials' },
  { file: 'extract/source.ts', api: 'createReadStream', why: 'dump files under SOURCE_DUMPS_DIR' },
  { file: 'extract/source.ts', api: 'existsSync', why: 'SOURCE_DUMPS_DIR' },
  { file: 'extract/source.ts', api: 'readdirSync', why: 'SOURCE_DUMPS_DIR' },
  { file: 'extract/source.ts', api: 'readSync', why: 'dump files under SOURCE_DUMPS_DIR' },
  { file: 'extract/source.ts', api: 'openSync', why: 'dump files under SOURCE_DUMPS_DIR' },
  { file: 'extract/source.ts', api: 'closeSync', why: 'dump files under SOURCE_DUMPS_DIR' },
  {
    file: 'inbox/config.ts',
    api: 'existsSync',
    why: 'the --channel-map file, a path given on the command line',
  },
  {
    file: 'inbox/config.ts',
    api: 'readFileSync',
    why: 'the --channel-map file, a path given on the command line',
  },
  {
    file: 'pilot/staging/preflight.ts',
    api: '__dirname',
    why: 'one candidate migrations directory of a repo checkout; absent in the bundle, the other candidates and the embedded list apply',
  },
  {
    file: 'pilot/staging/preflight.ts',
    api: 'existsSync',
    why: 'looks for the image migrations directory (/app/migrations) or --migrations-dir',
  },
  { file: 'pilot/staging/preflight.ts', api: 'readdirSync', why: 'the image migrations directory' },
  {
    file: 'pilot/staging/preflight.ts',
    api: 'readFileSync',
    why: 'the image migrations directory',
  },
];
// the output side of the tool (reports) writes to --out through these; they take their path from the caller
const WRITERS = /\b(writeFileSync|mkdirSync|appendFileSync|createWriteStream|rmSync)\b/;
const OUT_WRITERS = new Set([
  'reconcile/index.ts',
  'extract/catalogue.ts',
  'pricing/seed.ts',
  'extract/manifest.ts',
]);

const readTouch =
  /\b(readFileSync|readFile|readdirSync|readdir|existsSync|createReadStream|openSync|readSync|closeSync|statSync|lstatSync|opendirSync|accessSync|realpathSync)\b/g;
const pathy = /\b(__dirname|__filename|import\.meta\.url|import\.meta\.dirname|process\.cwd\(\))/g;

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const git = (...a) => {
  try {
    return execFileSync('git', a, {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
};

// --- embedded data -------------------------------------------------------------------------------------------------------------------

// the checksum rules of the repo's own migrator, used as they are (bundled in memory, not copied)
const ck = esbuild.buildSync({
  entryPoints: [join(REPO, 'packages/db/src/checksum.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  logLevel: 'silent',
}).outputFiles[0].text;
const ckMod = { exports: {} };
new Function('module', 'exports', 'require', ck)(ckMod, ckMod.exports, require);
const MIG_DIR = join(REPO, 'packages/db/migrations');
const migrations = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => ({
    id: f.replace(/\.sql$/, ''),
    accepted: ckMod.exports.acceptedChecksums(readFileSync(join(MIG_DIR, f), 'utf8')),
  }));

const ACCESS_FILES = ['permission-map.json', 'role-map.json'];
const accessText = Object.fromEntries(
  ACCESS_FILES.map((f) => [f, readFileSync(join(TOOL, 'access', f), 'utf8')]),
);

// --- esbuild plugin: the access maps ---------------------------------------------------------------------------------------------------

const READ_LINE =
  "const read = (f: string): unknown => JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown;";
const embedAccessMaps = {
  name: 'embed-access-maps',
  setup(build) {
    build.onLoad({ filter: /access[\\/]config\.ts$/ }, (args) => {
      let src = readFileSync(args.path, 'utf8').replace(/\r\n/g, '\n');
      if (!src.includes(READ_LINE)) {
        throw new Error(
          'bundle: access/config.ts no longer reads its maps the way bundle.mjs expects; update the embed rule',
        );
      }
      src = src.replace(
        READ_LINE,
        `const EMBEDDED_MAPS: Record<string, string> = ${JSON.stringify(accessText)};\n` +
          `  const read = (f: string): unknown => JSON.parse(dir === __dirname && f in EMBEDDED_MAPS ? EMBEDDED_MAPS[f]! : readFileSync(join(dir, f), 'utf8')) as unknown;`,
      );
      return { contents: src, loader: 'ts', resolveDir: dirname(args.path) };
    });
  },
};

// --- build ---------------------------------------------------------------------------------------------------------------------------

const targets = [
  { entry: join(TOOL, 'cli.ts'), out: 'waboo-migrate.cjs' },
  { entry: join(HERE, 'preflight.ts'), out: 'waboo-preflight.cjs' },
];

mkdirSync(DIST, { recursive: true });
const inputs = new Map(); // file (relative to TOOL) -> source text
const files = {};
for (const t of targets) {
  const r = await esbuild.build({
    absWorkingDir: TOOL,
    entryPoints: [t.entry],
    outfile: join(DIST, t.out),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: NODE_TARGET,
    tsconfig: join(TOOL, 'tsconfig.json'),
    external: ['pg-native'], // pg loads it lazily and only for the `native` client, which nothing here uses
    plugins: [embedAccessMaps],
    define: { __EMBEDDED_MIGRATIONS__: JSON.stringify(migrations) },
    metafile: true,
    legalComments: 'none',
    logLevel: 'warning',
  });
  const bad = Object.values(r.metafile.outputs)
    .flatMap((o) => o.imports)
    .filter(
      (i) =>
        i.external &&
        !i.path.startsWith('node:') &&
        !require('node:module').builtinModules.includes(i.path) &&
        i.path !== 'pg-native',
    );
  if (bad.length)
    throw new Error(
      `bundle: ${t.out} still requires ${bad.map((b) => b.path).join(', ')} at runtime`,
    );
  for (const f of Object.keys(r.metafile.inputs).filter((x) => !x.startsWith('<'))) {
    const abs = resolve(TOOL, f);
    if (abs.split(sep).includes('node_modules')) continue;
    inputs.set(relative(TOOL, abs).split(sep).join('/'), readFileSync(abs, 'utf8'));
  }
  const buf = readFileSync(join(DIST, t.out));
  files[t.out] = { sha256: sha256(buf), bytes: buf.length };
}

// --- the file-system audit -----------------------------------------------------------------------------------------------------------

const hits = [];
for (const [file, src] of inputs) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const re of [readTouch, pathy, new RegExp(WRITERS.source, 'g')]) {
    for (const api of new Set(code.match(re) ?? [])) hits.push({ file, api });
  }
  if (/from 'node:fs'|from 'fs'/.test(code) && file.startsWith('../'))
    hits.push({ file, api: 'node:fs import' });
}
const key = (h) => `${h.file}|${h.api}`;
const reviewed = new Set(REVIEWED.map(key));
const outWriterOk = (h) => OUT_WRITERS.has(h.file) && WRITERS.test(h.api);
const unlisted = hits.filter((h) => !reviewed.has(key(h)) && !outWriterOk(h));
const seen = new Set(hits.map(key));
const stale = REVIEWED.filter((r) => !seen.has(key(r)));
if (unlisted.length || stale.length) {
  console.error('bundle: the file-system audit failed.');
  for (const h of unlisted)
    console.error(
      `  UNREVIEWED  ${h.file}  ${h.api}  (read/path use that may break once bundled: review it, then list it in bundle.mjs)`,
    );
  for (const r of stale)
    console.error(
      `  STALE       ${r.file}  ${r.api}  (listed as reviewed but no longer in the code: remove it)`,
    );
  process.exit(1);
}

const info = {
  tool: JSON.parse(readFileSync(join(TOOL, 'package.json'), 'utf8')).version,
  toolName: JSON.parse(readFileSync(join(TOOL, 'package.json'), 'utf8')).name,
  builtAt: new Date().toISOString(),
  nodeTarget: NODE_TARGET,
  gitSha: git('rev-parse', 'HEAD'),
  gitDirty: git('status', '--porcelain', '--', 'packages/db', 'tools/migration')
    ? true
    : git('rev-parse', 'HEAD')
      ? false
      : null,
  files,
  embedded: {
    accessMaps: Object.fromEntries(ACCESS_FILES.map((f) => [f, sha256(accessText[f])])),
    migrations: { count: migrations.length, first: migrations[0]?.id, last: migrations.at(-1)?.id },
  },
  fsReads: REVIEWED.map(({ file, api, why }) => ({ file, api, why })),
};
writeFileSync(join(DIST, 'BUILD-INFO.json'), JSON.stringify(info, null, 2) + '\n');
for (const [n, f] of Object.entries(files))
  console.log(`${n}  ${(f.bytes / 1024 / 1024).toFixed(2)} MB  sha256 ${f.sha256}`);
console.log(
  `target ${NODE_TARGET}; fs audit: ${REVIEWED.length} reviewed reads, 0 unreviewed; ${migrations.length} migrations embedded; BUILD-INFO.json written`,
);
