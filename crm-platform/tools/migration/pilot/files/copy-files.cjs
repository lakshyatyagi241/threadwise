#!/usr/bin/env node
/**
 * Waboo -> WaDesk FILES / MEDIA COPY (migration tooling, not an app feature). One file, no dependencies beyond the desk-api image
 * (`pg`; S3 requests are signed here with SigV4, exactly like object-storage.probe.ts, because the image ships no AWS SDK).
 *
 *   node copy-files.cjs plan   --org-slug S --confirm-db-name DB --config files.json [--attachments attachments.ndjson] [--state F]
 *   node copy-files.cjs copy   ... (same; read-only) |  copy --apply --confirm-org-slug S --max-files N --max-gb G [--concurrency 3]
 *   node copy-files.cjs verify ... [--head-only]
 *
 * What it moves: every file the migrated rows of ONE organization still reference by a Waboo URL (messages: only rows of a media kind; the url of a
 * text or interactive message, e.g. a maps link in its text, is a link and not a file):
 *   - messages.meta.legacy.mediaUrl (media_key NULL, or media_key holding a URL)  -> bucket S3_BUCKET_MEDIA,     UPDATE messages
 *   - contact_files.storage_key holding a URL                                    -> bucket S3_BUCKET_DOCUMENTS, UPDATE contact_files
 *   The dump's `attachments` registry (--attachments, NDJSON) only adds the expected size / content type and the plan statistics; a
 *   registry row nothing references is NOT copied (UNREFERENCED_NOT_COPIED). `file_manager` (one folder marker) has no target: untouched.
 *
 * Object key: messages `chat/<org id>/waboo/<first 16 hex of sha256(host+path)>/<lower-case name>` (the only shape the app serves: ChatMediaStore.ownsKey
 * + isSafeMediaKey), contact_files `contact-files/<org id>/waboo/<hash>/<lower-case name>` (stable: same URL -> same key, a retry overwrites).
 * What the app requires of a contact file key (origin/main, AZ-009): packages/contracts/src/crm/contact-file.ts:37-52 `safeStorageKey`
 * (1..1000 chars, relative: no leading `/`, no backslash, no URL scheme, no `.` / `..` segment, no control character) and
 * apps/api/src/modules/crm/contact-files/contact-files.service.ts:73-75 (a key shaped `<area>/<digits>/...` must carry THIS workspace's numeric
 * id, else 422). `<area>/<org id>/` is that shape, so the key is minted the way the service expects a per-workspace key to look. There is no
 * file-bytes reader for contact_files in the app yet (no download endpoint, bucket S3_BUCKET_DOCUMENTS only in config/env.schema.ts).
 * `copy --rekey` redoes MESSAGE rows an earlier version stored under the old `<org uuid>/waboo/` key (the app answered 404 for those),
 * stored in the row as a BARE key (the app's convention; its base folder is applied on read). --base-folder X puts the object at
 * `X/<key>` while the row keeps `<key>`: it must equal the platform "storage" setting's base folder.
 * The app reads media through the PLATFORM `storage` setting (bucket/endpoint saved in the admin UI), not through these env vars:
 * that setting must point at the same bucket, or the copied keys will not resolve.
 *
 * Row writes: ONE transaction per URL as crm_worker_user with app.org_id set, WHERE org_id = $org. `messages` and `contact_files` have
 * no touch trigger and no updated_at column (checked in the migrations), so an UPDATE changes nothing but the media columns; created_at
 * is never written. The old URL is kept in messages.meta.legacy.sourceUrl WITHOUT its query string (signed URLs carry tokens);
 * contact_files has no jsonb column, so its old URL is only in the state file (also query-free).
 *
 * Safety: https only, port 443, host must be in the config allow-list, a redirect may only stay on the same host (max 3), the resolved
 * address must not be private/loopback/link-local (checked at connect time, so DNS rebinding cannot slip through), size limit, timeouts.
 * Output never contains a URL path, query string or file name: only counts, hosts and reason codes.
 * Refuses when S3_ENDPOINT / keys / buckets are not set (the app would silently fall back to local disk; this tool never does).
 *
 * Config file (JSON): { "allowedHosts": ["files.example.com"], "authHeaders": { "files.example.com": { "name": "Authorization", "env": "WABOO_FILES_AUTH" } },
 *                       "maxFileMB": 50, "timeoutMs": 60000 }      (authHeaders is optional; the VALUE is read from that env var)
 * State file (JSONL, append-only, last line per key wins): resume + report. Failure reasons: HTTP_<status>, AUTH_REQUIRED, TOO_LARGE,
 * HOST_NOT_ALLOWED, SIZE_MISMATCH, NOT_HTTPS, PRIVATE_IP, TOO_MANY_REDIRECTS, NOT_A_FILE, NETWORK, TIMEOUT, UPLOAD_FAILED, NOT_URL, DB_UPDATE_FAILED.
 * Exit codes: 0 ok, 1 failures / verify exceptions, 2 refused or usage.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');

class Refused extends Error {}
class CopyError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const refuse = (m) => {
  throw new Refused(m);
};
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const enc = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// ---------- output: counts, hosts and codes only -------------------------------------------------------------------------------------
const scrub = (s) =>
  String(s)
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi, (m) => {
      try {
        return `<${new URL(m).host}>`;
      } catch {
        return '<url>';
      }
    })
    .slice(0, 400);
let OUT = (l) => console.log(scrub(l));
const say = (l = '') => OUT(l);

// ---------- address guard ------------------------------------------------------------------------------------------------------------
function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(l);
    if (m) return isPrivateIp(m[1]);
    return (
      l === '::' || l === '::1' || /^f[cd]/.test(l) || /^fe[89ab]/.test(l) || l.startsWith('ff')
    );
  }
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !(x >= 0 && x <= 255))) return true;
  const [a, b] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && p[2] === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function guardedLookup(allowPrivate) {
  return (host, o, cb) =>
    dns.lookup(host, o, (err, addr, fam) => {
      if (err) return cb(err);
      const list = Array.isArray(addr) ? addr.map((x) => x.address) : [addr];
      if (!allowPrivate && list.some(isPrivateIp)) return cb(new CopyError('PRIVATE_IP'));
      cb(null, addr, fam);
    });
}

// ---------- fetching the source ------------------------------------------------------------------------------------------------------
const MIME_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
};
const extOf = (p) => {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(p);
  return m ? m[1].toLowerCase() : '';
};
const WEB_TYPE = /^(text\/html|application\/(xml|json)|text\/xml|application\/xhtml)/;

function requestOnce(u, headers, cfg, hooks) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || undefined,
        path: u.pathname + u.search,
        method: 'GET',
        headers: { ...headers, 'accept-encoding': 'identity', 'user-agent': 'wadesk-files-copy' },
        lookup: guardedLookup(hooks.allowPrivate),
        timeout: cfg.timeoutMs,
      },
      resolve,
    );
    req.on('timeout', () => req.destroy(new CopyError('TIMEOUT')));
    req.on('error', reject);
    req.end();
  });
}

/** Downloads one URL under every guard; returns { buf, contentType }. Throws CopyError(code). */
async function download(rawUrl, cfg, hooks = {}) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new CopyError('NOT_URL');
  }
  const origin = u.hostname.toLowerCase();
  const max = cfg.maxFileMB * 1024 * 1024;
  const deadline = Date.now() + cfg.timeoutMs * 2;
  for (let hop = 0; hop <= 3; hop++) {
    const host = u.hostname.toLowerCase();
    if (host !== origin || !cfg.allowedHosts.includes(host)) throw new CopyError('HOST_NOT_ALLOWED');
    if (u.protocol !== 'https:' && !(hooks.allowHttp && u.protocol === 'http:'))
      throw new CopyError('NOT_HTTPS');
    if (!hooks.allowAnyPort && u.port && u.port !== '443') throw new CopyError('HOST_NOT_ALLOWED');
    const lit = host.replace(/^\[|\]$/g, '');
    if (net.isIP(lit) && !hooks.allowPrivate && isPrivateIp(lit)) throw new CopyError('PRIVATE_IP');
    const auth = cfg.authHeaders && cfg.authHeaders[host];
    const headers = {};
    if (auth && process.env[auth.env]) headers[auth.name] = process.env[auth.env];
    let res;
    try {
      res = await requestOnce(u, headers, cfg, hooks);
    } catch (e) {
      throw e instanceof CopyError ? e : new CopyError(/timeout/i.test(e.message) ? 'TIMEOUT' : 'NETWORK');
    }
    const st = res.statusCode;
    if (st >= 300 && st < 400 && res.headers.location) {
      res.resume();
      if (hop === 3) throw new CopyError('TOO_MANY_REDIRECTS');
      try {
        u = new URL(res.headers.location, u);
      } catch {
        throw new CopyError('NOT_URL');
      }
      continue;
    }
    if (st === 401 || st === 403) {
      res.resume();
      throw new CopyError('AUTH_REQUIRED');
    }
    if (st < 200 || st >= 300) {
      res.resume();
      throw new CopyError(`HTTP_${st}`);
    }
    const declared = res.headers['content-length'] === undefined ? null : Number(res.headers['content-length']);
    if (declared !== null && declared > max) {
      res.destroy();
      throw new CopyError('TOO_LARGE');
    }
    const chunks = [];
    let got = 0;
    await new Promise((ok, bad) => {
      const killer = setTimeout(() => res.destroy(new CopyError('TIMEOUT')), Math.max(1, deadline - Date.now()));
      res.on('data', (c) => {
        got += c.length;
        if (got > max) return res.destroy(new CopyError('TOO_LARGE'));
        chunks.push(c);
      });
      res.on('end', () => (clearTimeout(killer), ok()));
      res.on('error', (e) => (clearTimeout(killer), bad(e)));
      res.on('close', () => {
        clearTimeout(killer);
        if (!res.complete) bad(new CopyError('SIZE_MISMATCH'));
      });
    }).catch((e) => {
      throw e instanceof CopyError ? e : new CopyError(declared !== null && got < declared ? 'SIZE_MISMATCH' : 'NETWORK');
    });
    if (declared !== null && declared !== got) throw new CopyError('SIZE_MISMATCH');
    return { buf: Buffer.concat(chunks), contentType: String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase() };
  }
  throw new CopyError('TOO_MANY_REDIRECTS');
}

