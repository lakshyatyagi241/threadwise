#!/usr/bin/env node
/**
 * Waboo -> WaDesk: WhatsApp credential import. MIGRATION TOOLING (one file, runs inside the desk-api image), not an application feature.
 *
 * Takes Waboo's existing WhatsApp credentials (the `chatbot_misc_config` collection) and stores them in WaDesk through the app's own
 * ENCRYPTED path, so a migrated client keeps its number without logging in to Meta again. Nothing is made live: the connection is
 * written `pending` and the inbox channel is left exactly as the inbox step made it (disconnected, unlinked).
 *
 *   node import-whatsapp-credentials.cjs --client <c> --org-slug <slug> --confirm-db-name <db> [--allow-docker-host postgres]
 *        [--dumps-dir /mig/dumps] [--channel-map FILE] [--input FILE] [--mapping FILE] [--auth-key skip|source|env]
 *        [--refresh-secrets] [--verify] [--apply --confirm-org-slug <slug>]
 *
 * Environment: TARGET_DATABASE_URL (the crm_worker_user login, never the owner), CREDENTIALS_ENCRYPTION_KEY (the app's key; the
 * container already has it; CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS is honoured for --verify), CRYPTO_FROM (optional: directory of the
 * app's compiled common/crypto, to seal with the app's own CryptoService instead of the byte-identical copy in this file).
 *
 * WHERE THE CREDENTIAL GOES. A WhatsApp channel has no credentials of its own: `channels.credentials_enc` is ignored for
 * kind 'whatsapp_cloud' (ChannelRegistryService.runtime reads the LINKED wa_provider_configs row). So this tool writes
 * `wa_provider_configs.credentials_json` (AES-256-GCM, `v1:<iv>:<tag>:<ct>:<keyid>`, CryptoService format) plus the non-secret ids in
 * `meta_json`, and does NOT touch `channels` at all: it only finds the channel the inbox step made (by external_id = phone number id)
 * and checks it. Linking the channel (`waba_config_id`) and marking it connected is the activation step, not done here (see README).
 *
 * Default is a DRY RUN: the same code path inside a transaction that is rolled back. Writing needs --apply, --confirm-db-name and
 * --confirm-org-slug. One transaction per channel. No event_outbox, audit or notification row is written. No network call is made
 * (no http/https/fetch in this file; a test asserts it). No secret is printed: output carries counts and key NAMES only, and every
 * line passes a filter that removes any secret value held in memory.
 *
 * Exit codes: 0 ok, 1 failed, 2 usage, 3 refused.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');

// ---- output: nothing secret can pass ----------------------------------------------------------------------------------------------
const SECRETS = new Set();
const redact = (s) => {
  let t = String(s);
  for (const v of SECRETS) if (v.length >= 6) t = t.split(v).join('<redacted>');
  return t.replace(/[a-z]+:\/\/\S+/gi, '<url>');
};
const say = (s) => process.stdout.write(`${redact(s)}\n`);
const warn = (s) => process.stderr.write(`${redact(s)}\n`);

class Refused extends Error {}
const refuse = (m) => {
  throw new Refused(m);
};

// ---- defaults of the key-name mapping (override with --mapping FILE; the file holds names and a pattern, never a value) ----------
const DEFAULT_MAPPING = {
  // documents of chatbot_misc_config that carry a WhatsApp number (anything else is ignored: Google OAuth, OpenAI, SMS, webhooks)
  // the second is a test-number config some workspaces keep next to the live one (a pending number, no bot): read, but only numbers the channel map lists are ever imported
  configKeys: ['META_WHATSAPP_CONFIG', 'META_WHATSAPP_CONFIG----test'],
  // our field -> the name inside config_value
  fields: {
    access_token: 'access_token',
    phone_number_id: 'phoneID',
    waba_id: 'waba_id',
    auth_key: 'auth_key',
    provider: 'provider',
  },
  // seen next to them, carry no credential and are not imported (the app re-reads them from Meta)
  knownIgnored: [
    'whatsapp_no',
    'display_number',
    'display_name',
    'display_name_status',
    'quality_rating',
    'quality',
    'limit',
    'messaging_limit',
    'status',
    'is_mm_lite_onboarded',
    'business_id',
    'meta_business_name',
    'business_verified',
    'business_info',
    'business_compliance_info',
    'status_history',
    'username',
    'user_password',
    // the reseller's partner key is one platform-level value (the same in every workspace's document); Desk keeps it once in the platform settings
    'partner_auth_key',
    // Pinnacle's own gateway token for the number: Desk calls the Meta Cloud API with the access token and never reads it, so it is not copied
    'api_token',
  ],
  tokenPattern: '^EA[A-Za-z0-9]{20,}$',
  providers: ['interakt', 'meta', 'pinnacle'],
  defaultProvider: 'interakt',
};
const SECRETISH =
  /token|secret|passw|api[_-]?key|authori[sz]ation|credential|private[_-]?key|auth[_-]?(key|id)|\bkey$/i;

function loadMapping(file) {
  if (!file) return DEFAULT_MAPPING;
  let o;
  try {
    o = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    refuse('--mapping file cannot be read as JSON');
  }
  const out = {
    ...DEFAULT_MAPPING,
    ...o,
    fields: { ...DEFAULT_MAPPING.fields, ...(o.fields || {}) },
  };
  for (const k of Object.keys(o))
    if (!(k in DEFAULT_MAPPING)) refuse(`--mapping: unknown key "${String(k).slice(0, 40)}"`);
  if (!Array.isArray(out.configKeys) || out.configKeys.length === 0)
    refuse('--mapping: configKeys must be a non-empty array');
  try {
    new RegExp(out.tokenPattern);
  } catch {
    refuse('--mapping: tokenPattern is not a regular expression');
  }
  return out;
}

// ---- the production guard of the tool (tools/migration/load/db.ts), same rules as set-owner-password.cjs --------------------------
function pgParse(url) {
  const p = require.resolve('pg-connection-string', {
    paths: [path.dirname(require.resolve('pg'))],
  });
  return require(p).parse(url);
}
function parseTarget(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    refuse('the database URL cannot be parsed (it is not printed because it holds a password)');
  }
  for (const k of ['host', 'hostaddr', 'service', 'socket', 'unix_socket', 'sslrootcert'])
    if (u.searchParams.has(k)) refuse(`refusing a database URL with a ?${k}= override`);
  const opts = u.searchParams.get('options');
  if (opts !== null && /host/i.test(opts))
    refuse('refusing a database URL whose ?options= mentions a host');
  const cfg = pgParse(url);
  const effective = String(cfg.host ?? '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  const urlHost = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (effective === '' || urlHost === '') refuse('refusing a database URL with no host');
  if (effective.startsWith('/') || effective !== urlHost)
    refuse('refusing a database URL whose effective host differs from the URL host');
  return {
    host: effective,
    port: u.port || '5432',
    db: decodeURIComponent(u.pathname.replace(/^\//, '')),
  };
}
const DEFAULT_DOCKER_HOSTS = ['crm-postgres', 'crm-platform-postgres', 'host.docker.internal'];
function loopback(h) {
  if (h === 'localhost' || h === '::1') return true;
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  return Boolean(m) && [m[1], m[2], m[3]].every((o) => Number(o) <= 255);
}
function assertTargetAllowed(url, flags) {
  const t = parseTarget(url);
  const list = (v) =>
    String(v ?? '')
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
  const docker = [
    ...list(flags['allow-docker-host']),
    ...list(process.env.MIGRATION_ALLOW_DOCKER_HOSTS),
  ];
  const local = loopback(t.host) || [...DEFAULT_DOCKER_HOSTS, ...docker].includes(t.host);
  if (!local && !list(flags['allow-target-host']).includes(t.host))
    refuse(
      `refusing to run against ${t.host}: not localhost / a known docker name (--allow-docker-host ${t.host} for a compose service, --allow-target-host ${t.host} otherwise)`,
    );
  return t;
}

// ---- flags -------------------------------------------------------------------------------------------------------------------------
const VALUE_FLAGS = new Set([
  'client',
  'org-slug',
  'confirm-db-name',
  'confirm-org-slug',
  'allow-docker-host',
  'allow-target-host',
  'dumps-dir',
  'channel-map',
  'input',
  'mapping',
  'auth-key',
]);
const BOOL_FLAGS = new Set(['apply', 'verify', 'refresh-secrets']);
function parseFlags(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) refuse('unexpected argument');
    const eq = a.indexOf('=');
    const k = eq > 0 ? a.slice(2, eq) : a.slice(2);
    if (BOOL_FLAGS.has(k)) {
      f[k] = true;
    } else if (VALUE_FLAGS.has(k)) {
      f[k] =
        eq > 0
          ? a.slice(eq + 1)
          : argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')
            ? argv[++i]
            : '';
    } else refuse(`unknown flag --${k.slice(0, 40)}`); // the value is never echoed
  }
  return f;
}

// ---- crypto: CryptoService format, byte for byte (apps/api/src/common/crypto/crypto.service.ts) -------------------------------
function toRingKey(b64, label) {
  const key = Buffer.from(String(b64).trim(), 'base64');
  if (key.length !== 32) refuse(`${label} must be 32 bytes, base64-encoded`);
  return { id: crypto.createHash('sha256').update(key).digest('hex').slice(0, 8), key };
}
function makeCrypto() {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw)
    refuse(
      'CREDENTIALS_ENCRYPTION_KEY is not set (the container has it; it is the key the app seals with)',
    );
  const from = process.env.CRYPTO_FROM;
  if (from) {
    // the app's own compiled CryptoService, fed the same two env values through a ConfigService-shaped stub
    const { CryptoService } = require(path.resolve(from, 'crypto.service.js'));
    const svc = new CryptoService({ get: (k) => process.env[k] });
    return {
      encrypt: (s) => svc.encrypt(s),
      decrypt: (s) => svc.decrypt(s),
      keyId: svc.currentKeyId,
      source: 'app',
    };
  }
  const current = toRingKey(raw, 'CREDENTIALS_ENCRYPTION_KEY');
  const ring = [current];
  for (const k of String(process.env.CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)) {
    const r = toRingKey(k, 'CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS');
    if (r.id !== current.id) ring.push(r);
  }
  return {
    keyId: current.id,
    source: 'inline',
    encrypt(plain) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', current.key, iv);
      const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return [
        'v1',
        iv.toString('base64'),
        c.getAuthTag().toString('base64'),
        ct.toString('base64'),
        current.id,
      ].join(':');
    },
    decrypt(blob) {
      const p = typeof blob === 'string' ? blob.split(':') : [];
      if (p[0] !== 'v1' || (p.length !== 4 && p.length !== 5) || !p[1] || !p[2] || !p[3])
        throw new Error('malformed ciphertext');
      const cands = p.length === 5 ? ring.filter((k) => k.id === p[4]) : ring;
      if (cands.length === 0) throw new Error('sealed with a key that is not in the key ring');
      let last;
      for (const k of cands) {
        try {
          const d = crypto.createDecipheriv('aes-256-gcm', k.key, Buffer.from(p[1], 'base64'));
          d.setAuthTag(Buffer.from(p[2], 'base64'));
          return Buffer.concat([d.update(Buffer.from(p[3], 'base64')), d.final()]).toString('utf8');
        } catch (e) {
          last = e;
        }
      }
      throw last;
    },
  };
}

// ---- inputs ------------------------------------------------------------------------------------------------------------------------
/** The operator's non-secret channel map (inbox/config.ts rules): botid -> { kind, externalId, displayAddress, name }. */
function readChannelMap(file) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    refuse('the channel map cannot be read as JSON');
  }
  if (
    raw === null ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).length === 0
  )
    refuse('the channel map must be a non-empty JSON object keyed by botid');
  const ALLOWED = new Set(['kind', 'externalId', 'displayAddress', 'name']);
  const byExt = new Map();
  for (const [botid, e] of Object.entries(raw)) {
    if (e === null || typeof e !== 'object' || Array.isArray(e))
      refuse(`channel map entry "${botid}" must be an object`);
    for (const k of Object.keys(e))
      if (!ALLOWED.has(k)) refuse(`channel map entry "${botid}" has an unknown key "${k}"`);
    if (e.kind !== 'whatsapp_cloud')
      refuse(`channel map entry "${botid}": kind must be "whatsapp_cloud"`);
    const ext = typeof e.externalId === 'string' ? e.externalId.trim() : '';
    if (!/^\d{5,32}$/.test(ext))
      refuse(
        `channel map entry "${botid}": externalId must be the phone number id (5 to 32 digits)`,
      );
    const cur = byExt.get(ext) ?? {
      ext,
      name: String(e.name ?? '').trim(),
      displayAddress: e.displayAddress ?? null,
      botids: [],
    };
    cur.botids.push(botid);
    byExt.set(ext, cur);
  }
  return [...byExt.values()];
}

