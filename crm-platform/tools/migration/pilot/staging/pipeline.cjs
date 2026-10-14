#!/usr/bin/env node
/**
 * One command for the admin "Waboo migration" panel: everything that has to happen for one client, with machine-readable progress.
 *
 *   node pipeline.cjs [--client <key>] --db <waboo database name> --mode dry|load|catchup [--name "Org name"]
 *
 *   dry      export (fresh), ship, preflight, dry run (rolled back, nothing written), stop. Safe to repeat.
 *   load     ship, preflight, a fresh dry run, backup, load, files, core-load (plan, wallet, subscription), wallet-sync, flow-state, reconcile, report.
 *   catchup  an ALREADY-loaded client whose live data moved on: forced export, ship, preflight, dry run, backup, load (new rows only, credits
 *            skipped), update (edits since the load), files, core-load, wallet-sync, reconcile, report. Needs the client's config (refuses a
 *            client that was never loaded); never touches the channel map; never publishes flows again.
 *
 * Output: ONE JSON object per stdout line (the protocol the API worker reads), nothing secret in it:
 *   {"event":"step","name":"export|preflight|backup|dry|load|core-load|flow-state|reconcile|report","status":"running|done|failed|skipped","message":"..."}
 * The panel's parser (WMIG_STEP_NAMES) accepts only those names, so update, files and wallet-sync run (and are in the stderr log) but emit no
 * event until PANEL_STEPS below and the contract list are extended together.
 *   {"event":"report","green":bool,"unaccounted":n,"integrityErrors":n,"alarms":n,"orgId":n|null,"summary":"..."}
 * Everything else cycle.cjs prints goes to stderr. Exit 0 only when every step passed.
 *
 * A new client needs no hand-made config: the missing pieces are derived read-only from geta_core (core-opening.cjs) and the tenant database
 * (wa-numbers.cjs: the real WhatsApp phone number id, display number and name, keyed by the botid of the chats): organization name, slug, plan
 * facts, wallet opening balance, channel map. Only the owner e-mail stays a placeholder; the WhatsApp number falls back to a placeholder, with a
 * WARNING in the summary, when the source holds no live number. A client that already has rows on staging never gets a new channel map.
 * WhatsApp is never connected here and Waboo is never written to.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const HERE = __dirname;
const CYCLE = path.join(HERE, 'cycle.cjs');
const argv = process.argv.slice(2);
const flag = (n) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const fail = (msg, code = 2) => {
  emit({ event: 'step', name: 'preflight', status: 'failed', message: msg });
  emit({
    event: 'report',
    green: false,
    unaccounted: 0,
    integrityErrors: 0,
    alarms: 0,
    orgId: null,
    summary: msg,
  });
  process.exit(code);
};

const db = flag('db');
// --client is optional: default to the lower-case slug of the Waboo organization (workspace) id, same rule as the admin panel
const client = flag('client') || (db ? db.toLowerCase().slice(0, 64) : undefined);
const mode = flag('mode') || 'dry';
const name = flag('name');
if (!client || !/^[a-z0-9_-]{1,64}$/.test(client))
  fail('--client must be a key like "iskm" (a-z, 0-9, _ or -)');
if (!db || !/^[A-Za-z0-9_]{1,128}$/.test(db))
  fail('--db must be a Waboo database name (letters, digits, _)');
if (!['dry', 'load', 'catchup'].includes(mode)) fail('--mode must be dry, load or catchup');

const clientsDir = process.env.CYCLE_CLIENTS_DIR || path.join(HERE, 'clients');
const cfgFile = path.join(clientsDir, `${client}.json`);
const dataDir = process.env.WABOO_MIGRATE_CONFIG_DIR || path.join(clientsDir, '_data');
const preNotes = []; // WARNINGs found while deriving the config (they end up in the report summary)
const warn = (m) => {
  process.stderr.write(`WARNING: ${m}\n`);
  if (preNotes.length < 5) preNotes.push(m.slice(0, 200));
};

/**
 * The mailbox name of the placeholder owner. `new-client` refuses any plain run of 32+ characters as a possible secret, and a client key (a
 * name plus Waboo's random suffix) is often longer, so a long key is cut to its first 14 and last 6 characters (the suffix keeps it unique).
 */