// ---------- S3 (SigV4, same signing as apps/api .../object-storage.probe.ts) ----------------------------------------------------------
function s3FromEnv(env, kinds) {
  const need = ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_REGION'];
  const buckets = { messages: 'S3_BUCKET_MEDIA', flows: 'S3_BUCKET_MEDIA', widgets: 'S3_BUCKET_MEDIA', contact_files: 'S3_BUCKET_DOCUMENTS' };
  const missing = [...need, ...kinds.map((k) => buckets[k])].filter((k) => !env[k] || !env[k].trim());
  if (missing.length)
    refuse(
      `STORAGE_NOT_CONFIGURED: ${missing.join(', ')} not set (without object storage the app falls back to local disk; this tool will not)`,
    );
  try {
    new URL(env.S3_ENDPOINT);
  } catch {
    refuse('STORAGE_NOT_CONFIGURED: S3_ENDPOINT is not a URL');
  }
  return {
    endpoint: env.S3_ENDPOINT.trim().replace(/\/+$/, ''),
    region: env.S3_REGION.trim(),
    id: env.S3_ACCESS_KEY_ID.trim(),
    secret: env.S3_SECRET_ACCESS_KEY.trim(),
    pathStyle: String(env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
    bucket: { messages: env[buckets.messages], flows: env[buckets.messages], widgets: env[buckets.messages], contact_files: env[buckets.contact_files] },
  };
}

function s3Sign(s3, bucket, method, key, body = Buffer.alloc(0), now = new Date()) {
  const base = new URL(s3.endpoint);
  const host = s3.pathStyle ? base.host : `${bucket}.${base.host}`;
  const p = (s3.pathStyle ? `/${enc(bucket)}` : '') + '/' + key.split('/').map(enc).join('/');
  const amz = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amz.slice(0, 8);
  const ph = sha256(body);
  const sh = 'host;x-amz-content-sha256;x-amz-date';
  const canon = [method, p, '', `host:${host}\nx-amz-content-sha256:${ph}\nx-amz-date:${amz}\n`, sh, ph].join('\n');
  const scope = `${day}/${s3.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, sha256(canon)].join('\n');
  const sk = hmac(hmac(hmac(hmac(`AWS4${s3.secret}`, day), s3.region), 's3'), 'aws4_request');
  const sig = crypto.createHmac('sha256', sk).update(toSign).digest('hex');
  return {
    url: `${base.protocol}//${host}${p}`,
    headers: {
      'x-amz-date': amz,
      'x-amz-content-sha256': ph,
      authorization: `AWS4-HMAC-SHA256 Credential=${s3.id}/${scope}, SignedHeaders=${sh}, Signature=${sig}`,
    },
  };
}