/** Streams the NDJSON; yields { line, doc }. A line that is not JSON is reported by number only, never echoed. */
async function* readNdjson(file) {
  if (!fs.existsSync(file)) refuse(`the input file does not exist: ${path.basename(file)}`);
  const rl = readline.createInterface({
    input: fs.createReadStream(file, 'utf8'),
    crlfDelay: Infinity,
  });
  let n = 0;
  for await (const text of rl) {
    n++;
    if (text.trim() === '') continue;
    let doc;
    try {
      doc = JSON.parse(text);
    } catch {
      refuse(`line ${n} of the input is not JSON`);
    }
    yield { line: n, doc };
  }
}

/**
 * Reads the file once, keeps ONLY the whitelisted fields of the WhatsApp documents. Returns
 * { byPhone: Map<phoneId, {access_token, waba_id, auth_key?, provider}>, stats }.
 * Refuses a document of a configured config_key whose shape is not exactly what the mapping describes, and any document that looks like
 * a WhatsApp number (has the phone-number-id or waba-id field) under a config_key that is not listed.
 */
async function extract(file, map, allowedPhones = null) {
  const F = map.fields;
  const tokenRe = new RegExp(map.tokenPattern);
  const known = new Set([...Object.values(F), ...map.knownIgnored]);
  const stats = {
    docs: 0,
    whatsappDocs: 0,
    ignoredDocs: 0,
    inactive: 0,
    ignoredKeyNames: new Set(),
    configKeys: new Set(),
  };
  const byPhone = new Map();
  for await (const { line, doc } of readNdjson(file)) {
    stats.docs++;
    const key = doc && typeof doc.config_key === 'string' ? doc.config_key : null;
    let val = doc ? doc.config_value : null;
    if (typeof val === 'string' && doc.is_json === true) {
      try {
        val = JSON.parse(val);
      } catch {
        val = null;
      }
    }
    const isObj = val !== null && typeof val === 'object' && !Array.isArray(val);
    if (key === null || !map.configKeys.includes(key)) {
      if (isObj && (F.phone_number_id in val || F.waba_id in val))
        refuse(
          `line ${line}: a document with a WhatsApp-looking shape has config_key "${String(key).slice(0, 60)}" which is not in the mapping (add it with --mapping, never guessed)`,
        );
      stats.ignoredDocs++;
      if (key) stats.configKeys.add(key.slice(0, 60));
      continue;
    }
    if (doc.deleted_time != null || doc.is_active === false) {
      stats.inactive++;
      continue;
    }
    if (!isObj) refuse(`line ${line}: config_value of a WhatsApp document is not an object`);
    // a document for a number the channel map does not list (a test number, an old one) is never imported, so it is not even validated: a
    // malformed one must not block the numbers that are listed
    if (allowedPhones && !allowedPhones.has(String(val[F.phone_number_id]))) {
      stats.ignoredDocs++;
      continue;
    }
    stats.whatsappDocs++;
    for (const k of Object.keys(val)) {
      if (!known.has(k)) {
        if (SECRETISH.test(k))
          refuse(
            `line ${line}: unmapped credential-looking key "${k.slice(0, 40)}" in a WhatsApp document (map it or drop it explicitly; never guessed)`,
          );
        stats.ignoredKeyNames.add(k.slice(0, 40));
      }
    }
    const tok = val[F.access_token];
    if (typeof tok !== 'string' || !tokenRe.test(tok))
      refuse(`line ${line}: "${F.access_token}" is missing or does not match the token pattern`);
    SECRETS.add(tok);
    const pid = val[F.phone_number_id] === undefined ? undefined : String(val[F.phone_number_id]);
    if (!pid || !/^\d{5,32}$/.test(pid))
      refuse(`line ${line}: "${F.phone_number_id}" is missing or not a phone number id`);
    const waba = val[F.waba_id] === undefined ? undefined : String(val[F.waba_id]);
    if (!waba || !/^\d{5,32}$/.test(waba))
      refuse(`line ${line}: "${F.waba_id}" is missing or not a WABA id`);
    let auth;
    if (val[F.auth_key] !== undefined && val[F.auth_key] !== null) {
      if (typeof val[F.auth_key] !== 'string' || val[F.auth_key].length < 8)
        refuse(`line ${line}: "${F.auth_key}" has an unexpected shape`);
      auth = val[F.auth_key];
      SECRETS.add(auth);
    }
    let provider = map.defaultProvider;
    if (val[F.provider] !== undefined) {
      const p = String(val[F.provider]).toLowerCase();
      if (!map.providers.includes(p))
        refuse(`line ${line}: "${F.provider}" is not one of ${map.providers.join(', ')}`);
      provider = p;
    }
    const entry = {
      access_token: tok,
      waba_id: waba,
      auth_key: auth,
      provider,
      explicitProvider: val[F.provider] !== undefined,
    };
    // not credentials: what Waboo shows in its header (health light and Limit: TIER_100K). Carried so the WaDesk channel page shows them
    // before the first health check; the app re-reads both from Meta once the connection is live.
    entry.quality_rating = qualityOf(val.quality_rating ?? val.quality);
    entry.messaging_limit_tier = tierOf(val.limit) ?? tierOf(val.messaging_limit);
    const prev = byPhone.get(pid);
    if (
      prev &&
      (prev.access_token !== tok ||
        prev.waba_id !== waba ||
        prev.auth_key !== auth ||
        prev.provider !== provider)
    )
      refuse(
        `two live documents for the same phone number id disagree (line ${line}); settle which is current in the source first`,
      );
    byPhone.set(pid, entry);
  }
  return { byPhone, stats };
}

