#!/usr/bin/env node
/**
 * One-command iteration loop for the Waboo -> WaDesk STAGING migration. Node, no dependencies.
 *
 *   node pilot/staging/cycle.cjs <command> --client <c> [flags]       (run from tools/migration)
 *
 *   build            node pilot/staging/bundle.mjs (dist/ + BUILD-INFO.json)
 *   ship             dist/*.cjs + BUILD-INFO.json + set-owner-password.cjs + rollback-org.sql (+ the client's channel map / opening file)
 *                    to /opt/desk/migration/{bundle,dumps/<c>}, sha256 re-checked on the server
 *   init             the bundle's `init` (tool bookkeeping schema, idempotent)
 *   preflight        waboo-preflight.cjs for the client's config            [--after-init]
 *   dry              `run --dry-run`; writes out/status-<c>.json on the server (ok + unaccounted + config/bundle hash)
 *   backup           desk-backup once pre-migration-<c>, then verifies today's dump lists
 *   load             the real run. Refuses without --yes-load-into-staging, a fresh backup from today (UTC) and a matching successful dry
 *   reconcile        the bundle's `reconcile` (writes out/<c>/reconcile.{md,json} on the server)
 *   report           copies the masked reports back to _work/migration/runs/<c>/<timestamp>/
 *   update           UPDATE MODE: rows already migrated (contacts, fields, options, statuses, tags, lists, list members) are brought in line with the
 *                    current dump, changed columns only, rows edited in WaDesk since are left. Dry run unless --apply [--steps a,b]. Needs the
 *                    new dump on the server (export) and `init` once (adds migration.id_map.written_version). Never part of migrate.
 *   cutover          WhatsApp CUTOVER (load/cutover.ts), NEVER part of migrate/all-dry: connects the migrated number to WaDesk. Dry run by default (checklist +
 *                    the Meta calls, nothing written; --check-meta adds read-only Graph GETs). --apply [--confirm-org-slug S --i-switched-waboo-off
 *                    --confirm-cutover "CUT OVER S" [--webhook-base URL] [--replace-existing-override]] takes a cutover backup first; --rollback [--apply].
 *   usage-charges-append   credits catch-up after a re-export: ONLY the billing-log charges and token rows of documents not yet in id_map (never the ledger or
 *                    the wallet; wallet-sync owns the balance). One transaction, idempotent. Dry run unless --apply. Also the 'usage-append' step of migrate --catch-up.
 *   set-owner-password   password from env OWNER_NEW_PASSWORD (stdin to the server, never argv)
 *   all-dry          build, ship, preflight, dry, report
 *   migrate          ONE command per client: export, ship, preflight (+init if the schema is absent), [dry], backup, load, reconcile, report,
 *                    migration-complete. --client c --db <waboo db> --yes-load-into-staging [--from <step>] [--skip-export|--force-export]
 *                    [--with-dry-run] [--build] [--steps/--skip-steps] [--skip-dry-run-check --i-accept-no-dry-run]. Stops at the first failure and
 *                    prints the resume command; writes timings.json. Without --with-dry-run a clean dry run (or the two override flags) is required.
 *   batch            migrate for --clients a,b,c, --concurrency 1|2 (max 2), one shared build/ship/preflight, one aggregated summary
 *   new-client       writes clients/<key>.json + a channel map: --client k --name N --slug s --owner-email e --owner-name n [--plan p]
 *                    [--channel-id bot=phoneid,... | --channel-map-file <real numbers, from wa-numbers.cjs>] [--db <waboo db>]
 *   loaded-check     read-only: refuses (exit 2) when --client already has migration.run_log rows on staging
 *   migrate --catch-up   re-run for an ALREADY-loaded client whose live data moved on: forced export, ship, preflight, dry, backup, load (new rows;
 *                    credits group skipped), update (edits), files, core-load, wallet-sync, usage-append (new billing-log charges + token rows only), reconcile, report. Never flow-state, never a 2nd wallet opening.
 *   (every command prints "timing: <command> <s>s"; load also prints a per-step table)
 *
 * Server: STAGING_SERVER_ENV (default D:\wadesk-vedant\db-migration\server-access\server.env: SERVER_HOST, SERVER_USER, SSH_KEY, SERVER_APP_DIR).
 * Every server command is ONE `ssh` whose remote part runs the bundle inside the desk-api image:
 *   docker compose --env-file .env run --rm --no-deps -T --user 10001:10001 ... worker sh -c 'TARGET_DATABASE_URL="$DATABASE_URL" ...' </dev/null
 * The database URLs are expanded INSIDE the container; they are never on a command line here. Output is printed with e-mails and long digit
 * runs masked. Exit codes: 0 ok, 1 failed, 2 refused / usage.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const HERE = __dirname;
const TOOL = path.resolve(HERE, '../..');
const DIST = path.join(HERE, 'dist');
const EXPECT_DOMAIN = 'desk.wabo.ai';
const GUARD = ['--allow-docker-host', 'postgres', '--confirm-db-name', 'crm'];

class Refused extends Error {}
const refuse = (m) => {
  throw new Refused(m);
};
const shq = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const maskPII = (l) =>
  l
    .replace(/[\w.+-]+@([\w-]+\.[\w.-]+)/g, (_, d) => `***@${d}`)
    .replace(/\+?\d[\d ()-]{7,}\d/g, '***')
    .slice(0, 400);

// ---------- config -------------------------------------------------------------------------------------------------------------------
function loadServer() {
  const file =
    process.env.STAGING_SERVER_ENV || 'D:\\wadesk-vedant\\db-migration\\server-access\\server.env';
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  for (const k of ['SERVER_HOST', 'SERVER_USER', 'SSH_KEY'])
    if (!env[k]) throw new Error(`server.env is missing ${k}`);
  const app = env.SERVER_APP_DIR || '/opt/desk';
  if (!/^\/[A-Za-z0-9_./-]+$/.test(app) || app.includes('..')) refuse('SERVER_APP_DIR looks wrong');
  return {
    host: env.SERVER_HOST,
    user: env.SERVER_USER,
    key: path.resolve(path.dirname(file), env.SSH_KEY),
    app,
    mig: `${app}/migration`,
  };
}

const PLACEHOLDER = /^$|<|>|PLACEHOLDER|CHANGE.?ME/i;
function loadClient(client) {
  if (!/^[a-z0-9][a-z0-9_-]{0,40}$/.test(client || ''))
    refuse('--client must be a short lowercase key');
  const file = process.env.CYCLE_CLIENTS_DIR
    ? path.join(process.env.CYCLE_CLIENTS_DIR, `${client}.json`)
    : path.join(HERE, 'clients', `${client}.json`);
  if (!fs.existsSync(file))
    refuse(`no config ${file} (copy a template in pilot/staging/clients/ and fill it in)`);
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const k of ['orgName', 'orgSlug', 'orgPlan', 'ownerEmail', 'ownerName'])
    if (typeof c[k] !== 'string' || PLACEHOLDER.test(c[k]))
      refuse(`${path.basename(file)}: "${k}" is empty or still a placeholder`);
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(c.orgSlug))
    refuse('orgSlug must be lowercase letters, digits, dashes');
  for (const k of ['channelMap', 'creditOpening', 'coreFile'])
    if (c[k] != null && (typeof c[k] !== 'string' || PLACEHOLDER.test(c[k])))
      refuse(`"${k}" must be a local file path or null`);
  if (c.roleMapApprovals != null && !Array.isArray(c.roleMapApprovals))
    refuse('"roleMapApprovals" must be a list');
  if (
    c.extraFlags != null &&
    !(Array.isArray(c.extraFlags) && c.extraFlags.every((x) => typeof x === 'string'))
  )
    refuse('"extraFlags" must be a list of strings');
  return { ...c, client };
}
/** container path of a client input file that `ship` uploads */
const inMig = (cfg, local) => `/mig/dumps/${cfg.client}/${path.basename(local)}`;

// leads (lead_sources, lead_events, lead_events_leads) are NOT migrated by default (team decision "leads later"); "leads": "on" in the
// client config includes them. Applies to the load and to the verifier alike, and only when no explicit --steps list was given.
const LEAD_STEPS = ['lead_sources', 'lead_events', 'lead_events_leads'];
const skipWithLeads = (cfg, steps, skipSteps) => {
  const s = new Set(String(skipSteps || '').split(',').filter(Boolean));
  if (!steps && cfg.leads !== 'on') for (const x of LEAD_STEPS) s.add(x);
  return [...s].join(',');
};
function runArgs(cfg, { dry, steps, skipSteps } = {}) {
  const a = ['run', '--client', cfg.client];
  if (dry) a.push('--dry-run');
  a.push('--batch', String(cfg.batch || 250), ...GUARD);
  a.push(
    '--org-name',
    cfg.orgName,
    '--org-slug',
    cfg.orgSlug,
    '--org-plan',
    cfg.orgPlan,
    '--owner-email',
    cfg.ownerEmail,
    '--owner-name',
    cfg.ownerName,
  );
  if (cfg.defaultCc) a.push('--default-cc', String(cfg.defaultCc));
  if (cfg.channelMap) a.push('--channel-map', inMig(cfg, cfg.channelMap));
  if (cfg.creditOpening) a.push('--credit-opening', inMig(cfg, cfg.creditOpening));
  else a.push('--no-wallet');
  if (steps) a.push('--steps', String(steps));
  {
    const sk = skipWithLeads(cfg, steps, skipSteps);
    if (sk) a.push('--skip-steps', sk);
  }
  return a.concat(cfg.extraFlags || []);
}
function reconcileArgs(cfg, { steps, skipSteps } = {}) {
  const a = ['reconcile', '--client', cfg.client, '--out', '/mig/out', ...GUARD];
  if (cfg.defaultCc) a.push('--default-cc', String(cfg.defaultCc));
  if (cfg.channelMap) a.push('--channel-map', inMig(cfg, cfg.channelMap));
  if (cfg.creditOpening) a.push('--credit-opening', inMig(cfg, cfg.creditOpening));
  if (steps) a.push('--steps', String(steps));
  {
    const sk = skipWithLeads(cfg, steps, skipSteps);
    if (sk) a.push('--skip-steps', sk);
  }
  return a.concat(cfg.extraFlags || []);
}