async function s3Put(s3, bucket, key, body, contentType) {
  const r = s3Sign(s3, bucket, 'PUT', key, body);
  const res = await fetch(r.url, {
    method: 'PUT',
    headers: { ...r.headers, 'content-type': contentType },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new CopyError('UPLOAD_FAILED');
  const etag = (res.headers.get('etag') || '').replace(/"/g, '');
  // a single-part ETag is the md5 of what the store received: a cheap end-to-end check next to the signed payload hash
  if (/^[0-9a-f]{32}$/.test(etag) && etag !== crypto.createHash('md5').update(body).digest('hex'))
    throw new CopyError('UPLOAD_FAILED');
}

/** { size, sha256|null } or null when the object is missing. */
async function s3Stat(s3, bucket, key, withHash) {
  const r = s3Sign(s3, bucket, withHash ? 'GET' : 'HEAD', key);
  const res = await fetch(r.url, { method: withHash ? 'GET' : 'HEAD', headers: r.headers, signal: AbortSignal.timeout(60_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new CopyError(`HTTP_${res.status}`);
  if (!withHash) return { size: Number(res.headers.get('content-length')), sha256: null };
  const h = crypto.createHash('sha256');
  let n = 0;
  for await (const c of res.body) (h.update(c), (n += c.length));
  return { size: n, sha256: h.digest('hex') };
}

// ---------- config, registry, state --------------------------------------------------------------------------------------------------
function loadConfig(file) {
  let c;
  try {
    c = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    refuse('--config is missing or is not valid JSON');
  }
  if (!Array.isArray(c.allowedHosts) || c.allowedHosts.length === 0)
    refuse('config.allowedHosts must list at least one host (the Waboo file hosts)');
  return {
    allowedHosts: c.allowedHosts.map((h) => String(h).toLowerCase()),
    authHeaders: c.authHeaders || {},
    maxFileMB: Number(c.maxFileMB) > 0 ? Number(c.maxFileMB) : 50,
    timeoutMs: Number(c.timeoutMs) > 0 ? Number(c.timeoutMs) : 60_000,
    // public https origin of the R2 media bucket (custom domain or r2.dev): a flow sends its media by link, so the rewritten step needs a public URL
    flowMediaBase: typeof c.flowMediaPublicBase === 'string' ? c.flowMediaPublicBase.trim().replace(/\/+$/, '') : '',
  };
}

/** Normalised identity of a source URL: host + path (query and fragment are tokens or noise). null when it is not an http(s) URL. */
function urlId(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return { host: u.hostname.toLowerCase(), path: u.pathname, key: sha256(`${u.hostname.toLowerCase()}${u.pathname}`) };
  } catch {
    return null;
  }
}
const strip = (raw) => {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '';
  }
};

function loadRegistry(file) {
  const out = { rows: 0, withSource: 0, deleted: 0, byKey: new Map() };
  if (!file) return out;
  const num = (v) => (v && typeof v === 'object' ? Number(v.$numberLong ?? v.$numberInt ?? NaN) : Number(v));
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    out.rows++;
    if (d.is_deleted === true) out.deleted++;
    const id = typeof d.source === 'string' ? urlId(d.source) : null;
    if (!id) continue;
    out.withSource++;
    const size = num(d.file_size);
    out.byKey.set(id.key, { size: Number.isFinite(size) ? size : null, ct: d.content_type || d.mime_type || null });
  }
  return out;
}

function loadState(file) {
  const m = new Map();
  if (file && fs.existsSync(file))
    for (const l of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!l.trim()) continue;
      try {
        const e = JSON.parse(l);
        m.set(e.k, e);
      } catch {
        /* a torn last line is ignored */
      }
    }
  return m;
}
const appendState = (file, e) => file && fs.appendFileSync(file, JSON.stringify(e) + '\n');

// ---------- database -----------------------------------------------------------------------------------------------------------------
function pgParse(url) {
  const p = require.resolve('pg-connection-string', { paths: [path.dirname(require.resolve('pg'))] });
  return require(p).parse(url);
}
function assertTargetAllowed(url, flags) {
  let u;
  try {
    u = new URL(url);
  } catch {
    refuse('the database URL cannot be parsed (not printed: it holds a password)');
  }
  for (const k of ['host', 'hostaddr', 'service', 'socket', 'unix_socket', 'sslrootcert'])
    if (u.searchParams.has(k)) refuse(`refusing a database URL with a ?${k}= override`);
  const o = u.searchParams.get('options');
  if (o !== null && /host/i.test(o)) refuse('refusing a database URL whose ?options= mentions a host');
  const eff = String(pgParse(url).host ?? '').replace(/^\[|\]$/g, '').toLowerCase();
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!eff || !host || eff.startsWith('/') || eff !== host) refuse('refusing a database URL with an unclear host');
  const dbName = decodeURIComponent(u.pathname.replace(/^\//, ''));
  const loop = host === 'localhost' || host === '::1' || /^127\./.test(host);
  const docker = ['crm-postgres', 'crm-platform-postgres', 'host.docker.internal', ...String(flags['allow-docker-host'] ?? '').split(','), ...String(process.env.MIGRATION_ALLOW_DOCKER_HOSTS ?? '').split(',')]
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  if (!loop && !docker.includes(host) && !String(flags['allow-target-host'] ?? '').toLowerCase().split(',').includes(host))
    refuse(`refusing to run against ${host}: not localhost / a known docker name (--allow-docker-host ${host} for a compose service)`);
  if (flags['confirm-db-name'] !== dbName) refuse(`--confirm-db-name must be exactly the database name (${dbName})`);
}

async function connect(flags) {
  const url = process.env.TARGET_DATABASE_URL;
  if (!url) refuse('TARGET_DATABASE_URL (the crm_worker_user login) is not set');
  assertTargetAllowed(url, flags);
  const { Client } = require('pg');
  const db = new Client({ connectionString: url, application_name: 'waboo-files-copy', connectionTimeoutMillis: 10_000 });
  await db.connect();
  const me = (await db.query('SELECT r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user')).rows[0];
  if (me.rolsuper || me.rolbypassrls) {
    await db.end();
    refuse('this login bypasses row-level security: use the crm_worker_user login');
  }
  return db;
}

async function tenant(db, orgId, fn, readOnly = false) {
  await db.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
  try {
    await db.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgId)]);
    await db.query(`SELECT set_config('app.user_id', '', true)`);
    const r = await fn();
    await db.query(readOnly ? 'ROLLBACK' : 'COMMIT');
    return r;
  } catch (e) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw e;
  }
}