/** Meta's health colour as the app stores it: GREEN, YELLOW, RED or UNKNOWN, else null (nothing is guessed). */
function qualityOf(v) {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return ['GREEN', 'YELLOW', 'RED', 'UNKNOWN'].includes(s) ? s : null;
}
/** A messaging limit (a number, or Extended JSON {$numberInt|$numberLong}) as Meta names its tier: 250 -> TIER_250, 100000 -> TIER_100K. */
function tierOf(v) {
  // Waboo's `limit` field already holds the tier name (what its header shows, e.g. TIER_100K): that wins over any number
  if (typeof v === 'string' && /^TIER_(UNLIMITED|[0-9]+K?)$/i.test(v.trim()))
    return v.trim().toUpperCase();
  const raw =
    v !== null && typeof v === 'object' ? (v.$numberInt ?? v.$numberLong ?? v.$numberDouble) : v;
  if (typeof raw === 'string' && /^unlimited$/i.test(raw.trim())) return 'TIER_UNLIMITED';
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1000000) return 'TIER_UNLIMITED';
  return n >= 1000 && n % 1000 === 0 ? `TIER_${n / 1000}K` : `TIER_${n}`;
}

// ---- the credential object the app stores (StoredCredentials, waba-connect.service.ts) ---------------------------------------------
function credentialsFor(entry, authKeyMode) {
  const c = { access_token: entry.access_token };
  let authKey = null;
  if (entry.provider === 'pinnacle') {
    if (!entry.auth_key)
      refuse(
        'provider pinnacle needs the per-user key (auth_key) as channel_token and the document has none',
      );
    c.channel_token = entry.auth_key;
    authKey = 'channel_token';
  } else if (entry.provider === 'interakt') {
    if (authKeyMode === 'source') {
      if (!entry.auth_key) refuse('--auth-key source but the document has no auth_key');
      c.auth_key = entry.auth_key;
      authKey = 'auth_key (from source)';
    } else if (authKeyMode === 'env') {
      const k = process.env.INTERAKT_PARTNER_AUTH_KEY;
      if (!k) refuse('--auth-key env but INTERAKT_PARTNER_AUTH_KEY is not set in this container');
      SECRETS.add(k);
      c.auth_key = k;
      authKey = 'auth_key (platform env)';
    }
  }
  return { creds: c, authKey };
}
// the order of keys is fixed, so the same input always seals the same plaintext (idempotency compares plaintext)
const canonical = (o) =>
  JSON.stringify(
    Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, o[k]]),
    ),
  );