// ---------- remote command construction (exported for the tests) -----------------------------------------------------------------------
/** docker compose run of one shell line inside the worker container (desk-api image). stdin is /dev/null: compose swallows here-docs. */
function containerRun(srv, inner, { mounts = [], env = [] } = {}) {
  const m = [
    `${srv.mig}/bundle:/mig/bundle:ro`,
    `${srv.mig}/dumps:/mig/dumps:ro`,
    `${srv.mig}/out:/mig/out`,
    ...mounts,
  ];
  return (
    `cd ${shq(srv.app)} && docker compose --env-file .env run --rm --no-deps -T --user 10001:10001 -e NODE_OPTIONS=--max-old-space-size=${/^\d{3,4}$/.test(process.env.CYCLE_NODE_HEAP_MB || '') ? process.env.CYCLE_NODE_HEAP_MB : 384}` +
    ['', ...env.map((e) => `-e ${e}`), ...m.map((v) => `-v ${shq(v)}`)].join(' ') +
    ` worker sh -c ${shq(inner)} </dev/null`
  );
}
const migrateInner = (args) =>
  `TARGET_DATABASE_URL="$DATABASE_URL" SOURCE_DUMPS_DIR=/mig/dumps exec node /mig/bundle/waboo-migrate.cjs ${args.map(shq).join(' ')}`;
const preflightInner = (args) =>
  `TARGET_DATABASE_URL="$DATABASE_URL" exec node /mig/bundle/waboo-preflight.cjs ${args.map(shq).join(' ')}`;
/** keep the exit code of `cmd` while tee-ing its output into a file on the server (POSIX sh, no pipefail) */
const teeTo = (cmd, file) =>
  `{ ${cmd} 2>&1; echo $? > ${shq(file + '.rc')}; } | tee ${shq(file)}; exit "$(cat ${shq(file + '.rc')})"`;