async function findOrg(db, slug) {
  await db.query('BEGIN READ ONLY');
  try {
    await db.query(`SELECT set_config('app.privileged', 'on', true)`);
    const r = await db.query('SELECT id, uuid::text AS uuid FROM organizations WHERE lower(slug) = $1', [slug.toLowerCase()]);
    if (r.rows.length !== 1) refuse(r.rows.length ? `more than one organization matches "${slug}"` : `no organization with slug "${slug}"`);
    return r.rows[0];
  } finally {
    await db.query('ROLLBACK');
  }
}

/** Every string of a parsed JSON value that is an http(s) URL on one of the hosts. */
function jsonUrls(v, hosts, out = new Set()) {
  if (typeof v === 'string') {
    const id = /^https?:\/\//i.test(v) ? urlId(v) : null;
    if (id && hosts.includes(id.host)) out.add(v);
  } else if (Array.isArray(v)) for (const x of v) jsonUrls(x, hosts, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) jsonUrls(x, hosts, out);
  return out;
}
/** The same value with every string equal to `from` replaced by `to`; changed = how many. */
function jsonReplace(v, from, to, cnt = { n: 0 }) {
  if (typeof v === 'string') return v === from ? (cnt.n++, to) : v;
  if (Array.isArray(v)) return v.map((x) => jsonReplace(x, from, to, cnt));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonReplace(x, from, to, cnt)]));
  return v;
}

/** Every row of the org that still points at an http(s) URL. */
async function collectRefs(db, org, rekey = false, cfg = { allowedHosts: [] }) {
  return tenant(
    db,
    org.id,
    async () => {
      // --rekey: rows copied by an earlier version of this tool under `<org uuid>/waboo/...` (a key the app refuses to serve) are fetched
      // again from the query-free source url kept in meta.legacy.sourceUrl and stored under the key the app accepts
      const m = rekey
        ? await db.query(
            `SELECT id, created_at::text AS created_at, meta->'legacy'->>'sourceUrl' AS url, media_key AS match
               FROM messages
              WHERE org_id = $1 AND media_key LIKE $2 AND meta->'legacy'->>'sourceUrl' ~* '^https?://'`,
            [org.id, `${org.uuid}/waboo/%`],
          )
        : await db.query(
            `SELECT id, created_at::text AS created_at, COALESCE(meta->'legacy'->>'mediaUrl', media_key) AS url
               FROM messages
              WHERE org_id = $1 AND (media_key IS NULL OR media_key ~* '^https?://') AND kind IN ('image', 'video', 'audio', 'voice', 'document', 'sticker')
                AND COALESCE(meta->'legacy'->>'mediaUrl', media_key) ~* '^https?://'`,
            [org.id],
          );
      const c = rekey ? { rows: [] } : await db.query(`SELECT id, storage_key AS url FROM contact_files WHERE org_id = $1 AND storage_key ~* '^https?://'`, [org.id]);
      // media steps of converted flows hold the Waboo address inside flow_data
      const f = rekey ? { rows: [] } : await db.query(`SELECT id, flow_data FROM flows WHERE org_id = $1 AND flow_data IS NOT NULL`, [org.id]);
      const flowRefs = f.rows.flatMap((r) => [...jsonUrls(r.flow_data, cfg.allowedHosts)].map((url) => ({ kind: 'flows', id: r.id, url, match: url })));
      // chat widgets: the launcher image, the body background image (text columns) and the launcher avatar (inside the launcher jsonb)
      const w = rekey ? { rows: [] } : await db.query(`SELECT id, button_image_url, body_bg_image_url, launcher FROM chatbot_widgets WHERE org_id = $1`, [org.id]);
      const onWaboo = (u) => typeof u === 'string' && cfg.allowedHosts.includes(urlId(u)?.host);
      const widgetRefs = w.rows.flatMap((r) =>
        [r.button_image_url, r.body_bg_image_url, r.launcher && r.launcher.avatar]
          .filter(onWaboo)
          .filter((u, i, a) => a.indexOf(u) === i)
          .map((url) => ({ kind: 'widgets', id: r.id, url, match: url })),
      );
      return [
        ...flowRefs,
        ...widgetRefs,
        ...m.rows.map((r) => ({ kind: 'messages', id: r.id, created_at: r.created_at, url: r.url, match: r.match ?? r.url })),
        ...c.rows.map((r) => ({ kind: 'contact_files', id: r.id, url: r.url })),
      ];
    },
    true,
  );
}