// ---- database ----------------------------------------------------------------------------------------------------------------------
async function connect(url) {
  const { Client } = require('pg');
  const db = new Client({
    connectionString: url,
    application_name: 'waboo-whatsapp-credentials',
    connectionTimeoutMillis: 10000,
  });
  await db.connect();
  const me = (
    await db.query(
      'SELECT r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user',
    )
  ).rows[0];
  if (me.rolsuper || me.rolbypassrls) {
    await db.end().catch(() => undefined);
    refuse(
      'this login bypasses row-level security (superuser or BYPASSRLS): use the crm_worker_user login',
    );
  }
  return db;
}

/** The migrated organization: slug matches AND it carries the migration marker of THIS client. */
async function findOrg(db, slug, client) {
  await db.query('BEGIN');
  try {
    await db.query(`SELECT set_config('app.privileged', 'on', true)`);
    const r = await db.query(
      `SELECT id, settings #>> '{legacy,waboo,client}' AS client FROM organizations WHERE lower(slug) = $1`,
      [slug],
    );
    if (r.rows.length === 0) refuse(`no organization with slug "${slug}"`);
    if (r.rows.length > 1) refuse(`more than one organization matches slug "${slug}"`);
    if (r.rows[0].client !== client)
      refuse(
        `organization "${slug}" is not the organization migrated for client "${client}" (settings.legacy.waboo.client differs)`,
      );
    return Number(r.rows[0].id);
  } finally {
    await db.query('ROLLBACK');
  }
}