const ownerLocal = (slug) => (slug.length <= 20 ? slug : `${slug.slice(0, 14)}-${slug.slice(-6)}`);

/** a new client: derive the config from geta_core (read-only) instead of asking a person for it */
function ensureConfig() {
  if (fs.existsSync(cfgFile)) return null;
  if (mode === 'catchup')
    return `catch-up needs the config of an already-loaded client (${cfgFile} is missing): this client was never migrated from here`;
  // a client with rows on staging must never get a new channel map (its conversation keys come from the old one)
  const lc = spawnSync(process.execPath, [CYCLE, 'loaded-check', '--client', client], {
    encoding: 'utf8',
    timeout: 180000,
  });
  if (lc.status !== 0)
    return lc.status === 2
      ? (lc.stderr || '').trim().slice(-300) +
          ' (restore its config file instead of creating a new one)'
      : `could not check whether ${client} is already loaded (loaded-check exit ${lc.status}); not creating a channel map blind`;
  fs.mkdirSync(dataDir, { recursive: true });
  const r = spawnSync(
    process.execPath,
    [path.join(HERE, 'core-opening.cjs'), '--client', client, '--workspace', db, '--out', dataDir],
    {
      encoding: 'utf8',
      timeout: 180000,
    },
  );
  const coreFile = path.join(dataDir, `${client}-core.json`);
  const openFile = path.join(dataDir, `${client}-credit-opening.json`);
  if (r.status !== 0 || !fs.existsSync(coreFile))
    return `could not read the workspace from geta_core (core-opening exit ${r.status})`;
  let orgName = name;
  if (!orgName) {
    try {
      const core = JSON.parse(fs.readFileSync(coreFile, 'utf8'));
      orgName = core?.business?.name || core?.workspace?.name;
    } catch {
      /* fall through */
    }
  }
  orgName = String(orgName || client).slice(0, 120);
  const slug = client.replace(/_/g, '-').slice(0, 60);
  // the REAL WhatsApp number (phone number id, display number, name) as the channel map from the start; the placeholder only as a loud fallback
  const waFile = path.join(dataDir, `${client}-wa-map.json`);
  fs.rmSync(waFile, { force: true });
  const wa = spawnSync(
    process.execPath,
    [path.join(HERE, 'wa-numbers.cjs'), '--workspace', db, '--name', orgName, '--out', waFile],
    { encoding: 'utf8', timeout: 180000 },
  );
  for (const l of (wa.stdout || '').split('\n').filter(Boolean)) process.stderr.write(l + '\n');
  const realMap = fs.existsSync(waFile);
  if (!realMap)
    warn(
      `no live WhatsApp number found for ${client} (wa-numbers exit ${wa.status}): the channel map is a PLACEHOLDER, so every chat is quarantined NO_CHANNEL until a person sets the real botid and phone number id`,
    );
  else if (wa.status === 3)
    warn('some botids have no live WhatsApp number: their chats are quarantined NO_CHANNEL');
  const nc = spawnSync(
    process.execPath,
    [
      CYCLE,
      'new-client',
      '--client',
      client,
      '--name',
      orgName,
      '--slug',
      slug,
      '--owner-email',
      `owner-${ownerLocal(slug)}@desk.wabo.ai`,
      '--owner-name',
      `${orgName} Owner`,
      ...(realMap ? ['--channel-map-file', waFile] : []),
    ],
    { encoding: 'utf8', timeout: 60000 },
  );
  if (nc.status !== 0)
    return `new-client failed (exit ${nc.status}): ${(nc.stderr || nc.stdout || '').slice(-300)}`;
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  cfg.mongoDb = db;
  cfg.coreFile = coreFile;
  if (fs.existsSync(openFile)) cfg.creditOpening = openFile;
  cfg.extraFlags = ['--keep-test-broadcasts', '--force'];
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
  return null;
}

// PANEL_STEPS: the step names the panel's parser accepts (packages/contracts WMIG_STEP_NAMES). Other cycle steps (update, files, wallet-sync)
// run but are not announced. Extend this list and the contract together, or the panel drops the events.
const PANEL_STEPS = [
  'export',
  'preflight',
  'backup',
  'dry',
  'load',
  'core-load',
  'flow-state',
  'reconcile',
  'report',
];
const ORDER = [
  'export',
  'preflight',
  'dry',
  'backup',
  'load',
  'core-load',
  'flow-state',
  'reconcile',
  'report',
].filter((n) => PANEL_STEPS.includes(n));
const EVENT_OF = { ship: 'preflight', init: 'preflight', complete: 'report' };