/** Groups references by (table, normalised URL): one download serves every row. */
function groupRefs(refs) {
  const groups = new Map();
  let notUrl = 0;
  for (const r of refs) {
    const id = urlId(r.url);
    if (!id) {
      notUrl++;
      continue;
    }
    const k = `${r.kind}:${id.key}`;
    if (!groups.has(k)) groups.set(k, { k, kind: r.kind, id, url: r.url, refs: [] });
    groups.get(k).refs.push(r);
  }
  return { groups: [...groups.values()], notUrl };
}

function safeName(p) {
  let n = '';
  try {
    n = decodeURIComponent(path.posix.basename(p));
  } catch {
    n = path.posix.basename(p);
  }
  // the app serves a key only when every segment is lower-case [a-z0-9][a-z0-9._-]* (isSafeMediaKey): lower-case it, start with a letter or digit
  n = n.toLowerCase().replace(/[^a-z0-9._-]+/g, '_').replace(/^[^a-z0-9]+/, '').slice(0, 100);
  return n || 'file';
}
// messages: the app's ChatMediaStore.ownsKey() accepts only `chat/<org id>/...`; contact_files: `<area>/<org id>/` (contact-files.service.ts:73-75)
const keyPrefix = (org, g) => (g.kind === 'messages' ? `chat/${org.id}/waboo` : g.kind === 'flows' ? `flow-media/${org.id}/waboo` : g.kind === 'widgets' ? `widget-media/${org.id}/waboo` : `contact-files/${org.id}/waboo`);
const targetKeyOf = (org, g) => `${keyPrefix(org, g)}/${g.id.key.slice(0, 16)}/${safeName(g.id.path)}`;
const fullKey = (prefix, k) => (prefix ? `${prefix}/${k}` : k);

async function applyFlowRows(db, org, g, done, publicUrl) {
  return tenant(db, org.id, async () => {
    let changed = 0;
    for (const r of g.refs) {
      const row = (await db.query(`SELECT flow_data FROM flows WHERE org_id = $1 AND id = $2 FOR UPDATE`, [org.id, r.id])).rows[0];
      if (!row) continue;
      const cnt = { n: 0 };
      const next = jsonReplace(row.flow_data, r.url, publicUrl, cnt);
      if (cnt.n === 0) continue;
      await db.query(`UPDATE flows SET flow_data = $3::jsonb WHERE org_id = $1 AND id = $2`, [org.id, r.id, JSON.stringify(next)]);
      changed++;
    }
    return changed;
  });
}

async function applyWidgetRows(db, org, g, publicUrl) {
  return tenant(db, org.id, async () => {
    let changed = 0;
    for (const r of g.refs) {
      const res = await db.query(
        `UPDATE chatbot_widgets SET
           button_image_url = CASE WHEN button_image_url = $3 THEN $4 ELSE button_image_url END,
           body_bg_image_url = CASE WHEN body_bg_image_url = $3 THEN $4 ELSE body_bg_image_url END,
           launcher = CASE WHEN launcher->>'avatar' = $3 THEN jsonb_set(launcher, '{avatar}', to_jsonb($4::text)) ELSE launcher END
         WHERE org_id = $1 AND id = $2 AND ($3 IN (COALESCE(button_image_url, ''), COALESCE(body_bg_image_url, ''), COALESCE(launcher->>'avatar', '')))`,
        [org.id, r.id, r.url, publicUrl],
      );
      changed += res.rowCount;
    }
    return changed;
  });
}

async function applyRows(db, org, g, done, cfg = {}) {
  if (g.kind === 'widgets') return applyWidgetRows(db, org, g, `${cfg.flowMediaBase}/${done.objectKey}`);
  if (g.kind === 'flows') return applyFlowRows(db, org, g, done, `${cfg.flowMediaBase}/${done.objectKey}`);
  return tenant(db, org.id, async () => {
    let changed = 0;
    for (const r of g.refs) {
      const res =
        g.kind === 'messages'
          ? await db.query(
              `UPDATE messages SET media_key = $4, media_mime = COALESCE(media_mime, $5), media_size = $6,
                      media_name = COALESCE(media_name, $7), media_sha256 = $8,
                      meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{legacy}',
                               (COALESCE(meta->'legacy', '{}'::jsonb) - 'mediaUrl') || jsonb_build_object('sourceUrl', $9::text, 'filesCopiedAt', $10::text))
                WHERE org_id = $1 AND id = $2 AND created_at = $3::timestamptz AND (meta->'legacy'->>'mediaUrl' = $11 OR media_key = $11)`,
              [org.id, r.id, r.created_at, done.targetKey, done.mime, done.bytes, safeName(g.id.path), done.sha256, strip(g.url), new Date().toISOString(), r.match ?? r.url],
            )
          : await db.query(
              `UPDATE contact_files SET storage_key = $4, mime_type = COALESCE(mime_type, $5), file_size_bytes = $6
                WHERE org_id = $1 AND id = $2 AND storage_key = $3`,
              [org.id, r.id, r.url, done.targetKey, done.mime, done.bytes],
            );
      changed += res.rowCount;
    }
    return changed;
  });
}