/**
 * One channel, one transaction. Returns a result object (no secret). `commit` false = dry run: everything runs, then ROLLBACK.
 * Result.action: 'create' | 'fill' | 'refresh' | 'unchanged'.
 */
async function importOne({
  db,
  orgId,
  client,
  ch,
  entry,
  mode,
  crypto: cr,
  commit,
  refreshSecrets,
}) {
  const { creds, authKey } = credentialsFor(entry, mode);
  const plain = canonical(creds);
  await db.query('BEGIN');
  try {
    await db.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgId)]);
    await db.query(`SELECT set_config('app.user_id', '', true)`);
    const chans = (
      await db.query(
        `SELECT id, status, waba_config_id, settings #>> '{legacy,waboo,client}' AS client
           FROM channels WHERE org_id = $1 AND kind = 'whatsapp_cloud' AND external_id = $2 FOR UPDATE`,
        [orgId, ch.ext],
      )
    ).rows;
    if (chans.length === 0)
      refuse(
        `no channel with external_id for phone number id ending ...${ch.ext.slice(-4)} in this organization (run the inbox step first)`,
      );
    if (chans.length > 1)
      refuse(`more than one channel matches phone number id ...${ch.ext.slice(-4)}`);
    const chan = chans[0];
    if (chan.client !== client)
      refuse(`channel ...${ch.ext.slice(-4)} was not made by the migration of client "${client}"`);
    if (chan.status === 'connected')
      refuse(
        `channel ...${ch.ext.slice(-4)} is already connected: this tool never touches a live channel`,
      );

    const cfgs = (
      await db.query(
        `SELECT id, status, credentials_json, meta_json->>'waba_id' AS waba_id, meta_json->>'connected_via' AS via
           FROM wa_provider_configs
          WHERE org_id = $1 AND provider = 'waba' AND meta_json->>'phone_number_id' = $2 FOR UPDATE`,
        [orgId, ch.ext],
      )
    ).rows;
    if (cfgs.length > 1)
      refuse(`more than one WhatsApp connection matches phone number id ...${ch.ext.slice(-4)}`);
    if (
      chan.waba_config_id !== null &&
      (cfgs.length === 0 || Number(chan.waba_config_id) !== Number(cfgs[0].id))
    )
      refuse(`channel ...${ch.ext.slice(-4)} is linked to a connection this tool did not make`);

    let action;
    if (cfgs.length === 0) {
      const primary =
        (
          await db.query(
            `SELECT 1 FROM wa_provider_configs WHERE org_id = $1 AND is_primary LIMIT 1`,
            [orgId],
          )
        ).rows.length > 0;
      const meta = {
        provider: entry.provider === 'interakt' ? 'interakt' : 'meta',
        provider_key: entry.provider,
        waba_id: entry.waba_id,
        phone_number_id: ch.ext,
        connected_via: 'migration',
        inbound_wired: false,
        inbound_checked_at: null,
        token_expires_at: null,
        last_error: null,
        ...(entry.quality_rating ? { quality_rating: entry.quality_rating } : {}),
        ...(entry.messaging_limit_tier ? { messaging_limit_tier: entry.messaging_limit_tier } : {}),
      };
      try {
        await db.query(
          `INSERT INTO wa_provider_configs (org_id, provider, status, credentials_json, meta_json, phone_number, display_label, is_primary)
           VALUES ($1, 'waba', 'pending', $2, $3::jsonb, $4, $5, $6)`,
          [
            orgId,
            cr.encrypt(plain),
            JSON.stringify(meta),
            ch.displayAddress,
            ch.name || null,
            !primary,
          ],
        );
      } catch (e) {
        if (e && e.code === '23505')
          refuse(
            `phone number id ...${ch.ext.slice(-4)} is already connected in another workspace`,
          );
        throw e;
      }
      action = 'create';
    } else {
      const cfg = cfgs[0];
      if (cfg.via !== 'migration' || !['pending', 'disconnected'].includes(cfg.status))
        refuse(
          `a connection for ...${ch.ext.slice(-4)} already exists and was not made by this tool or is not pending: not touched`,
        );
      if (cfg.waba_id !== entry.waba_id)
        refuse(`the existing connection for ...${ch.ext.slice(-4)} has a different WABA id`);
      let same = false;
      let metaFilled = [];
      if (cfg.credentials_json) {
        try {
          same = cr.decrypt(cfg.credentials_json) === plain;
        } catch {
          same = false;
        }
      }
      // quality and tier are metadata, not credentials: fill them on a pending connection this tool made, never overwrite a value the app wrote
      const have = (
        await db.query(
          `SELECT meta_json->>'quality_rating' AS q, meta_json->>'messaging_limit_tier' AS t FROM wa_provider_configs WHERE org_id = $1 AND id = $2`,
          [orgId, cfg.id],
        )
      ).rows[0];
      const add = {};
      if (entry.quality_rating && !have.q) add.quality_rating = entry.quality_rating;
      if (entry.messaging_limit_tier && !have.t)
        add.messaging_limit_tier = entry.messaging_limit_tier;
      if (Object.keys(add).length > 0) {
        await db.query(
          `UPDATE wa_provider_configs SET meta_json = meta_json || $1::jsonb WHERE org_id = $2 AND id = $3`,
          [JSON.stringify(add), orgId, cfg.id],
        );
        metaFilled = Object.keys(add).sort();
      }
      if (same) action = metaFilled.length ? 'meta-filled' : 'unchanged';
      else if (!cfg.credentials_json || refreshSecrets) {
        await db.query(
          `UPDATE wa_provider_configs SET credentials_json = $1 WHERE org_id = $2 AND id = $3`,
          [cr.encrypt(plain), orgId, cfg.id],
        );
        action = cfg.credentials_json ? 'refresh' : 'fill';
      } else
        refuse(
          `the stored credential for ...${ch.ext.slice(-4)} differs from the source; --refresh-secrets overwrites it`,
        );
    }
    await db.query(commit ? 'COMMIT' : 'ROLLBACK');
    return { action, keys: Object.keys(creds).sort(), authKey, provider: entry.provider };
  } catch (e) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw e;
  }
}