// ---------- ssh ------------------------------------------------------------------------------------------------------------------------
function sshSpawn(srv, remoteCmd) {
  const args = [
    '-i',
    srv.key,
    '-o',
    'BatchMode=yes',
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'ConnectTimeout=20',
    '-o',
    'ServerAliveInterval=30',
    `${srv.user}@${srv.host}`,
    remoteCmd,
  ];
  const bin = process.env.STAGING_SSH_BIN || 'ssh';
  return /\.(c|m)?js$/.test(bin)
    ? spawn(process.execPath, [bin, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
    : spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
}
/** { code, stdout, stderr }. `input` (string/Buffer) goes to stdin. `show`: print masked lines as they arrive. */
function remote(srv, cmd, { input, show } = {}) {
  return new Promise((res) => {
    const c = sshSpawn(srv, cmd);
    const out = [];
    const lines = []; // { t, line }: raw lines with arrival time (only when show), feeds the per-step timings
    let err = '';
    let tail = '';
    c.stdout.on('data', (d) => {
      out.push(d);
      if (show) {
        tail += d.toString('utf8');
        const parts = tail.split('\n');
        tail = parts.pop();
        for (const l of parts) {
          lines.push({ t: Date.now(), line: l });
          console.log('  ' + maskPII(l));
        }
      }
    });
    c.stderr.on('data', (d) => {
      if (err.length < 65536) err += d;
    });
    c.stdin.on('error', () => {});
    c.stdin.end(input || '');
    c.on('close', (code) => {
      if (show && tail) {
        lines.push({ t: Date.now(), line: tail });
        console.log('  ' + maskPII(tail));
      }
      res({
        lines,
        code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: err,
        raw: Buffer.concat(out),
      });
    });
  });
}
async function assertStaging(srv) {
  const r = await remote(srv, `cd ${shq(srv.app)} && grep ^DOMAIN= .env`);
  const m = r.stdout.match(/^DOMAIN=(.*)$/m);
  if (!m || m[1].trim() !== EXPECT_DOMAIN)
    refuse(
      `the server's DOMAIN is not ${EXPECT_DOMAIN} (this tool only loads the staging deployment)`,
    );
}
const bundleSha = async (srv) => {
  const r = await remote(srv, `sha256sum ${shq(srv.mig + '/bundle/waboo-migrate.cjs')}`);
  return r.code === 0 ? r.stdout.split(/\s+/)[0] : null;
};
const upload = (srv, remotePath, buf, mode = '600') => {
  const part = remotePath + '.part';
  return remote(
    srv,
    `umask 077; cat > ${shq(part)} && [ "$(sha256sum ${shq(part)} | cut -d' ' -f1)" = ${shq(sha(buf))} ] && mv ${shq(part)} ${shq(remotePath)} && chown 10001:10001 ${shq(remotePath)} && chmod ${mode} ${shq(remotePath)} || { rm -f ${shq(part)}; echo UPLOAD-HASH-FAIL >&2; exit 9; }`,
    { input: buf },
  );
};

// ---------- commands -------------------------------------------------------------------------------------------------------------------
const summary = (title, code) => console.log(`${title}: exit ${code}`);

async function cmdBuild() {
  const r = await new Promise((res) => {
    const c = spawn(process.execPath, [path.join(HERE, 'bundle.mjs')], {
      cwd: TOOL,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let o = '';
    c.stdout.on('data', (d) => (o += d));
    c.stderr.on('data', (d) => (o += d));
    c.on('close', (code) => res({ code, o }));
  });
  console.log(r.o.trim().split('\n').slice(-12).join('\n'));
  if (fs.existsSync(path.join(DIST, 'BUILD-INFO.json'))) {
    const b = JSON.parse(fs.readFileSync(path.join(DIST, 'BUILD-INFO.json'), 'utf8'));
    console.log(`bundle: gitSha=${String(b.gitSha).slice(0, 10)} gitDirty=${b.gitDirty}`);
  }
  summary('build', r.code);
  return r.code === 0 ? 0 : 1;
}

async function cmdShip(srv, cfg, { skipBundle } = {}) {
  await assertStaging(srv);
  const files = skipBundle ? [] : [
    [path.join(DIST, 'waboo-migrate.cjs'), 'bundle/waboo-migrate.cjs'],
    [path.join(DIST, 'waboo-preflight.cjs'), 'bundle/waboo-preflight.cjs'],
    [path.join(DIST, 'BUILD-INFO.json'), 'bundle/BUILD-INFO.json'],
    [path.join(HERE, 'set-owner-password.cjs'), 'bundle/set-owner-password.cjs'],
    [path.join(HERE, 'rollback-org.sql'), 'bundle/rollback-org.sql'],
    // the media copy (Waboo urls -> the app's object store, see pilot/files/copy-files.cjs); runs in the desk-api image, which has `pg`
    [path.join(HERE, '..', 'files', 'copy-files.cjs'), 'files/copy-files.cjs'],
  ];
  if (cfg) {
    if (cfg.channelMap)
      files.push([cfg.channelMap, `dumps/${cfg.client}/${path.basename(cfg.channelMap)}`]);
    if (cfg.creditOpening)
      files.push([cfg.creditOpening, `dumps/${cfg.client}/${path.basename(cfg.creditOpening)}`]);
    // geta_core facts of this client (plan, subscription, business), written by core-opening.cjs; read by the core-load command
    if (cfg.coreFile) files.push([cfg.coreFile, `dumps/${cfg.client}/core.json`]);
  }
  for (const [l] of files)
    if (!fs.existsSync(l)) refuse(`${l} does not exist (run "build" first / fix the config path)`);
  const dirs = ['bundle', 'dumps', 'out', 'files', ...(cfg ? [`dumps/${cfg.client}`] : [])]
    .map((d) => shq(`${srv.mig}/${d}`))
    .join(' ');
  const p = await remote(
    srv,
    `umask 077; mkdir -p ${dirs} && chown 10001:10001 ${shq(srv.mig)} ${dirs} && chmod 700 ${shq(srv.mig)} ${dirs}`,
  );
  if (p.code !== 0) {
    console.log('ship: could not prepare the server folders');
    return 1;
  }
  let bad = 0;
  for (const [l, r] of files) {
    const buf = fs.readFileSync(l);
    const u = await upload(srv, `${srv.mig}/${r}`, buf);
    console.log(
      `  ${r}: ${u.code === 0 ? 'ok' : 'FAILED'} ${buf.length} bytes sha256 ${sha(buf).slice(0, 12)}${u.code === 0 ? ' (verified on the server)' : ''}`,
    );
    if (u.code !== 0) bad++;
  }
  let extra = 0;
  if (cfg) {
    // which hosts the client's media may come from (an allow-list: the copy refuses any other host); Waboo's own asset host by default
    const conf = Buffer.from(JSON.stringify({ allowedHosts: cfg.mediaHosts || ['assets.getalabs.com'], maxFileMB: 50, timeoutMs: 60000 }) + '\n');
    const u = await upload(srv, `${srv.mig}/files/files-${cfg.client}.json`, conf);
    console.log(`  files/files-${cfg.client}.json: ${u.code === 0 ? 'ok' : 'FAILED'} ${conf.length} bytes`);
    extra = 1;
    if (u.code !== 0) bad++;
  }
  summary(`ship (${files.length + extra - bad}/${files.length + extra} files)`, bad ? 1 : 0);
  return bad ? 1 : 0;
}

async function runShown(srv, cmd, label, outName) {
  const r = await remote(srv, outName ? teeTo(cmd, `${srv.mig}/out/${outName}`) : cmd, {
    show: true,
  });
  if (r.code === 255 || (r.code !== 0 && r.stderr))
    console.log('  ' + maskPII(r.stderr.trim().split('\n').slice(-3).join(' | ')));
  summary(label, r.code);
  return r;
}

async function cmdPreflight(srv, cfg, flags, ctx = {}) {
  await assertStaging(srv);
  const a = [
    '--org-slug',
    cfg.orgSlug,
    '--client',
    cfg.client,
    '--org-plan',
    cfg.orgPlan,
    ...GUARD,
  ];
  if (flags['after-init']) a.push('--after-init');
  const r = await runShown(
    srv,
    containerRun(srv, preflightInner(a)),
    'preflight',
    `preflight-${cfg.client}.txt`,
  );
  ctx.out = r.stdout;
  return r.code === 0 ? 0 : 1;
}
async function cmdInit(srv) {
  await assertStaging(srv);
  const r = await runShown(srv, containerRun(srv, migrateInner(['init', ...GUARD])), 'init');
  return r.code === 0 ? 0 : 1;
}

const configHash = (cfg) => sha(JSON.stringify(runArgs(cfg, { dry: false })));
async function cmdDry(srv, cfg, flags = {}) {
  await assertStaging(srv);
  const bsha = await bundleSha(srv);
  if (!bsha) refuse('no bundle on the server: run "ship" first');
  const r = await runShown(
    srv,
    containerRun(
      srv,
      migrateInner(
        runArgs(cfg, { dry: true, steps: flags.steps, skipSteps: flags['skip-steps'] }),
      ),
    ),
    'dry run',
    `dry-run-${cfg.client}.txt`,
  );
  const un = [...r.stdout.matchAll(/unaccounted\D{0,8}(\d+)/gi)].reduce(
    (s, m) => s + Number(m[1]),
    0,
  );
  const rolled = /dry run, rolled back/.test(r.stdout);
  const ok = r.code === 0 && rolled && un === 0;
  const status = {
    client: cfg.client,
    kind: 'dry',
    at: new Date().toISOString(),
    ok,
    exit: r.code,
    rolledBack: rolled,
    unaccounted: un,
    configSha: configHash(cfg),
    bundleSha: bsha,
  };
  await remote(srv, `umask 077; cat > ${shq(srv.mig + '/out/status-' + cfg.client + '.json')}`, {
    input: JSON.stringify(status, null, 2),
  });
  console.log(
    `dry status: ${ok ? 'OK' : 'NOT OK'} (rolled back: ${rolled}, unaccounted: ${un}); recorded on the server for "load"`,
  );
  return ok ? 0 : 1;
}

async function freshBackup(srv, client) {
  const r = await remote(
    srv,
    `f=$(ls -1t ${shq(srv.app + '/backups')}/desk-pre-migration-${client}-$(date -u +%Y%m%d)T*.dump 2>/dev/null | head -1); [ -n "$f" ] && echo "$(basename "$f") $(stat -c %s "$f")"`,
  );
  const m = r.stdout.trim().match(/^(desk-pre-migration-\S+\.dump) (\d+)$/);
  return m && Number(m[2]) > 10000 ? { name: m[1], size: Number(m[2]) } : null;
}
async function cmdBackup(srv, cfg) {
  await assertStaging(srv);
  const r = await remote(
    srv,
    `cd ${shq(srv.app)} && docker compose --env-file .env exec -T backup desk-backup once pre-migration-${cfg.client} </dev/null`,
    { show: true },
  );
  const b = await freshBackup(srv, cfg.client);
  if (r.code !== 0 || !b) {
    summary('backup (no fresh dump found)', 1);
    return 1;
  }
  const l = await remote(
    srv,
    `cd ${shq(srv.app)} && docker compose --env-file .env exec -T backup pg_restore --list /backups/${b.name} </dev/null`,
  );
  const entries = l.stdout.split('\n').filter((x) => x && !x.startsWith(';')).length;
  console.log(`backup: ${b.name} ${b.size} bytes, pg_restore --list shows ${entries} entries`);
  summary('backup', l.code === 0 && entries > 0 ? 0 : 1);
  return l.code === 0 && entries > 0 ? 0 : 1;
}

async function cmdLoad(srv, cfg, flags, ctx = {}) {
  if (!flags['yes-load-into-staging'])
    refuse('load writes into the staging database: pass --yes-load-into-staging');
  await assertStaging(srv);
  const b = await freshBackup(srv, cfg.client);
  if (!b)
    refuse(
      `no backup from today (UTC) named desk-pre-migration-${cfg.client}-<today>T*.dump: run "backup" first`,
    );
  if (flags['skip-dry-run-check']) {
    // explicit operator override on STAGING only (user decision 2026-10-09): needs both flags; the backup check above still applies
    if (!flags['i-accept-no-dry-run'])
      refuse('--skip-dry-run-check also needs --i-accept-no-dry-run (you are loading without a clean dry run)');
    console.log(
      `load: backup ${b.name}; NO DRY RUN CHECK (explicit override). If this fails halfway: re-run to resume, or roll the org back with rollback-org.sql`,
    );
  } else {
    const s = await remote(srv, `cat ${shq(srv.mig + '/out/status-' + cfg.client + '.json')}`);
    let st = null;
    try {
      st = JSON.parse(s.stdout);
    } catch {
      /* none */
    }
    if (!st || st.kind !== 'dry') refuse('no dry run recorded for this client: run "dry" first');
    if (!st.ok || st.unaccounted !== 0)
      refuse(
        `the last dry run did not succeed with unaccounted 0 (ok=${st.ok}, unaccounted=${st.unaccounted})`,
      );
    if (st.configSha !== configHash(cfg))
      refuse('the client config changed since the last dry run: run "dry" again');
    if (st.bundleSha !== (await bundleSha(srv)))
      refuse('the bundle on the server changed since the last dry run: run "dry" again');
    console.log(`load: backup ${b.name}, dry run ${st.at} OK; going ahead`);
  }
  const t0 = Date.now();
  const r = await runShown(
    srv,
    containerRun(
      srv,
      migrateInner(runArgs(cfg, { dry: false, steps: flags.steps, skipSteps: flags['skip-steps'] })),
    ),
    'load',
    `run-${cfg.client}.txt`,
  );
  ctx.steps = stepStats(r.lines, t0);
  printStepStats(ctx.steps);
  return r.code === 0 ? 0 : 1;
}

async function cmdReconcile(srv, cfg, flags = {}) {
  await assertStaging(srv);
  const r = await runShown(
    srv,
    containerRun(srv, migrateInner(reconcileArgs(cfg, { steps: flags.steps, skipSteps: flags['skip-steps'] }))),
    'reconcile',
    `reconcile-${cfg.client}.txt`,
  );
  if (r.code !== 0 && flags.alarmsOk) {
    // inside the migrate chain: alarms alone (the known categories, listed in the report) must not stop it before the report is written.
    // Anything unaccounted or any integrity error still stops it. pipeline.cjs turns this into an amber verdict.
    const m = /unaccounted (\d+), alarms (\d+), integrity (\d+)/.exec(String(r.stdout || ''));
    if (m && Number(m[1]) === 0 && Number(m[3]) === 0) {
      console.log(`reconcile: ${m[2]} alarm(s) to review, nothing unaccounted, no integrity error: the chain goes on (amber)`);
      return 0;
    }
  }
  return r.code === 0 ? 0 : 1;
}

/** Publish and activate the flows that are live in Waboo (separate from the load, which imports every flow inert). Dry run unless --apply. */
async function cmdFlowState(srv, cfg, flags = {}) {
  await assertStaging(srv);
  const a = ['flow-state', '--client', cfg.client, '--org-slug', cfg.orgSlug, ...GUARD];
  if (flags.apply) a.push('--apply', '--confirm-org-slug', cfg.orgSlug);
  const r = await runShown(srv, containerRun(srv, migrateInner(a)), flags.apply ? 'flow-state (APPLY)' : 'flow-state (dry run)', `flow-state-${cfg.client}.txt`);
  return r.code === 0 ? 0 : 1;
}

/** Update mode (load/update.ts): compare every migrated row of the opted-in steps with the current dump and update what changed. Dry run unless --apply. */
async function cmdUpdate(srv, cfg, flags = {}) {
  await assertStaging(srv);
  const a = ['update', '--client', cfg.client, '--org-slug', cfg.orgSlug, '--batch', String(cfg.batch || 250), ...GUARD];
  if (cfg.defaultCc) a.push('--default-cc', String(cfg.defaultCc));
  if (flags.steps) a.push('--steps', String(flags.steps));
  if (flags.apply) a.push('--apply', '--confirm-org-slug', cfg.orgSlug);
  const r = await runShown(srv, containerRun(srv, migrateInner(a)), flags.apply ? 'update (APPLY)' : 'update (dry run)', `update-${cfg.client}.txt`);
  return r.code === 0 ? 0 : 1;
}

/** Re-read the migrated knowledge-base pages: kb-reingest emits the app's ai_training_source.requested event, so the WaDesk worker makes OUTBOUND requests to the client site. Never part of migrate. Dry run unless --apply. */
async function cmdKbReingest(srv, cfg, flags = {}) {
  await assertStaging(srv);
  const a = ['kb-reingest', '--client', cfg.client, '--org-slug', cfg.orgSlug, ...GUARD];
  if (flags.apply) a.push('--apply', '--confirm-org-slug', cfg.orgSlug);
  const r = await runShown(srv, containerRun(srv, migrateInner(a)), flags.apply ? 'kb-reingest (APPLY)' : 'kb-reingest (dry run)', `kb-reingest-${cfg.client}.txt`);
  return r.code === 0 ? 0 : 1;
}

/** Newest backup taken for the cutover (`desk-backup once pre-cutover-<client>`): { name, epoch } or null. The tool runs in a container and cannot see the backups folder, so the host side finds it. */
async function cutoverBackup(srv, client) {
  const r = await remote(
    srv,
    `f=$(ls -1t ${shq(srv.app + '/backups')}/desk-pre-cutover-${client}-*.dump 2>/dev/null | head -1); [ -n "$f" ] && echo "$(basename "$f") $(stat -c %Y "$f") $(stat -c %s "$f")"`,
  );
  const m = r.stdout.trim().match(/^(desk-pre-cutover-\S+\.dump) (\d+) (\d+)$/);
  return m && Number(m[3]) > 10000 ? { name: m[1], epoch: Number(m[2]) } : null;
}

/**
 * WhatsApp cutover (load/cutover.ts): connects the migrated number to WaDesk. NEVER part of migrate or all-dry. Dry run by default (reads only,
 * no Meta call unless --check-meta). --apply takes a fresh cutover backup first, then needs the operator's own --confirm-org-slug,
 * --i-switched-waboo-off and --confirm-cutover "CUT OVER <slug>" (nothing is filled in for them). --rollback [--apply] is the way back.
 */
async function cmdCutover(srv, cfg, flags = {}) {
  await assertStaging(srv);
  const writes = Boolean(flags.apply);
  if (writes && !flags.rollback) {
    const t = await remote(srv, `cd ${shq(srv.app)} && docker compose --env-file .env exec -T backup desk-backup once pre-cutover-${cfg.client} </dev/null`, { show: true });
    if (t.code !== 0) refuse('cutover: the backup before the cutover failed; nothing else was done');
  }
  const b = await cutoverBackup(srv, cfg.client);
  const a = ['cutover', '--client', cfg.client, '--org-slug', cfg.orgSlug, '--out', '/mig/out', ...GUARD];
  if (b) a.push('--backup-file', b.name, '--backup-epoch', String(b.epoch));
  if (flags.rollback) a.push('--rollback');
  if (writes) a.push('--apply');
  for (const f of ['confirm-org-slug', 'confirm-cutover', 'webhook-base']) if (flags[f] !== undefined) a.push(`--${f}`, String(flags[f]));
  for (const f of ['check-meta', 'i-switched-waboo-off', 'replace-existing-override']) if (flags[f]) a.push(`--${f}`);
  const label = `cutover${flags.rollback ? ' rollback' : ''} (${writes ? 'APPLY' : 'dry run'})`;
  const r = await runShown(srv, containerRun(srv, migrateInner(a)), label, `cutover-${cfg.client}.txt`);
  return r.code === 0 ? 0 : 1;
}

/** Re-read the saved bot payloads of migrated messages that were stored with an empty body (interactive messages): text, buttons kept, header file url. Reads the database only. Dry run unless --apply. */
async function cmdChatReparse(srv, cfg, flags = {}) {
  await assertStaging(srv);
  const a = ['chat-reparse', '--client', cfg.client, '--org-slug', cfg.orgSlug, ...GUARD];
  if (flags.apply) a.push('--apply', '--confirm-org-slug', cfg.orgSlug);
  const r = await runShown(srv, containerRun(srv, migrateInner(a)), flags.apply ? 'chat-reparse (APPLY)' : 'chat-reparse (dry run)', `chat-reparse-${cfg.client}.txt`);
  return r.code === 0 ? 0 : 1;
}

/** Give the conversations an earlier load wrote with contact_id NULL the contact the planner resolves now (single match only; never overwrites). Reads the dump and the database. Dry run unless --apply. */
async function cmdChatRelink(srv, cfg, flags = {}) {
  await assertStaging(srv);
  const a = ['chat-relink', '--client', cfg.client, '--org-slug', cfg.orgSlug, ...GUARD];
  if (cfg.channelMap) a.push('--channel-map', inMig(cfg, cfg.channelMap));
  if (flags.apply) a.push('--apply', '--confirm-org-slug', cfg.orgSlug);
  const r = await runShown(srv, containerRun(srv, migrateInner(a)), flags.apply ? 'chat-relink (APPLY)' : 'chat-relink (dry run)', `chat-relink-${cfg.client}.txt`);
  return r.code === 0 ? 0 : 1;
}

/** Give the campaigns an earlier load wrote with template_id NULL their wa_templates row (exact matches only: template id + name + Meta id, see broadcast/template-link.ts). Reads the dump and the database. Dry run unless --apply. */
async function cmdCampaignLink(srv, cfg, flags = {}) {
  await assertStaging(srv);
  const a = ['campaign-link', '--client', cfg.client, '--org-slug', cfg.orgSlug, ...GUARD];
  if (flags.apply) a.push('--apply', '--confirm-org-slug', cfg.orgSlug);
  const r = await runShown(srv, containerRun(srv, migrateInner(a)), flags.apply ? 'campaign-link (APPLY)' : 'campaign-link (dry run)', `campaign-link-${cfg.client}.txt`);
  return r.code === 0 ? 0 : 1;
}

/** Bring the wallet to the current Waboo balance (geta_core, from the core.json snapshot) with one new ledger row. Dry run unless --apply. */
async function cmdWalletSync(srv, cfg, flags = {}) {
  await assertStaging(srv);
  const a = ['wallet-sync', '--client', cfg.client, '--org-slug', cfg.orgSlug, ...GUARD];
  if (flags.apply) a.push('--apply', '--confirm-org-slug', cfg.orgSlug);
  const r = await runShown(srv, containerRun(srv, migrateInner(a)), flags.apply ? 'wallet-sync (APPLY)' : 'wallet-sync (dry run)', `wallet-sync-${cfg.client}.txt`);
  return r.code === 0 ? 0 : 1;
}

/**
 * Credits catch-up after a re-export: loads ONLY the usage charges (usage_charges + usage_charge_keys) and token rows (ai_token_usage) of source
 * documents not yet in migration.id_map. Never the wallet ledger, never wallets (that is wallet-sync). One transaction; dry run unless --apply.
 */
async function cmdUsageAppend(srv, cfg, flags = {}) {
  await assertStaging(srv);
  const a = ['usage-charges-append', '--client', cfg.client, '--org-slug', cfg.orgSlug, ...GUARD];
  if (flags.apply) a.push('--apply', '--confirm-org-slug', cfg.orgSlug);
  const r = await runShown(srv, containerRun(srv, migrateInner(a)), flags.apply ? 'usage-charges-append (APPLY)' : 'usage-charges-append (dry run)', `usage-charges-append-${cfg.client}.txt`);
  return r.code === 0 ? 0 : 1;
}

/**
 * Media copy: every file a migrated message still references by a Waboo url is downloaded (allow-listed host, https only) and stored in
 * the app's object store under `chat/<org id>/waboo/...` (the only key shape the app serves), then messages.media_* is set.
 * sub: plan | copy | verify. copy is a dry run unless flags.apply. Runs after the load, so the messages exist.
 */
async function cmdFiles(srv, cfg, sub, flags = {}) {
  await assertStaging(srv);
  const a = [sub, '--org-slug', cfg.orgSlug, '--confirm-db-name', 'crm', '--allow-docker-host', 'postgres', '--config', `/mig/files/files-${cfg.client}.json`, '--state', `/mig/out/files-${cfg.client}.state.jsonl`];
  if (sub === 'copy') a.push('--max-files', '5000', '--max-gb', '10', '--concurrency', '3', ...(flags.apply ? ['--apply', '--confirm-org-slug', cfg.orgSlug] : []));
  const inner = `NODE_PATH=/app/node_modules TARGET_DATABASE_URL="$DATABASE_URL" exec node /mig/files/copy-files.cjs ${a.map(shq).join(' ')}`;
  const label = `files ${sub}${sub === 'copy' ? (flags.apply ? ' (APPLY)' : ' (dry run)') : ''}`;
  const r = await runShown(srv, containerRun(srv, inner, { mounts: [`${srv.mig}/files:/mig/files:ro`] }), label, `files-${sub}-${cfg.client}.txt`);
  return r.code === 0 ? 0 : 1;
}

/** geta_core -> plan, subscription, business facts and the role grants of the loaded roles. Dry run unless --apply. */
async function cmdCoreLoad(srv, cfg, flags = {}) {
  await assertStaging(srv);
  const a = ['core-load', '--client', cfg.client, '--org-slug', cfg.orgSlug, ...GUARD];
  if (flags.apply) a.push('--apply', '--confirm-org-slug', cfg.orgSlug);
  const r = await runShown(
    srv,
    containerRun(srv, migrateInner(a)),
    flags.apply ? 'core-load (APPLY)' : 'core-load (dry run)',
    `core-load-${cfg.client}.txt`,
  );
  return r.code === 0 ? 0 : 1;
}

/**
 * Platform pricing (geta_core credits_mapping_new -> GLOBAL message_rates). Dry run by default. --apply runs the dry run first, reads the
 * number of new rows from it and types the tool's confirmation phrase (SEED <n> message_rates geta_core): the operator who passes
 * --apply is the one confirming. Factor 1 and the margin added: confirmed 2026-10-12 (Waboo prices are INR per message, charge = price + margin).
 */
async function cmdPricingSeed(srv, flags = {}) {
  await assertStaging(srv);
  const base = ['pricing-seed', '--client', 'geta_core', ...GUARD, '--factor', '1', '--with-margin', '--skip-conflicts'];
  const dry = await runShown(srv, containerRun(srv, migrateInner(base)), 'pricing-seed (dry run)', 'pricing-seed-geta_core.txt');
  if (dry.code !== 0 || !flags.apply) return dry.code === 0 ? 0 : 1;
  const m = /(\d+) new,/.exec(dry.stdout);
  if (!m) refuse('pricing-seed: could not read the number of new rows from the dry run');
  const phrase = `SEED ${m[1]} message_rates geta_core`;
  const cmd = containerRun(srv, migrateInner([...base, '--apply'])).replace(/ <\/dev\/null$/, ` <<< ${shq(phrase)}`);
  const r = await runShown(srv, cmd, 'pricing-seed (APPLY)', 'pricing-seed-geta_core-apply.txt');
  return r.code === 0 ? 0 : 1;
}

async function cmdReport(srv, cfg, ctx = {}) {
  const dir = ctx.dir || runDir(cfg.client);
  fs.mkdirSync(dir, { recursive: true });
  const want = [
    [`out/${cfg.client}/reconcile.json`, 'reconcile.json'],
    [`out/${cfg.client}/reconcile.md`, 'reconcile.md'],
    [`out/dry-run-${cfg.client}.txt`, 'dry-run.txt'],
    [`out/run-${cfg.client}.txt`, 'run.txt'],
    [`out/preflight-${cfg.client}.txt`, 'preflight.txt'],
    [`out/status-${cfg.client}.json`, 'status.json'],
    [`dumps/${cfg.client}/manifest.json`, 'manifest.json'],
    ['bundle/BUILD-INFO.json', 'BUILD-INFO.json'],
  ];
  const got = [];
  for (const [r, l] of want) {
    const x = await remote(srv, `cat ${shq(srv.mig + '/' + r)}`);
    if (x.code === 0 && x.raw.length) {
      fs.writeFileSync(path.join(dir, l), x.raw);
      got.push(l);
    }
  }
  console.log(`report: ${got.length} files -> ${dir}: ${got.join(', ') || 'none'}`);
  const j = path.join(dir, 'reconcile.json');
  if (fs.existsSync(j)) {
    const r = JSON.parse(fs.readFileSync(j, 'utf8'));
    const np = r.notPresent || {};
    console.log(
      `  reconcile result: ${r.result ?? r.status ?? '?'}; NOT PRESENT: ${Object.entries(np)
        .map(([k, v]) => `${k}=${Array.isArray(v) ? v.length : v}`)
        .join(', ')}`,
    );
    console.log(
      '  log what is missing in WaDesk in D:\\wadesk-vedant\\_work\\migration\\missing-in-wadesk-log.md',
    );
  }
  const dry = path.join(dir, 'dry-run.txt');
  if (fs.existsSync(dry)) {
    const w = fs
      .readFileSync(dry, 'utf8')
      .split('\n')
      .filter((l) => /WARNING|unaccounted|done:|quarantin/i.test(l));
    console.log(`  dry-run lines of interest (${w.length}):`);
    for (const l of w.slice(0, 25)) console.log('    ' + maskPII(l));
  }
  summary('report', got.length ? 0 : 1);
  return got.length ? 0 : 1;
}

/**
 * Is this client already loaded? Read-only: a node one-liner in the worker container counts its migration.run_log rows. Exit 2 (refused) when
 * it is, so the caller never writes a NEW channel map for a client whose conversation keys were derived from the old one.
 */
async function cmdLoadedCheck(srv, client) {
  await assertStaging(srv);
  const js =
    "const {Client}=require('pg');(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();" +
    "const r=await c.query(\"SELECT CASE WHEN to_regclass('migration.run_log') IS NULL THEN 0 ELSE (SELECT count(*) FROM migration.run_log WHERE source_client=$1) END AS n\",[process.argv[1]]);" +
    "console.log('LOADED_ROWS '+r.rows[0].n);await c.end()})().catch(e=>{console.error(e.message);process.exit(1)})";
  const r = await remote(srv, containerRun(srv, `NODE_PATH=/app/node_modules exec node -e ${shq(js)} ${shq(client)}`));
  const m = r.stdout.match(/LOADED_ROWS (\d+)/);
  if (r.code !== 0 || !m) {
    console.log('loaded-check: could not read the staging database');
    return 1;
  }
  console.log(`loaded-check: ${client}: ${m[1]} migration.run_log row(s)`);
  if (Number(m[1]) > 0) refuse(`${client} is already loaded on staging: its channel map is part of its conversation keys and must not change`);
  return 0;
}

async function cmdOwnerPassword(srv, cfg) {
  const pw = process.env.OWNER_NEW_PASSWORD;
  if (!pw)
    refuse('set OWNER_NEW_PASSWORD in your shell (it is sent over stdin, never on a command line)');
  await assertStaging(srv);
  const inner = `TARGET_DATABASE_URL="$DATABASE_URL" exec node /app/set-owner-password.cjs ${['--org-slug', cfg.orgSlug, '--email', cfg.ownerEmail, '--confirm-db-name', 'crm', '--allow-docker-host', 'postgres'].map(shq).join(' ')}`;
  const cmd = `IFS= read -r OWNER_NEW_PASSWORD; export OWNER_NEW_PASSWORD; ${containerRun(srv, inner, { mounts: [`${srv.mig}/bundle/set-owner-password.cjs:/app/set-owner-password.cjs:ro`], env: ['OWNER_NEW_PASSWORD'] })}`;
  const r = await remote(srv, cmd, { input: pw + '\n', show: true });
  summary('set-owner-password', r.code);
  return r.code === 0 ? 0 : 1;
}

// ---------- timing ---------------------------------------------------------------------------------------------------------------------
const secs = (ms) => Math.round(ms / 100) / 10;
const runsRoot = () => process.env.CYCLE_RUNS_DIR || 'D:\\wadesk-vedant\\_work\\migration\\runs';
const runDir = (client) =>
  path.join(runsRoot(), client, new Date().toISOString().replace(/[:.]/g, '-'));
/** the newest run folder of a client that already holds a fetched reconcile.json (what the migration-complete generator reads) */
function newestReportDir(client) {
  const d = path.join(runsRoot(), client);
  if (!fs.existsSync(d)) return null;
  const names = fs
    .readdirSync(d, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(d, e.name, 'reconcile.json')))
    .map((e) => e.name)
    .sort();
  return names.length ? path.join(d, names[names.length - 1]) : null;
}
async function timed(name, fn) {
  const t = Date.now();
  try {
    return await fn();
  } finally {
    console.log(`timing: ${name} ${secs(Date.now() - t)}s`);
  }
}
/**
 * Per-step stats from the load transcript. A step line is printed when the step ends: `  <handler> {"read":..,"migrated":..,...}`, so the
 * seconds of a step = arrival time of its line minus the previous one (the first step also carries the start-up and source indexing).
 * "already done" lines (resume) cost 0 s and keep the earlier counts.
 */
function stepStats(lines, t0) {
  const out = [];
  let prev = t0;
  for (const { t, line } of lines || []) {
    const m = line.match(/^\s{2}(\w+)\s+(?:already done \()?(\{.*\})\)?\s*$/);
    if (!m) continue;
    let c;
    try {
      c = JSON.parse(m[2]);
    } catch {
      continue;
    }
    if (typeof c.read !== 'number') continue;
    const resumed = /already done/.test(line);
    out.push({
      step: m[1],
      seconds: resumed ? 0 : secs(t - prev),
      read: c.read,
      migrated: c.migrated ?? 0,
      quarantined: c.quarantined ?? 0,
      excluded: c.excluded ?? 0,
      resumed,
    });
    if (!resumed) prev = t;
  }
  return out;
}
const rate = (s) => (s.seconds > 0 && s.migrated ? Math.round(s.migrated / s.seconds) : '');
function printStepStats(steps) {
  if (!steps || !steps.length) return;
  console.log('  step timings (seconds, rows migrated, quarantined, excluded, rows/s):');
  for (const s of steps)
    console.log(
      `    ${s.step.padEnd(18)} ${String(s.seconds).padStart(8)}s ${String(s.migrated).padStart(8)} ${String(s.quarantined).padStart(6)} ${String(s.excluded).padStart(6)} ${String(rate(s)).padStart(6)}${s.resumed ? ' (already done)' : ''}`,
    );
}

// ---------- orchestration: migrate / batch / new-client -------------------------------------------------------------------------------
// core-load (plan, subscription, role grants from geta_core) and flow-state (publish what is live in Waboo) run after the load and before the verifier
const MIG_STEPS = ['export', 'ship', 'preflight', 'dry', 'backup', 'load', 'update', 'files', 'core-load', 'wallet-sync', 'usage-append', 'flow-state', 'reconcile', 'report', 'complete'];
/** steps that only make sense for a client that is ALREADY loaded: --catch-up adds them; a fresh load never runs them (a fresh load reads everything once) */
const CATCHUP_ONLY = new Set(['update', 'usage-append']);
/** steps a catch-up refuses: flow-state would publish flows again (the flows are already live) */
const CATCHUP_SKIPPED = new Set(['flow-state']);
/** free memory (MB, MemAvailable) the server must have: one migrate container uses up to ~400 MB next to the live stack and the 1 GB Postgres */
const MIN_FREE_MB = { 1: 700, 2: 1200 };
const MAX_CONCURRENCY = 2;
const MAX_DUMP_AGE_H = 24; // an export on the server younger than this is reused by migrate
const KIT_EXPORT =
  'D:\\wadesk-vedant\\db-migration\\geta-mongodb-read-replica-prod\\geta-mongodb-read-replica-prod\\bin\\mongo-export.cjs';
const memCmd = () =>
  process.env.CYCLE_MEM_CMD || `awk '/^MemAvailable:/{printf "%d\\n", $2/1024}' /proc/meminfo`;

async function requireFreeMem(srv, conc) {
  const need = MIN_FREE_MB[conc];
  const r = await remote(srv, memCmd());
  const mb = parseInt(r.stdout.trim(), 10);
  if (r.code !== 0 || !Number.isFinite(mb)) refuse('could not read the free memory of the server (/proc/meminfo)');
  if (mb < need)
    refuse(
      `only ${mb} MB of memory available on the server, ${need} MB needed for ${conc} migrate container(s) (Postgres is capped at 1 GB): free memory first (see "Memory" in the runbook)`,
    );
  console.log(`memory: ${mb} MB available on the server (minimum ${need} MB for ${conc} at a time)`);
}

/** a fresh, complete export already on the server: manifest.json younger than MAX_DUMP_AGE_H and every file at the size it lists */
async function manifestFresh(srv, client) {
  const d = `${srv.mig}/dumps/${client}`;
  const r = await remote(
    srv,
    `cd ${shq(d)} 2>/dev/null && cat manifest.json && for f in *.ndjson; do [ -e "$f" ] && echo "@@S $f $(stat -c %s "$f")"; done; true`,
  );
  const i = r.stdout.indexOf('@@S ');
  let m;
  try {
    m = JSON.parse(i < 0 ? r.stdout : r.stdout.slice(0, i));
  } catch {
    return { ok: false, msg: 'no manifest.json on the server' };
  }
  const sizes = new Map(
    (i < 0 ? '' : r.stdout.slice(i))
      .split('\n')
      .map((l) => l.match(/^@@S (\S+) (\d+)$/))
      .filter(Boolean)
      .map((x) => [x[1], Number(x[2])]),
  );
  const cols = Array.isArray(m.collections) ? m.collections : [];
  if (!cols.length) return { ok: false, msg: 'the manifest on the server lists no collections' };
  const bad = cols.filter((c) => sizes.get(`${c.collection}.ndjson`) !== c.bytes);
  if (bad.length) return { ok: false, msg: `${bad.length} file(s) on the server differ from the manifest` };
  const ageH = (Date.now() - Date.parse(m.generatedAt)) / 36e5;
  if (!(ageH < MAX_DUMP_AGE_H))
    return { ok: false, msg: `the manifest is older than ${MAX_DUMP_AGE_H} h (the Waboo data may have moved on)` };
  const docs = cols.reduce((s, c) => s + (c.docs || 0), 0);
  return {
    ok: true,
    msg: `${cols.length} collections, ${docs} documents, written ${ageH.toFixed(1)} h ago, all files match (--force-export to re-export)`,
  };
}

const exportArgs = (client, db, force = false) => [
  '--db',
  db,
  '--client',
  client,
  '--to-ssh',
  '--i-confirm-server-is-staging',
  '--registry-classes',
  'MIGRATE,MIGRATE_LATER',
  ...(force ? ['--force'] : []), // without it the exporter keeps a server file whose record matches, even when Waboo has moved on
];
function runExport(client, db, force = false) {
  const bin = process.env.MONGO_EXPORT_BIN || KIT_EXPORT;
  if (!fs.existsSync(bin)) refuse(`the exporter ${bin} does not exist (set MONGO_EXPORT_BIN)`);
  return new Promise((res) => {
    const c = spawn(process.execPath, [bin, ...exportArgs(client, db, force)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const s of [c.stdout, c.stderr]) {
      let tail = '';
      s.on('data', (d) => {
        tail += d.toString('utf8');
        const p = tail.split('\n');
        tail = p.pop();
        for (const l of p) console.log('  export: ' + maskPII(l));
      });
      s.on('close', () => tail && console.log('  export: ' + maskPII(tail)));
    }
    c.on('error', () => res(1));
    c.on('close', (code) => {
      summary('export', code);
      res(code === 0 ? 0 : 1);
    });
  });
}

function runComplete(client) {
  const bin = process.env.CYCLE_COMPLETE_BIN || path.join(TOOL, 'pilot', 'report', 'migration-complete.cjs');
  return new Promise((res) => {
    const c = spawn(
      process.execPath,
      [bin, '--runs', runsRoot(), '--out', path.dirname(runsRoot()), '--clients', client],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    for (const s of [c.stdout, c.stderr]) s.on('data', (d) => process.stdout.write('  complete: ' + d));
    c.on('error', () => res(1));
    c.on('close', (code) => {
      summary('migration-complete', code);
      res(code === 0 ? 0 : 1);
    });
  });
}

/** preflight; when it says the tool's migration schema is absent: init, then preflight --after-init */
async function preflightWithInit(srv, cfg) {
  const c = {};
  let code = await cmdPreflight(srv, cfg, {}, c);
  if (code === 0 && /absent: needs `init`/.test(c.out || '')) {
    console.log('preflight: the migration schema is absent: running init, then preflight --after-init');
    code = await cmdInit(srv);
    if (code === 0) code = await cmdPreflight(srv, cfg, { 'after-init': true });
  }
  return code;
}

const plain = (v) => (/^[\w.,=:/-]+$/.test(v) ? v : shq(v));
/** the exact command that continues a stopped migrate at `from` (same client, db, steps and explicit flags) */
function resumeCmd(flags, from) {
  const p = ['node pilot/staging/cycle.cjs migrate', '--client', flags.client];
  for (const k of ['db', 'steps', 'skip-steps']) if (flags[k]) p.push(`--${k}`, plain(flags[k]));
  for (const k of ['yes-load-into-staging', 'skip-dry-run-check', 'i-accept-no-dry-run', 'with-dry-run', 'catch-up'])
    if (flags[k]) p.push(`--${k}`);
  p.push('--from', from);
  return p.join(' ');
}

const sumBy = (xs, k) => xs.reduce((s, x) => s + (x[k] || 0), 0);
const totalsOf = (rec) => ({
  seconds: secs(rec.steps.reduce((s, x) => s + x.seconds * 1000, 0)),
  rows: sumBy(rec.loadSteps, 'migrated'),
  quarantined: sumBy(rec.loadSteps, 'quarantined'),
  excluded: sumBy(rec.loadSteps, 'excluded'),
});
function renderSummary(rec) {
  const L = [`summary ${rec.client}: ${rec.ok ? 'OK' : `STOPPED at ${rec.stoppedAt}`}`];
  L.push(`  ${'step'.padEnd(20)} ${'seconds'.padStart(9)} ${'rows'.padStart(9)} ${'quarantined'.padStart(12)} ${'excluded'.padStart(9)}`);
  for (const s of rec.steps) {
    const isLoad = s.step === 'load';
    const t = isLoad ? totalsOf({ steps: [], loadSteps: rec.loadSteps }) : null;
    const f = (v) => (isLoad ? String(v) : '-');
    L.push(
      `  ${(s.step + (s.status === 'skipped' ? ' (skipped)' : s.code ? ' (FAILED)' : '')).padEnd(20)} ${String(s.seconds).padStart(9)} ${f(t?.rows).padStart(9)} ${f(t?.quarantined).padStart(12)} ${f(t?.excluded).padStart(9)}`,
    );
    if (isLoad)
      for (const x of rec.loadSteps)
        L.push(
          `    ${x.step.padEnd(18)} ${String(x.seconds).padStart(9)} ${String(x.migrated).padStart(9)} ${String(x.quarantined).padStart(12)} ${String(x.excluded).padStart(9)}`,
        );
  }
  L.push(`  total ${totalsOf(rec).seconds}s`);
  return L;
}
/** timings.json next to the fetched reports when `report` ran; otherwise (a run that stopped earlier) under runs/_timings so the newest-run lookup of migration-complete is not fooled */
function writeTimings(rec, dir) {
  const file = dir && fs.existsSync(path.join(dir, 'reconcile.json'))
    ? path.join(dir, 'timings.json')
    : path.join(runsRoot(), '_timings', `${rec.client}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...rec, totals: totalsOf(rec) }, null, 2));
  return file;
}

/** the whole chain for one client. Never throws: returns the record (rec.ok, rec.stoppedAt, rec.resume). */
async function migrateRun(srv, cfg, flags, shared = {}) {
  const rec = {
    client: cfg.client,
    startedAt: new Date().toISOString(),
    db: flags.db || cfg.mongoDb || null,
    from: flags.from || 'export',
    steps: [],
    loadSteps: [],
    ok: false,
    stoppedAt: null,
    resume: null,
  };
  const stop = (step, code, msg) => {
    rec.stoppedAt = step;
    rec.code = code;
    rec.resume = resumeCmd({ ...flags, client: cfg.client }, step);
    console.log(`migrate: STOPPED at ${step} (exit ${code})${msg ? ': ' + msg : ''}`);
    console.log(`migrate: resume with: ${rec.resume}`);
    return rec;
  };
  let dir = null;
  try {
    if (!flags['yes-load-into-staging'])
      refuse('migrate loads into the staging database: pass --yes-load-into-staging');
    if (flags['skip-dry-run-check'] && !flags['i-accept-no-dry-run'])
      refuse('--skip-dry-run-check also needs --i-accept-no-dry-run (you are loading without a clean dry run)');
    if (!MIG_STEPS.includes(rec.from)) refuse(`--from must be one of ${MIG_STEPS.join(', ')}`);
    if (flags['stop-after'] && !MIG_STEPS.includes(flags['stop-after']))
      refuse(`--stop-after must be one of ${MIG_STEPS.join(', ')}`);
    if (rec.db && !/^[A-Za-z0-9_-]{1,64}$/.test(rec.db)) refuse('--db is not a plausible database name');
    if (flags['catch-up']) {
      if (flags.steps) refuse('--catch-up runs the fixed catch-up chain: do not combine it with --steps');
      if (flags['skip-export']) refuse('--catch-up needs a fresh export (that is its point): drop --skip-export');
      // the credits group holds the wallet OPENING (a second opening would be a second balance); wallet-sync brings the balance up to date instead
      const skip = [...new Set(['credits', ...String(flags['skip-steps'] || '').split(',').filter(Boolean)])].join(',');
      flags = { ...flags, 'force-export': true, 'with-dry-run': true, 'skip-steps': skip };
      console.log('migrate: CATCH-UP of an already-loaded client: forced export, load (new rows; credits skipped), update, files, core-load, wallet-sync, usage-append');
    }
    if (!shared.memChecked) {
      await assertStaging(srv);
      await requireFreeMem(srv, 1);
    }
  } catch (e) {
    return stop(rec.from, e instanceof Refused ? 2 : 1, String(e.message || e));
  }
  const withDry = flags['with-dry-run'] || rec.from === 'dry';
  const catchUp = !!flags['catch-up'];
  const order = MIG_STEPS.filter(
    (s) =>
      (!CATCHUP_ONLY.has(s) || catchUp) &&
      (!CATCHUP_SKIPPED.has(s) || !catchUp) &&
      (s !== 'dry' || withDry) &&
      (s !== 'core-load' || cfg.coreFile) && // needs the geta_core snapshot (core-opening.cjs) named in the client config
      (s !== 'files' || cfg.files !== 'off') && // the media copy; "files": "off" in the client config skips it
      (s !== 'wallet-sync' || cfg.coreFile) && // needs the same geta_core snapshot
      (s !== 'flow-state' || cfg.flowState !== 'inactive'), // "flowState": "inactive" in the client config keeps every flow a draft
  );
  const ctxL = {};
  dir = rec.from === 'complete' ? newestReportDir(cfg.client) : null;
  const impl = {
    export: async () => {
      if (flags['skip-export']) {
        console.log('export: skipped (--skip-export)');
        return 'skipped';
      }
      if (!flags['force-export']) {
        const m = await manifestFresh(srv, cfg.client);
        if (m.ok) {
          console.log(`export: skipped, the server already has it: ${m.msg}`);
          return 'skipped';
        }
        console.log(`export: needed (${m.msg})`);
      }
      if (!rec.db) refuse('no Mongo database name: pass --db <waboo db> or set "mongoDb" in the client config');
      return runExport(cfg.client, rec.db, !!flags['force-export']);
    },
    ship: async () => {
      if (flags.build) {
        const b = await cmdBuild();
        if (b) return b;
      }
      return cmdShip(srv, cfg, { skipBundle: shared.bundleShipped });
    },
    preflight: () => preflightWithInit(srv, cfg),
    dry: () => cmdDry(srv, cfg, flags),
    backup: () => cmdBackup(srv, cfg),
    update: () => cmdUpdate(srv, cfg, { apply: true }), // every opted-in step; the load's --steps/--skip-steps do not apply to update mode
    'core-load': () => cmdCoreLoad(srv, cfg, { ...flags, apply: true }),
    files: async () => (await cmdFiles(srv, cfg, 'copy', { apply: true })) || cmdFiles(srv, cfg, 'verify'),
    'wallet-sync': () => cmdWalletSync(srv, cfg, { ...flags, apply: true }),
    'usage-append': () => cmdUsageAppend(srv, cfg, { ...flags, apply: true }),
    'flow-state': () => cmdFlowState(srv, cfg, { ...flags, apply: true }),
    load: () => cmdLoad(srv, cfg, flags, ctxL),
    reconcile: () => cmdReconcile(srv, cfg, { ...flags, alarmsOk: true }),
    report: async () => {
      dir = runDir(cfg.client);
      return cmdReport(srv, cfg, { dir });
    },
    complete: () => runComplete(cfg.client),
  };
  const todo = order.slice(order.indexOf(rec.from));
  for (const s of todo) {
    const t = Date.now();
    let code;
    let msg = '';
    try {
      code = await impl[s]();
    } catch (e) {
      code = e instanceof Refused ? 2 : 1;
      msg = String(e && e.message ? e.message : e);
    }
    const status = code === 'skipped' ? 'skipped' : code === 0 ? 'ok' : 'failed';
    if (code === 'skipped') code = 0;
    const sec = secs(Date.now() - t);
    rec.steps.push({ step: s, seconds: sec, code, status });
    rec.loadSteps = ctxL.steps || rec.loadSteps;
    console.log(`migrate: ${s} ${status} ${sec}s`);
    if (code !== 0) {
      stop(s, code, msg);
      break;
    }
    if (flags['stop-after'] === s) {
      console.log(`migrate: stopping after ${s} (--stop-after)`);
      break;
    }
  }
  if (!rec.stoppedAt) rec.ok = true;
  rec.finishedAt = new Date().toISOString();
  for (const l of renderSummary(rec)) console.log(l);
  console.log(`migrate: timings written to ${writeTimings(rec, dir)}`);
  return rec;
}

async function cmdMigrate(srv, cfg, flags) {
  return (await migrateRun(srv, cfg, flags)).ok ? 0 : 1;
}

async function cmdBatch(srv, flags) {
  if (!flags['yes-load-into-staging'])
    refuse('batch loads into the staging database: pass --yes-load-into-staging');
  const keys = String(flags.clients || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (!keys.length) refuse('batch needs --clients a,b,c');
  if (flags.db) refuse('batch takes the Mongo database from each client config ("mongoDb"), not --db');
  if (new Set(keys).size !== keys.length) refuse('--clients lists a client twice');
  const conc = flags.concurrency === undefined ? 1 : Number(flags.concurrency);
  if (!Number.isInteger(conc) || conc < 1 || conc > MAX_CONCURRENCY)
    refuse(
      `--concurrency must be 1 or ${MAX_CONCURRENCY}: the staging Postgres is capped at 1 GB and the host has little free memory (two migrate containers already use ~800 MB)`,
    );
  const cfgs = keys.map(loadClient); // every config validated before anything runs
  await assertStaging(srv);
  await requireFreeMem(srv, conc);
  const t0 = Date.now();
  if (!flags['skip-build']) {
    const b = await timed('build', cmdBuild);
    if (b) refuse('batch: the build failed');
  }
  const sh = await timed('ship (bundle, once)', () => cmdShip(srv, null));
  if (sh) refuse('batch: shipping the bundle failed');
  const pf = await timed('shared preflight/init', () => preflightWithInit(srv, cfgs[0]));
  if (pf) refuse(`batch: the shared preflight failed (${cfgs[0].client}); fix it, then re-run`);
  const { AsyncLocalStorage } = require('async_hooks');
  const als = new AsyncLocalStorage();
  const orig = console.log;
  console.log = (...a) => {
    const c = als.getStore();
    orig(...(c ? [`[${c}]`, ...a] : a));
  };
  const results = [];
  try {
    const queue = [...cfgs];
    await Promise.all(
      Array.from({ length: conc }, async () => {
        while (queue.length) {
          const cfg = queue.shift();
          const rec = await als.run(cfg.client, () =>
            migrateRun(srv, cfg, { ...flags, client: cfg.client }, { memChecked: true, bundleShipped: true }),
          );
          results.push(rec);
        }
      }),
    );
  } finally {
    console.log = orig;
  }
  results.sort((a, b) => keys.indexOf(a.client) - keys.indexOf(b.client));
  console.log(`batch summary (${keys.length} client(s), concurrency ${conc}, ${secs(Date.now() - t0)}s wall)`);
  console.log(`  ${'client'.padEnd(14)} ${'result'.padEnd(18)} ${'seconds'.padStart(8)} ${'rows'.padStart(9)} ${'quarantined'.padStart(12)} ${'excluded'.padStart(9)}`);
  const tot = { seconds: 0, rows: 0, quarantined: 0, excluded: 0 };
  for (const r of results) {
    const t = totalsOf(r);
    for (const k of Object.keys(tot)) tot[k] += t[k];
    console.log(
      `  ${r.client.padEnd(14)} ${(r.ok ? 'OK' : 'STOPPED ' + r.stoppedAt).padEnd(18)} ${String(t.seconds).padStart(8)} ${String(t.rows).padStart(9)} ${String(t.quarantined).padStart(12)} ${String(t.excluded).padStart(9)}`,
    );
    if (!r.ok) console.log(`    resume: ${r.resume}`);
  }
  console.log(`  ${'total'.padEnd(14)} ${''.padEnd(18)} ${String(secs(tot.seconds * 1000)).padStart(8)} ${String(tot.rows).padStart(9)} ${String(tot.quarantined).padStart(12)} ${String(tot.excluded).padStart(9)}`);
  const f = path.join(runsRoot(), '_batch', `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ concurrency: conc, wallSeconds: secs(Date.now() - t0), totals: tot, clients: results }, null, 2));
  console.log(`batch: summary written to ${f}`);
  return results.every((r) => r.ok) ? 0 : 1;
}

// ---- new-client ----
const clientsDir = () => process.env.CYCLE_CLIENTS_DIR || path.join(HERE, 'clients');
const SECRETISH = /(password|passwd|secret|token|api[_-]?key|bearer|private[_-]?key|:\/\/)/i;
const LONGBLOB = /[A-Za-z0-9+/_=-]{32,}/;
function cleanText(label, v, max = 100) {
  if (typeof v !== 'string' || !v.trim()) refuse(`--${label} is required`);
  if (v.length > max) refuse(`--${label} is too long`);
  if (SECRETISH.test(v) || LONGBLOB.test(v)) refuse(`--${label} looks like a secret or a URL: configs hold no secrets`);
  return v.trim();
}
function cmdNewClient(flags) {
  const key = flags.client;
  if (!/^[a-z0-9][a-z0-9_-]{0,40}$/.test(key || '')) refuse('--client must be a short lowercase key');
  const orgName = cleanText('name', flags.name);
  const ownerName = cleanText('owner-name', flags['owner-name']);
  const slug = flags.slug;
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(slug || '')) refuse('--slug must be lowercase letters, digits, dashes (2-61 chars)');
  const email = cleanText('owner-email', flags['owner-email'], 120);
  if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(email)) refuse('--owner-email is not an e-mail address');
  const plan = flags.plan || 'enterprise';
  if (!/^[a-z][a-z0-9_-]{1,30}$/.test(plan)) refuse('--plan must be a plan slug such as enterprise');
  const db = flags.db;
  if (db !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(db)) refuse('--db is not a plausible database name');
  const dir = clientsDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${key}.json`);
  if (fs.existsSync(file)) refuse(`${file} already exists (edit it by hand, new-client never overwrites)`);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    let o = null;
    try {
      o = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      /* not a client config */
    }
    if (o && o.orgSlug === slug) refuse(`slug "${slug}" is already used by ${f}`);
  }
  const map = {};
  const pairs = flags['channel-id'] ? String(flags['channel-id']).split(',') : [];
  pairs.forEach((p, i) => {
    const m = p.match(/^([A-Za-z0-9_-]{1,80})=(\d{5,20})$/);
    if (!m) refuse('--channel-id must be <botid>=<phone number id>[,<botid>=<phone number id>] (digits only)');
    map[m[1]] = {
      kind: 'whatsapp_cloud',
      externalId: m[2],
      displayAddress: '+1 000 000 0001',
      name: `${orgName} WhatsApp ${i + 1} (displayAddress is a PLACEHOLDER: set the real number)`,
    };
  });
  // --channel-map-file: a map of REAL numbers (written by wa-numbers.cjs: botid -> {externalId, displayAddress, name}); validated like --channel-id
  if (flags['channel-map-file']) {
    if (pairs.length) refuse('use --channel-id or --channel-map-file, not both');
    let o;
    try {
      o = JSON.parse(fs.readFileSync(flags['channel-map-file'], 'utf8'));
    } catch {
      refuse('--channel-map-file cannot be read as JSON');
    }
    for (const [bot, e] of Object.entries(o || {})) {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(bot) || !e || e.kind !== 'whatsapp_cloud' || !/^\d{5,32}$/.test(String(e.externalId)))
        refuse(`--channel-map-file: entry "${String(bot).slice(0, 40)}" needs kind whatsapp_cloud and a numeric externalId (phone number id)`);
      if (e.displayAddress !== undefined && !/^\+[0-9]{5,20}$/.test(String(e.displayAddress)))
        refuse(`--channel-map-file: entry "${String(bot).slice(0, 40)}" displayAddress must look like +6562502280`);
      map[bot] = { kind: 'whatsapp_cloud', externalId: String(e.externalId), name: cleanText('channel name', e.name, 120), ...(e.displayAddress ? { displayAddress: String(e.displayAddress) } : {}) };
    }
    if (!Object.keys(map).length) refuse('--channel-map-file holds no entries');
  }
  const placeholderMap = !pairs.length && !Object.keys(map).length;
  if (placeholderMap)
    map['REPLACE-WITH-BOT-ID'] = {
      kind: 'whatsapp_cloud',
      externalId: '99900000000001',
      displayAddress: '+1 000 000 0001',
      name: `${orgName} WhatsApp (PLACEHOLDER: replace the key with the Waboo bot id and externalId with the real phone number id before cutover)`,
    };
  const cfgDir = process.env.CYCLE_CONFIG_DIR || 'D:\\wadesk-vedant\\_work\\migration\\runs\\config';
  fs.mkdirSync(cfgDir, { recursive: true });
  const mapFile = path.join(cfgDir, `${key}-channel-map.json`);
  if (fs.existsSync(mapFile)) refuse(`${mapFile} already exists`);
  const cfg = {
    _comment: `Written by cycle.cjs new-client. ${placeholderMap ? 'The channel map is a PLACEHOLDER (no --channel-id given). ' : ''}creditOpening null = --no-wallet until the opening balance is confirmed.`,
    orgName,
    orgSlug: slug,
    orgPlan: plan,
    ownerEmail: email,
    ownerName,
    channelMap: mapFile,
    creditOpening: null,
    defaultCc: flags['default-cc'] || '91',
    batch: flags.batch ? Number(flags.batch) : 250,
    roleMapApprovals: [],
    extraFlags: [],
  };
  if (!Number.isInteger(cfg.batch) || cfg.batch < 1 || cfg.batch > 5000) refuse('--batch must be a whole number between 1 and 5000');
  if (!/^\d{1,4}$/.test(cfg.defaultCc)) refuse('--default-cc must be a country calling code such as 91');
  if (db) cfg.mongoDb = db;
  fs.writeFileSync(mapFile, JSON.stringify(map, null, 2) + '\n');
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`new-client: wrote ${file}`);
  console.log(`new-client: wrote ${mapFile}${placeholderMap ? ' (PLACEHOLDER entry: needs the bot id and the real phone number id)' : ''}`);
  console.log('new-client: still needs a person: the real WhatsApp phone number id, the opening credit balance (creditOpening), the real plan and owner e-mail if these are placeholders');
  return 0;
}

// ---------- main -----------------------------------------------------------------------------------------------------------------------
const BOOL_FLAGS = [
  'yes-load-into-staging',
  'after-init',
  'skip-dry-run-check',
  'i-accept-no-dry-run',
  'skip-export',
  'force-export',
  'with-dry-run',
  'catch-up',
  'build',
  'skip-build',
  'apply',
  'rollback',
  'check-meta',
  'i-switched-waboo-off',
  'replace-existing-override',
];
const VALUE_FLAGS = [
  'client',
  'steps',
  'skip-steps',
  'db',
  'from',
  'name',
  'slug',
  'owner-email',
  'owner-name',
  'plan',
  'channel-id',
  'channel-map-file',
  'clients',
  'concurrency',
  'default-cc',
  'batch',
  'stop-after',
  'confirm-org-slug',
  'confirm-cutover',
  'webhook-base',
];
function parseFlags(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!m) refuse(`unexpected argument "${argv[i]}"`);
    if (BOOL_FLAGS.includes(m[1])) f[m[1]] = true;
    else if (VALUE_FLAGS.includes(m[1])) {
      f[m[1]] = m[2] ?? argv[++i];
      if (f[m[1]] === undefined) refuse(`--${m[1]} needs a value`);
    } else refuse(`unknown flag --${m[1]}`);
  }
  return f;
}
const COMMANDS = [
  'build',
  'ship',
  'init',
  'preflight',
  'dry',
  'backup',
  'core-load',
  'flow-state',
  'wallet-sync',
  'usage-charges-append',
  'update',
  'files-plan',
  'files-copy',
  'files-verify',
  'kb-reingest',
  'cutover',
  'chat-reparse',
  'chat-relink',
  'campaign-link',
  'pricing-seed',
  'load',
  'reconcile',
  'report',
  'set-owner-password',
  'all-dry',
  'migrate',
  'new-client',
  'loaded-check',
  'batch',
];

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (!COMMANDS.includes(cmd))
    refuse(
      `usage: cycle.cjs <${COMMANDS.join('|')}> --client <c> [--yes-load-into-staging] [--after-init]`,
    );
  const flags = parseFlags(rest);
  if (cmd === 'build') return timed('build', cmdBuild);
  if (cmd === 'new-client') return cmdNewClient(flags);
  if (cmd === 'loaded-check') return cmdLoadedCheck(loadServer(), flags.client);
  if (cmd === 'pricing-seed') return timed('pricing-seed', () => cmdPricingSeed(loadServer(), flags));
  if (cmd === 'batch') return timed('batch', () => cmdBatch(loadServer(), flags));
  const cfg = loadClient(flags.client);
  const srv = loadServer();
  const one = {
    ship: () => cmdShip(srv, cfg),
    init: () => cmdInit(srv),
    preflight: () => cmdPreflight(srv, cfg, flags),
    dry: () => cmdDry(srv, cfg, flags),
    backup: () => cmdBackup(srv, cfg),
    load: () => cmdLoad(srv, cfg, flags),
    reconcile: () => cmdReconcile(srv, cfg, flags),
    report: () => cmdReport(srv, cfg),
    'set-owner-password': () => cmdOwnerPassword(srv, cfg),
    migrate: () => cmdMigrate(srv, cfg, flags),
    'core-load': () => cmdCoreLoad(srv, cfg, flags),
    'wallet-sync': () => cmdWalletSync(srv, cfg, flags),
    'usage-charges-append': () => cmdUsageAppend(srv, cfg, flags),
    'files-plan': () => cmdFiles(srv, cfg, 'plan'),
    'files-copy': () => cmdFiles(srv, cfg, 'copy', flags),
    'files-verify': () => cmdFiles(srv, cfg, 'verify'),
    'flow-state': () => cmdFlowState(srv, cfg, flags),
    update: () => cmdUpdate(srv, cfg, flags),
    'kb-reingest': () => cmdKbReingest(srv, cfg, flags),
    cutover: () => cmdCutover(srv, cfg, flags),
    'chat-reparse': () => cmdChatReparse(srv, cfg, flags),
    'chat-relink': () => cmdChatRelink(srv, cfg, flags),
    'campaign-link': () => cmdCampaignLink(srv, cfg, flags),
  };
  if (cmd !== 'all-dry') return timed(cmd, one[cmd]);
  for (const [n, step] of [
    ['build', () => cmdBuild()],
    ['ship', one.ship],
    ['preflight', one.preflight],
    ['dry', one.dry],
  ]) {
    const c = await timed(n, step);
    if (c !== 0) {
      console.log('all-dry: stopped at the first failing step (report below)');
      await one.report();
      return c;
    }
  }
  return timed('report', one.report);
}

module.exports = {
  shq,
  containerRun,
  migrateInner,
  teeTo,
  runArgs,
  reconcileArgs,
  maskPII,
  stepStats,
  exportArgs,
  resumeCmd,
  MIN_FREE_MB,
  MAX_CONCURRENCY,
};
if (require.main === module)
  main(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e) => {
      console.error(String(e && e.message ? e.message : e));
      process.exit(e instanceof Refused ? 2 : 1);
    },
  );