// ---------- phases -------------------------------------------------------------------------------------------------------------------
const tally = (m, k) => m.set(k, (m.get(k) || 0) + 1);
const lines = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  ') || '(none)';
const SIGNED = /([?&])(x-amz-signature|signature|sig|token|expires|x-amz-expires|se|sv)=/i;

function plan(groups, notUrl, cfg, reg, state, byTable) {
  const hosts = new Map(), exts = new Map(), mimes = new Map();
  let bytes = 0, known = 0, signed = 0, authHdr = 0, blocked = 0, done = 0, refsN = 0, mismatchedExt = 0;
  const referenced = new Set();
  for (const g of groups) {
    refsN += g.refs.length;
    tally(hosts, g.id.host);
    tally(exts, extOf(g.id.path) || '(none)');
    const r = reg.byKey.get(g.id.key);
    referenced.add(g.id.key);
    if (r) {
      tally(mimes, r.ct || '(null)');
      if (r.size !== null) (bytes += r.size, known++);
    }
    signed += g.refs.filter((x) => SIGNED.test(x.url)).length;
    if (cfg.authHeaders[g.id.host]) authHdr++;
    if (!cfg.allowedHosts.includes(g.id.host)) blocked++;
    if (state.get(g.k)?.status === 'done') done++;
    if (r && r.ct && MIME_BY_EXT[extOf(g.id.path)] && !String(r.ct).startsWith(MIME_BY_EXT[extOf(g.id.path)].split('/')[0])) mismatchedExt++;
  }
  say(`rows referencing a URL: messages=${byTable.messages || 0} contact_files=${byTable.contact_files || 0}  (not a URL: ${notUrl})`);
  say(`distinct files (per table): ${groups.length}   duplicate references: ${refsN - groups.length}`);
  say(`by host: ${lines(hosts)}`);
  say(`by extension: ${lines(exts)}`);
  say(`by registry content type: ${lines(mimes)}${mismatchedExt ? `   (registry type disagrees with extension: ${mismatchedExt})` : ''}`);
  say(`bytes known from registry: ${bytes} (${(bytes / 1e9).toFixed(3)} GB) for ${known} of ${groups.length} files`);
  say(`need auth: ${signed} rows carry a signature/token in the query, ${authHdr} files are on a host with a configured auth header`);
  say(`host not in allow-list (would fail HOST_NOT_ALLOWED): ${blocked}`);
  say(`already copied per state file: ${done}`);
  if (reg.rows) {
    const unref = [...reg.byKey.keys()].filter((k) => !referenced.has(k)).length;
    say(`attachments registry: rows=${reg.rows} with-source=${reg.withSource} soft-deleted=${reg.deleted} not-referenced-by-a-migrated-row (UNREFERENCED_NOT_COPIED)=${unref}`);
  }
  say('file_manager: 1 folder marker per client, no target table: nothing to copy');
}

async function runCopy(ctx) {
  const { db, org, groups, cfg, reg, state, s3, flags, hooks } = ctx;
  const maxFiles = Number(flags['max-files']);
  const maxBytes = Number(flags['max-gb']) * 1e9;
  const conc = Math.max(1, Number(flags.concurrency || 3));
  const delay = Number(flags['delay-ms'] || 200);
  const prefix = (flags['base-folder'] || '').replace(/^\/+|\/+$/g, '');
  const queue = [...groups];
  const stats = { copied: 0, resumed: 0, failed: 0, deferred: 0, rows: 0, bytes: 0, rowsUnchanged: 0 };
  const reasons = new Map();
  let attempted = 0;
  const fail = (g, code) => {
    stats.failed++;
    tally(reasons, code);
    appendState(flags.state, { k: g.k, status: 'failed', reason: code, host: g.id.host, at: new Date().toISOString() });
  };
  // ONE pg client is shared by all workers: interleaved BEGIN/COMMIT drop the per-transaction org setting, so row-level security
  // silently matched nothing for some rows (seen with --concurrency 3). Downloads and uploads stay parallel; row writes are serialised.
  let dbChain = Promise.resolve();
  const serial = (fn) => {
    const p = dbChain.then(fn, fn);
    dbChain = p.catch(() => {});
    return p;
  };
  async function one(g) {
    let done = state.get(g.k);
    if (!(done && done.status === 'done')) {
      if (attempted >= maxFiles || stats.bytes >= maxBytes) return void stats.deferred++;
      attempted++;
      try {
        const exp = reg.byKey.get(g.id.key);
        const { buf, contentType } = await download(g.url, cfg, hooks);
        if (exp && exp.size !== null && exp.size !== buf.length) throw new CopyError('SIZE_MISMATCH');
        if (WEB_TYPE.test(contentType) && !/^(html?|xml|json)$/.test(extOf(g.id.path))) throw new CopyError('NOT_A_FILE');
        const mime =
          contentType && contentType !== 'application/octet-stream' ? contentType : exp?.ct || MIME_BY_EXT[extOf(g.id.path)] || 'application/octet-stream';
        const targetKey = targetKeyOf(org, g);
        await s3Put(s3, s3.bucket[g.kind], fullKey(prefix, targetKey), buf, mime);
        done = { k: g.k, status: 'done', kind: g.kind, bucket: s3.bucket[g.kind], targetKey, objectKey: fullKey(prefix, targetKey), bytes: buf.length, sha256: sha256(buf), mime, sourceUrl: strip(g.url), host: g.id.host, at: new Date().toISOString() };
        appendState(flags.state, done);
        state.set(g.k, done);
        stats.copied++;
        stats.bytes += buf.length;
      } catch (e) {
        return fail(g, e instanceof CopyError ? e.code : 'NETWORK');
      }
    } else stats.resumed++;
    try {
      const n = await serial(() => applyRows(db, org, g, done, cfg));
      stats.rows += n;
      stats.rowsUnchanged += g.refs.length - n;
    } catch {
      fail(g, 'DB_UPDATE_FAILED');
      // keep the 'done' record for resume: the object is already there
      appendState(flags.state, done);
    }
  }
  await Promise.all(
    Array.from({ length: conc }, async () => {
      while (queue.length) {
        await one(queue.shift());
        if (delay) await new Promise((r) => setTimeout(r, delay));
      }
    }),
  );
  say(`copied=${stats.copied} resumed-from-state=${stats.resumed} failed=${stats.failed} deferred-by-limit=${stats.deferred}`);
  say(`rows updated=${stats.rows} rows already changed/not matching=${stats.rowsUnchanged}  bytes copied=${stats.bytes}`);
  say(`failures by reason: ${lines(reasons)}`);
  return stats.failed ? 1 : 0;
}