/** --verify: decrypt in memory, FORMAT checks only, never printed; compared with the source file when it is given. */
async function verifyOne({ db, orgId, ch, entry, map, crypto: cr, mode }) {
  await db.query('BEGIN');
  try {
    await db.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgId)]);
    await db.query(`SELECT set_config('app.user_id', '', true)`);
    const r = (
      await db.query(
        `SELECT credentials_json, status, meta_json->>'waba_id' AS waba_id FROM wa_provider_configs
          WHERE org_id = $1 AND provider = 'waba' AND meta_json->>'phone_number_id' = $2`,
        [orgId, ch.ext],
      )
    ).rows;
    if (r.length !== 1 || !r[0].credentials_json)
      return {
        ok: false,
        why: r.length === 0 ? 'no connection' : r.length > 1 ? 'ambiguous' : 'no credential stored',
      };
    const blob = r[0].credentials_json;
    const res = {
      ok: true,
      status: r[0].status,
      sealedFormat: /^v1:[^:]+:[^:]+:[^:]+:[0-9a-f]{8}$/.test(blob),
      keyId: blob.split(':')[4],
      keyIsCurrent: blob.split(':')[4] === cr.keyId,
    };
    let c;
    try {
      c = JSON.parse(cr.decrypt(blob));
    } catch {
      return { ...res, ok: false, why: 'cannot be decrypted with the key in this container' };
    }
    for (const v of Object.values(c)) if (typeof v === 'string') SECRETS.add(v);
    res.tokenFormat =
      typeof c.access_token === 'string' && new RegExp(map.tokenPattern).test(c.access_token);
    res.tokenLength = typeof c.access_token === 'string' ? c.access_token.length : 0;
    res.keysStored = Object.keys(c).sort();
    res.wabaMatches = r[0].waba_id === (entry ? entry.waba_id : r[0].waba_id);
    if (entry) {
      const want = credentialsFor(entry, mode).creds;
      res.matchesSource = canonical(want) === canonical(c);
    }
    res.ok = res.sealedFormat && res.tokenFormat && res.wabaMatches && res.matchesSource !== false;
    return res;
  } finally {
    await db.query('ROLLBACK');
  }
}