const problem = ensureConfig();
if (problem) fail(problem);

const args = [
  'migrate',
  '--client',
  client,
  '--db',
  db,
  '--yes-load-into-staging',
  '--with-dry-run',
];
if (mode === 'dry') args.push('--force-export', '--stop-after', 'dry');
if (mode === 'catchup') args.push('--catch-up');
// catch-up never runs flow-state (the flows are already live); the panel list is otherwise the same
const wanted =
  mode === 'dry'
    ? ORDER.slice(0, ORDER.indexOf('dry') + 1)
    : mode === 'catchup'
      ? ORDER.filter((n) => n !== 'flow-state')
      : ORDER;

const done = new Set();
const markRunning = (n) => {
  if (!wanted.includes(n) || done.has(n)) return;
  emit({ event: 'step', name: n, status: 'running', message: '' });
};
markRunning(mode === 'load' ? 'preflight' : 'export');

const st = {
  dryOk: null,
  unaccounted: null,
  integrity: null,
  alarms: null,
  orgId: null,
  failedStep: null,
  notes: [...preNotes],
};
const child = spawn(process.execPath, [CYCLE, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
let buf = '';
child.stderr.on('data', (d) => process.stderr.write(d));
child.stdout.on('data', (d) => {
  buf += d.toString('utf8');
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    process.stderr.write(line + '\n');
    let m;
    if ((m = line.match(/^migrate: (\S+) (ok|failed|skipped) [\d.]+s/))) {
      const step = EVENT_OF[m[1]] || m[1];
      if (!wanted.includes(step)) continue;
      const status = m[2] === 'ok' ? 'done' : m[2];
      if (m[1] === 'ship' && status === 'done') continue; // ship and preflight are one step for the panel
      done.add(step);
      emit({ event: 'step', name: step, status, message: '' });
      if (status === 'failed') st.failedStep = step;
      const next = wanted[wanted.indexOf(step) + 1];
      if (status !== 'failed' && next) markRunning(next);
    } else if (
      (m = line.match(/dry status: (NOT OK|OK) \(rolled back: (\w+), unaccounted: (\d+)\)/))
    ) {
      st.dryOk = m[1] === 'OK' && m[2] === 'true';
      st.unaccounted = Number(m[3]);
    } else if ((m = line.match(/\(unaccounted (\d+), alarms (\d+), integrity (\d+)\)/))) {
      st.unaccounted = Number(m[1]);
      st.alarms = Number(m[2]);
      st.integrity = Number(m[3]);
    } else if ((m = line.match(/^\s*done: org (\d+)/))) {
      st.orgId = Number(m[1]);
    } else if (/WARNING:/.test(line)) {
      if (st.notes.length < 5) st.notes.push(line.replace(/^\s*WARNING:\s*/, '').slice(0, 200));
    }
  }
});
child.on('error', (e) => fail(`could not start cycle.cjs: ${e.message}`, 1));
child.on('close', (code) => {
  const ok = code === 0 && !st.failedStep;
  const unaccounted = st.unaccounted ?? 0;
  const integrity = st.integrity ?? 0;
  const green =
    ok && unaccounted === 0 && integrity === 0 && (mode === 'dry' ? st.dryOk === true : true);
  const parts = [
    mode === 'dry'
      ? `dry run ${green ? 'clean' : 'NOT clean'}`
      : `${mode === 'catchup' ? 'catch-up' : 'load'} ${ok ? 'finished' : 'stopped at ' + st.failedStep}`,
    `unaccounted ${unaccounted}`,
    `integrity errors ${integrity}`,
    st.alarms !== null ? `${st.alarms} verifier alarms to review` : null,
    ...st.notes,
  ].filter(Boolean);
  emit({
    event: 'report',
    green,
    unaccounted,
    integrityErrors: integrity,
    alarms: st.alarms ?? 0,
    orgId: st.orgId,
    summary: parts.join('; ').slice(0, 900),
  });
  process.exit(ok ? 0 : 1);
});