async function runVerify(ctx) {
  const { db, org, cfg, state, s3, flags } = ctx;
  const prefix = (flags['base-folder'] || '').replace(/^\/+|\/+$/g, '');
  const head = Boolean(flags['head-only']);
  const [msgs, cfs, left, noSource, flowRows, widgetRows] = await tenant(
    db,
    org.id,
    async () => [
      (await db.query(`SELECT media_key AS key, media_size AS size, media_sha256 AS sha, kind FROM messages WHERE org_id = $1 AND media_key LIKE $2`, [org.id, `chat/${org.id}/waboo/%`])).rows,
      (await db.query(`SELECT storage_key AS key, file_size_bytes AS size FROM contact_files WHERE org_id = $1 AND storage_key LIKE $2`, [org.id, `contact-files/${org.id}/waboo/%`])).rows,
      (await db.query(
        `SELECT 'messages' AS t, COALESCE(meta->'legacy'->>'mediaUrl', media_key) AS url FROM messages
          WHERE org_id = $1 AND (media_key IS NULL OR media_key ~* '^https?://') AND kind IN ('image', 'video', 'audio', 'voice', 'document', 'sticker') AND COALESCE(meta->'legacy'->>'mediaUrl', media_key) ~* '^https?://'
         UNION ALL SELECT 'contact_files', storage_key FROM contact_files WHERE org_id = $1 AND storage_key ~* '^https?://'`,
        [org.id],
      )).rows,
      // media-kind messages (a header image of a button message included) that have neither a stored object nor a URL to copy it from:
      // nothing can ever serve them, so they are listed as a problem instead of passing unnoticed
      (await db.query(
        `SELECT kind, count(*)::int AS n FROM messages
          WHERE org_id = $1 AND kind IN ('image', 'video', 'audio', 'voice', 'document', 'sticker') AND media_key IS NULL
            AND COALESCE(meta->'legacy'->>'mediaUrl', '') !~* '^https?://' AND meta->'legacy' IS NOT NULL AND meta->'legacy'->>'src' = 'waboo'
          GROUP BY kind`,
        [org.id],
      )).rows,
      (await db.query(`SELECT flow_data FROM flows WHERE org_id = $1 AND flow_data IS NOT NULL`, [org.id])).rows,
      (await db.query(`SELECT button_image_url, body_bg_image_url, launcher FROM chatbot_widgets WHERE org_id = $1`, [org.id])).rows,
    ],
    true,
  );
  // flows: any link still on a Waboo host is a leftover; a link under the R2 public base must exist in the bucket
  const flowUrls = flowRows.flatMap((r) => [...jsonUrls(r.flow_data, cfg.allowedHosts)]);
  for (const u of flowUrls) left.push({ t: 'flows', url: u });
  for (const r of widgetRows)
    for (const u of [r.button_image_url, r.body_bg_image_url, r.launcher && r.launcher.avatar])
      if (typeof u === 'string' && cfg.allowedHosts.includes(urlId(u)?.host)) left.push({ t: 'widgets', url: u });
  const base = cfg.flowMediaBase;
  const flowObjects = new Set();
  if (base)
    for (const r of flowRows) {
      const walk = (v) => {
        if (typeof v === 'string') {
          if (v.startsWith(`${base}/`) && /\/flow-media\/\d+\/waboo\//.test(v)) flowObjects.add(v.slice(base.length + 1));
        } else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.values(v).forEach(walk);
      };
      walk(r.flow_data);
    }
  for (const r of widgetRows)
    for (const u of [r.button_image_url, r.body_bg_image_url, r.launcher && r.launcher.avatar])
      if (base && typeof u === 'string' && u.startsWith(`${base}/`) && /\/widget-media\/\d+\/waboo\//.test(u)) flowObjects.add(u.slice(base.length + 1));
  const shaByKey = new Map([...state.values()].filter((e) => e.status === 'done').map((e) => [e.targetKey, e.sha256]));
  const jobs = [
    ...msgs.map((r) => ({ bucket: s3.bucket.messages, ...r })),
    ...cfs.map((r) => ({ bucket: s3.bucket.contact_files, ...r, sha: shaByKey.get(r.key) || null })),
    // the object key already carries the base folder (the public URL is origin + object key)
    ...[...flowObjects].map((k) => ({ bucket: s3.bucket.flows, key: k, size: null, sha: null, kind: 'flows', raw: true })),
  ];
  const bad = new Map();
  const byKind = new Map();
  for (const r of noSource) bad.set(`NO_SOURCE_${String(r.kind).toUpperCase()}`, r.n);
  for (const j of msgs) tally(byKind, j.kind);
  if (flowObjects.size) byKind.set('flows (R2 objects)', flowObjects.size);
  const q = [...jobs];
  await Promise.all(
    Array.from({ length: Math.max(1, Number(flags.concurrency || 3)) }, async () => {
      while (q.length) {
        const j = q.shift();
        try {
          const st = await s3Stat(s3, j.bucket, j.raw ? j.key : fullKey(prefix, j.key), !head && Boolean(j.sha));
          if (!st) tally(bad, 'OBJECT_MISSING');
          else if (j.size !== null && Number(j.size) !== st.size) tally(bad, 'SIZE_MISMATCH');
          else if (j.sha && st.sha256 && st.sha256 !== j.sha) tally(bad, 'SHA256_MISMATCH');
        } catch {
          tally(bad, 'CHECK_FAILED');
        }
      }
    }),
  );
  const pointing = new Map();
  for (const r of left) tally(pointing, `${r.t}@${urlId(r.url)?.host ?? '(not a URL)'}${cfg.allowedHosts.includes(urlId(r.url)?.host) ? ' [waboo host]' : ''}`);
  const failedByReason = new Map();
  for (const e of state.values()) if (e.status === 'failed') tally(failedByReason, e.reason);
  say(`objects checked=${jobs.length} (${head ? 'size only' : 'size + sha256 where known'}) problems: ${lines(bad)}`);
  say(`stored message files by kind: ${lines(byKind)}`);
  say(`rows still pointing at a URL: ${left.length}  by table@host: ${lines(pointing)}`);
  say(`last recorded failure per file (state): ${lines(failedByReason)}`);
  return bad.size || left.length ? 1 : 0;
}

// ---------- CLI ----------------------------------------------------------------------------------------------------------------------
const FLAGS = new Set(['org-slug', 'confirm-db-name', 'confirm-org-slug', 'config', 'attachments', 'state', 'apply', 'max-files', 'max-gb', 'concurrency', 'delay-ms', 'base-folder', 'head-only', 'rekey', 'allow-docker-host', 'allow-target-host']);
function parseFlags(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) refuse('unexpected argument');
    const eq = a.indexOf('=');
    const k = eq > 0 ? a.slice(2, eq) : a.slice(2);
    if (!FLAGS.has(k)) refuse(`unknown flag --${k.slice(0, 40)}`);
    f[k] = eq > 0 ? a.slice(eq + 1) : ['apply', 'head-only', 'rekey'].includes(k) ? true : argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : '';
  }
  return f;
}