// ---- main --------------------------------------------------------------------------------------------------------------------------
async function main(argv) {
  const flags = parseFlags(argv);
  for (const k of ['client', 'org-slug', 'confirm-db-name'])
    if (!flags[k]) refuse(`--${k} is required`);
  if (!/^[A-Za-z0-9_.-]+$/.test(flags.client))
    refuse('--client has characters that are not allowed');
  const mode = flags['auth-key'] ?? 'skip';
  if (!['skip', 'source', 'env'].includes(mode)) refuse('--auth-key must be skip, source or env');
  const apply = Boolean(flags.apply);
  if (apply && flags.verify) refuse('--apply and --verify are separate runs');
  const slug = flags['org-slug'].trim().toLowerCase();
  if (
    apply &&
    String(flags['confirm-org-slug'] ?? '')
      .trim()
      .toLowerCase() !== slug
  )
    refuse('--apply needs --confirm-org-slug equal to --org-slug');
  const url = process.env.TARGET_DATABASE_URL;
  if (!url) refuse('TARGET_DATABASE_URL (the crm_worker_user login) is not set');
  const target = assertTargetAllowed(url, flags);
  if (flags['confirm-db-name'] !== target.db)
    refuse(`--confirm-db-name must be exactly the database name (${target.db})`);

  const map = loadMapping(flags.mapping);
  const dir = path.resolve(
    flags['dumps-dir'] || process.env.SOURCE_DUMPS_DIR || '/mig/dumps',
    flags.client,
  );
  const input = flags.input || path.join(dir, 'chatbot_misc_config.ndjson');
  const channels = readChannelMap(flags['channel-map'] || path.join(dir, 'channel-map.json'));
  const cr = makeCrypto();

  const { byPhone, stats } = await extract(input, map, new Set(channels.map((c) => c.ext)));
  say(
    `mode            ${flags.verify ? 'VERIFY' : apply ? 'APPLY' : 'DRY RUN (nothing is written)'}   crypto ${cr.source}   key ${cr.keyId}`,
  );
  say(
    `input           ${stats.docs} documents: ${stats.whatsappDocs} WhatsApp, ${stats.inactive} inactive/deleted skipped, ${stats.ignoredDocs} other kinds ignored`,
  );
  if (stats.configKeys.size)
    say(`ignored kinds   config_key names: ${[...stats.configKeys].sort().join(', ')}`);
  if (stats.ignoredKeyNames.size)
    say(`ignored fields  names: ${[...stats.ignoredKeyNames].sort().join(', ')}`);
  say(
    `channel map     ${channels.length} number(s) from ${channels.reduce((n, c) => n + c.botids.length, 0)} bot(s)`,
  );
  const unmapped = [...byPhone.keys()].filter((p) => !channels.some((c) => c.ext === p)).length;
  if (unmapped)
    say(
      `not in the map  ${unmapped} WhatsApp document(s) for numbers the channel map does not list (not imported)`,
    );

  const db = await connect(url);
  const tally = {};
  let failed = 0;
  try {
    const orgId = await findOrg(db, slug, flags.client);
    for (const ch of channels) {
      const tag = `bot(s) ${ch.botids.join(',')}  number ...${ch.ext.slice(-4)}`;
      const entry = byPhone.get(ch.ext);
      if (!entry) {
        say(`${tag}  NO CREDENTIAL in the file for this number: skipped`);
        tally.missing = (tally.missing ?? 0) + 1;
        continue;
      }
      try {
        if (flags.verify) {
          const v = await verifyOne({ db, orgId, ch, entry, map, crypto: cr, mode });
          const { ok, ...rest } = v;
          say(`${tag}  verify ${ok ? 'OK' : 'FAIL'}  ${JSON.stringify(rest)}`);
          if (!ok) failed++;
          tally[ok ? 'verified' : 'verify_failed'] =
            (tally[ok ? 'verified' : 'verify_failed'] ?? 0) + 1;
        } else {
          const r = await importOne({
            db,
            orgId,
            client: flags.client,
            ch,
            entry,
            mode,
            crypto: cr,
            commit: apply,
            refreshSecrets: Boolean(flags['refresh-secrets']),
          });
          say(
            `${tag}  ${apply ? '' : 'would '}${r.action}  provider ${r.provider}  secret keys [${r.keys.join(', ')}]${r.authKey ? `  ${r.authKey}` : ''}  connection pending, channel untouched`,
          );
          tally[r.action] = (tally[r.action] ?? 0) + 1;
        }
      } catch (e) {
        if (!(e instanceof Refused)) throw e;
        say(`${tag}  REFUSED: ${e.message}`);
        tally.refused = (tally.refused ?? 0) + 1;
        failed++;
      }
    }
  } finally {
    await db.end().catch(() => undefined);
  }
  say(
    `summary         ${JSON.stringify(tally)}${apply ? '' : flags.verify ? '' : '   (dry run: re-run with --apply --confirm-org-slug)'}`,
  );
  return failed ? 3 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      const msg = String(e && e.message ? e.message : e)
        .split('\n')[0]
        .slice(0, 300);
      warn(e instanceof Refused ? `refused: ${msg}` : `failed: ${msg}`);
      process.exit(e instanceof Refused ? 3 : 1);
    },
  );
}
module.exports = { main, extract, DEFAULT_MAPPING };