async function main(argv, hooks = {}) {
  const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'plan';
  if (!['plan', 'copy', 'verify'].includes(cmd)) refuse('command is plan | copy | verify');
  const flags = parseFlags(argv[0] && !argv[0].startsWith('--') ? argv.slice(1) : argv);
  for (const k of ['org-slug', 'confirm-db-name', 'config']) if (!flags[k]) refuse(`--${k} is required`);
  const apply = cmd === 'copy' && flags.apply === true;
  if (apply) {
    if (String(flags['confirm-org-slug']).toLowerCase() !== String(flags['org-slug']).toLowerCase()) refuse('--confirm-org-slug must equal --org-slug');
    const mf = Number(flags['max-files']), mg = Number(flags['max-gb']);
    if (!(mf > 0) || !(mg > 0)) refuse('--max-files and --max-gb are required (positive numbers) with --apply');
    if (!flags.state) refuse('--state <file> is required with --apply (resume and report)');
  }
  const cfg = loadConfig(flags.config);
  const reg = loadRegistry(flags.attachments);
  const state = loadState(flags.state);
  const db = await connect(flags);
  try {
    const org = await findOrg(db, flags['org-slug']);
    const refs = await collectRefs(db, org, !!flags.rekey, cfg);
    const { groups, notUrl } = groupRefs(refs);
    const byTable = {};
    for (const r of refs) byTable[r.kind] = (byTable[r.kind] || 0) + 1;
    if (cmd === 'plan' || (cmd === 'copy' && !apply)) {
      plan(groups, notUrl, cfg, reg, state, byTable);
      say(cmd === 'copy' ? 'dry run: nothing was downloaded, uploaded or written (add --apply with the limits)' : '');
      return 0;
    }
    if (apply && (byTable.flows || byTable.widgets) && !/^https:\/\//.test(cfg.flowMediaBase)) refuse('config.flowMediaPublicBase (the public https origin of the R2 media bucket) is required: converted flows and chat widgets show their images by link');
    const kinds = cmd === 'verify' ? ['messages', 'contact_files', 'flows'] : [...new Set(groups.map((g) => g.kind))];
    const s3 = s3FromEnv(process.env, kinds.length ? kinds : ['messages']);
    const ctx = { db, org, groups, cfg, reg, state, s3, flags, hooks };
    return cmd === 'verify' ? await runVerify(ctx) : await runCopy(ctx);
  } finally {
    await db.end().catch(() => undefined);
  }
}

module.exports = { main, jsonUrls, jsonReplace, download, isPrivateIp, s3Sign, s3FromEnv, urlId, safeName, targetKeyOf, setOut: (f) => (OUT = f), scrub };

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      const msg = scrub(String(e && e.message ? e.message : e).split('\n')[0]);
      console.error(e instanceof Refused ? `refused: ${msg}` : `failed: ${msg}`);
      process.exit(e instanceof Refused ? 2 : 1);
    },
  );
}
