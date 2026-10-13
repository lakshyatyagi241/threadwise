'use strict';
/**
 * node --test pilot/credentials/import-whatsapp-credentials.test.cjs     (needs the scratch DB: node pilot/scratch-db.cjs up)
 * Invented organizations, channels and tokens only, in the local scratch database; everything it creates is deleted at the end.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../../../..'); // crm-platform
const API_MODULES = path.join(ROOT, 'apps/api/node_modules');
const SCRIPT = path.join(__dirname, 'import-whatsapp-credentials.cjs');
const ENV_FILE = path.resolve(__dirname, '../.scratch.env');
const skip = fs.existsSync(ENV_FILE) ? false : 'scratch database is not up (node pilot/scratch-db.cjs up)';

process.env.NODE_PATH = API_MODULES;
require('node:module').Module._initPaths();
const { Client } = require('pg');
const ts = require('typescript');

const env = Object.fromEntries(
  fs.existsSync(ENV_FILE)
    ? fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
    : [],
);
const KEY = crypto.randomBytes(32).toString('base64');
const OTHER_KEY = crypto.randomBytes(32).toString('base64');
const fake = (prefix = 'EA') => prefix + crypto.randomBytes(24).toString('hex');
const digits = (n) => String(Math.floor(Math.random() * 9 * 10 ** (n - 1)) + 10 ** (n - 1));

// ---- the app's real CryptoService, compiled from the repo source ---------------------------------------------------------------------
const cryptoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-crypto-'));
fs.writeFileSync(
  path.join(cryptoDir, 'crypto.service.js'),
  ts.transpileModule(fs.readFileSync(path.join(ROOT, 'apps/api/src/common/crypto/crypto.service.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText,
);
const { CryptoService } = require(path.join(cryptoDir, 'crypto.service.js'));
const appCrypto = (key = KEY, prev = '') => new CryptoService({ get: (k) => ({ CREDENTIALS_ENCRYPTION_KEY: key, CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS: prev })[k] });

// ---- fixtures -------------------------------------------------------------------------------------------------------------------------
const tag = `t${process.pid}${Date.now().toString(36)}`;
const A = { client: `${tag}a`, slug: `${tag}-a` };
const B = { client: `${tag}b`, slug: `${tag}-b` };
const ext = { one: digits(15), two: digits(15), other: digits(15), bOnly: digits(15), noChan: digits(15), conn: digits(15) };
const waba = { one: digits(15), two: digits(15) };
const tok = { one: fake(), two: fake(), conn: fake(), google: fake('ya29.'), refresh: fake('1//'), secret: fake('GOCSPX-'), openai: fake('sk-'), auth: fake('AK'), changed: fake() };
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-work-'));
const owner = () => new Client({ connectionString: env.MIGRATION_DATABASE_URL });
async function q(sql, params = []) {
  const c = owner();
  await c.connect();
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end();
  }
}
const ALL_OUT = [];
const ALL_SECRETS = Object.values(tok).concat([KEY, OTHER_KEY]);

function runScript(args, over = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', NODE_PATH: API_MODULES, TARGET_DATABASE_URL: env.TARGET_DATABASE_URL, CREDENTIALS_ENCRYPTION_KEY: KEY, ...over },
    encoding: 'utf8',
  });
  const out = `${r.stdout}${r.stderr}`;
  ALL_OUT.push(out);
  return { status: r.status, out };
}
const dbName = () => new URL(env.TARGET_DATABASE_URL).pathname.slice(1);
const base = (client, slug, extra = []) => ['--client', client, '--org-slug', slug, '--confirm-db-name', dbName(), '--dumps-dir', work, ...extra];
const applyArgs = (client, slug, extra = []) => base(client, slug, ['--apply', '--confirm-org-slug', slug, ...extra]);

function writeClient(client, { docs, map }) {
  const dir = path.join(work, client);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'chatbot_misc_config.ndjson'), docs.map((d) => JSON.stringify(d)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'channel-map.json'), JSON.stringify(map));
}
const wa = (e, w, token, extra = {}) => ({
  id: 'x', config_key: 'META_WHATSAPP_CONFIG', is_json: true, deleted_time: null, is_active: true, workspace_id: 'ws', chatbot_id: null,
  config_value: { access_token: token, phoneID: e, waba_id: w, whatsapp_no: '919800000000', display_name: 'Test', quality_rating: 'GREEN', ...extra },
});
const entry = (e, name) => ({ kind: 'whatsapp_cloud', externalId: e, displayAddress: '+91 98000 00000', name });
const docsA = () => [
  wa(ext.one, waba.one, tok.one),
  wa(ext.two, waba.two, tok.two, { auth_key: tok.auth }),
  { id: 'g', config_key: 'GOOGLE_SHEETS', is_json: true, deleted_time: null, is_active: true, config_value: { email: 'a@b.c', token: tok.google, refresh_token: tok.refresh, client_secret: tok.secret, scopes: [], connected_sheets: [] } },
  { id: 'o', config_key: 'OPENAI', is_json: true, deleted_time: null, is_active: true, config_value: { openai_api_key: tok.openai } },
];
const mapA = () => ({ botA1: entry(ext.one, 'One'), botA2: entry(ext.two, 'Two') });

let orgA, orgB;
const channelsDigest = async () => q(`SELECT org_id, id, md5(c::text) h FROM channels c WHERE org_id IN ($1, $2) ORDER BY 1,2`, [orgA, orgB]);
const cfgOf = async (e) => q(`SELECT * FROM wa_provider_configs WHERE meta_json->>'phone_number_id' = $1`, [e]);
async function counts() {
  const tables = (await q(`SELECT relname FROM pg_class WHERE relkind IN ('r','p') AND relnamespace = 'public'::regnamespace AND NOT relispartition ORDER BY 1`)).map((r) => r.relname);
  const out = {};
  for (const t of tables) out[t] = Number((await q(`SELECT count(*) n FROM "${t}"`))[0].n);
  return out;
}
const decryptStored = (blob) => JSON.parse(appCrypto().decrypt(blob));

test.before(async () => {
  if (skip) return;
  for (const [o, s] of [[A, 'A'], [B, 'B']]) {
    const r = await q(`INSERT INTO organizations (slug, name, settings) VALUES ($1, $2, $3::jsonb) RETURNING id`, [o.slug, `Test ${s}`, JSON.stringify({ legacy: { waboo: { client: o.client } } })]);
    o.id = Number(r[0].id);
  }
  orgA = A.id;
  orgB = B.id;
  const ch = (org, client, e, name, status = 'disconnected') =>
    q(`INSERT INTO channels (org_id, kind, name, status, external_id, display_address, settings) VALUES ($1, 'whatsapp_cloud', $2, $3, $4, '+91 98000 00000', $5::jsonb)`, [org, name, status, e, JSON.stringify({ metered: true, legacy: { waboo: { client } } })]);
  await ch(orgA, A.client, ext.one, 'One');
  await ch(orgA, A.client, ext.two, 'Two');
  await ch(orgA, A.client, ext.other, 'Not in the map');
  await ch(orgA, A.client, ext.conn, 'Live one', 'connected');
  await ch(orgB, B.client, ext.bOnly, 'B number');
  writeClient(A.client, { docs: docsA(), map: mapA() });
  writeClient(B.client, { docs: [wa(ext.bOnly, waba.one, fake())], map: { botB: entry(ext.bOnly, 'B number') } });
});
test.after(async () => {
  if (!skip) {
    await q(`DELETE FROM wa_provider_configs WHERE org_id IN ($1, $2)`, [orgA, orgB]).catch(() => undefined);
    await q(`DELETE FROM organizations WHERE id IN ($1, $2)`, [orgA, orgB]).catch(() => undefined);
  }
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(cryptoDir, { recursive: true, force: true });
});

test('no network and no event code in the script', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /require\(['"](node:)?(https?|net|tls|dgram|dns)['"]\)|\bfetch\(|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(src, /event_outbox|notifications|audit_log/);
});

test('dry run is the default and writes nothing', { skip }, async () => {
  const before = await counts();
  const chBefore = await channelsDigest();
  const r = runScript(base(A.client, A.slug));
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /DRY RUN/);
  assert.match(r.out, /would create/);
  assert.match(r.out, /secret keys \[access_token\]/);
  assert.deepEqual(await counts(), before);
  assert.deepEqual(await channelsDigest(), chBefore);
  assert.equal((await cfgOf(ext.one)).length, 0);
});

test('refusals: confirmations, host, flags', { skip }, () => {
  const noDb = runScript(['--client', A.client, '--org-slug', A.slug, '--dumps-dir', work]);
  assert.equal(noDb.status, 3);
  assert.match(noDb.out, /--confirm-db-name is required/);
  const wrongDb = runScript(['--client', A.client, '--org-slug', A.slug, '--confirm-db-name', 'nope', '--dumps-dir', work]);
  assert.match(wrongDb.out, /must be exactly the database name/);
  const noSlug = runScript(base(A.client, A.slug, ['--apply']));
  assert.equal(noSlug.status, 3);
  assert.match(noSlug.out, /--confirm-org-slug/);
  const badSlug = runScript(base(A.client, A.slug, ['--apply', '--confirm-org-slug', 'other']));
  assert.match(badSlug.out, /--confirm-org-slug/);
  const remote = runScript(base(A.client, A.slug), { TARGET_DATABASE_URL: 'postgres://crm_worker_user:x@db.example.com:5432/crm' });
  assert.equal(remote.status, 3);
  assert.match(remote.out, /refusing to run against db\.example\.com/);
  const hostParam = runScript(base(A.client, A.slug), { TARGET_DATABASE_URL: `${env.TARGET_DATABASE_URL}?host=db.example.com` });
  assert.match(hostParam.out, /\?host= override/);
  const unknown = runScript([...base(A.client, A.slug), '--token', tok.one]);
  assert.equal(unknown.status, 3);
  assert.match(unknown.out, /unknown flag --token/);
  const owner_ = runScript(base(A.client, A.slug), { TARGET_DATABASE_URL: env.MIGRATION_DATABASE_URL });
  assert.match(owner_.out, /bypasses row-level security/);
  const noKey = runScript(base(A.client, A.slug), { CREDENTIALS_ENCRYPTION_KEY: '' });
  assert.match(noKey.out, /CREDENTIALS_ENCRYPTION_KEY is not set/);
});

test('refusals: wrong org', { skip }, async () => {
  const wrongClient = runScript(base(B.client, A.slug));
  assert.equal(wrongClient.status, 3);
  assert.match(wrongClient.out, /is not the organization migrated for client/);
  const noOrg = runScript(base(A.client, 'no-such-org-xyz'));
  assert.match(noOrg.out, /no organization with slug/);
  // a plain organization with no migration marker
  const r = await q(`INSERT INTO organizations (slug, name, settings) VALUES ($1, 'Plain', '{}'::jsonb) RETURNING id`, [`${tag}-plain`]);
  try {
    assert.match(runScript(base(A.client, `${tag}-plain`)).out, /is not the organization migrated/);
  } finally {
    await q(`DELETE FROM organizations WHERE id = $1`, [r[0].id]);
  }
});

test('refusals: unknown key shapes, per file', { skip }, () => {
  const cases = {
    'credential-looking key that is not mapped': [wa(ext.one, waba.one, tok.one, { access_token_v2: tok.changed })],
    'token with the wrong format': [wa(ext.one, waba.one, 'not-a-meta-token-at-all-0123456789')],
    'phone id missing': [{ ...wa(ext.one, waba.one, tok.one), config_value: { access_token: tok.one, waba_id: waba.one } }],
    'whatsapp-looking document under another config_key': [{ ...wa(ext.one, waba.one, tok.one), config_key: 'WHATSAPP_V2' }],
    'config_value is a list': [{ ...wa(ext.one, waba.one, tok.one), config_value: [1, 2] }],
    'two live documents disagree': [wa(ext.one, waba.one, tok.one), wa(ext.one, waba.one, tok.changed)],
    'provider is unknown': [wa(ext.one, waba.one, tok.one, { provider: 'carrier-pigeon' })],
  };
  for (const [name, docs] of Object.entries(cases)) {
    const c = `${tag}shape`;
    writeClient(c, { docs, map: { b: entry(ext.one, 'One') } });
    const r = runScript(base(c, A.slug, ['--input', path.join(work, c, 'chatbot_misc_config.ndjson'), '--channel-map', path.join(work, c, 'channel-map.json')]));
    assert.equal(r.status, 3, `${name}: ${r.out}`);
    assert.match(r.out, /refused:/, name);
  }
  // a line that is not JSON is reported by number only
  const c = `${tag}bad`;
  writeClient(c, { docs: [], map: { b: entry(ext.one, 'One') } });
  fs.writeFileSync(path.join(work, c, 'chatbot_misc_config.ndjson'), `{"config_key": "${tok.one}\n`);
  const r = runScript(base(A.client, A.slug, ['--input', path.join(work, c, 'chatbot_misc_config.ndjson'), '--channel-map', path.join(work, c, 'channel-map.json')]));
  assert.match(r.out, /line 1 of the input is not JSON/);
});

test('an unknown shape is accepted only when the operator maps it', { skip }, () => {
  const c = `${tag}map`;
  writeClient(c, { docs: [{ ...wa(ext.one, waba.one, tok.one), config_key: 'WHATSAPP_V2' }], map: { b: entry(ext.one, 'One') } });
  const mapping = path.join(work, 'mapping.json');
  fs.writeFileSync(mapping, JSON.stringify({ configKeys: ['WHATSAPP_V2'] }));
  const r = runScript(base(A.client, A.slug, ['--input', path.join(work, c, 'chatbot_misc_config.ndjson'), '--channel-map', path.join(work, c, 'channel-map.json'), '--mapping', mapping]));
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /would create/);
});

test('refusals: missing channel, connected channel, ambiguous connection, number held elsewhere', { skip }, async () => {
  const c = `${tag}ref`;
  const inputs = (docs, map) => {
    writeClient(c, { docs, map });
    return ['--input', path.join(work, c, 'chatbot_misc_config.ndjson'), '--channel-map', path.join(work, c, 'channel-map.json')];
  };
  // no channel row for the number
  let r = runScript(applyArgs(A.client, A.slug, inputs([wa(ext.noChan, waba.one, tok.one)], { b: entry(ext.noChan, 'None') })));
  assert.equal(r.status, 3);
  assert.match(r.out, /no channel with external_id/);
  assert.equal((await cfgOf(ext.noChan)).length, 0);
  // the channel is connected: never touched
  r = runScript(applyArgs(A.client, A.slug, inputs([wa(ext.conn, waba.one, tok.conn)], { b: entry(ext.conn, 'Live') })));
  assert.match(r.out, /already connected/);
  assert.equal((await cfgOf(ext.conn)).length, 0);
  // the channel belongs to another client's migration
  r = runScript(applyArgs(A.client, A.slug, inputs([wa(ext.bOnly, waba.one, tok.one)], { b: entry(ext.bOnly, 'B') })));
  assert.match(r.out, /no channel with external_id/); // it lives in org B, so it is not in org A at all
  // two connections for the same number in the org: ambiguous
  const mk = (e) => q(`INSERT INTO wa_provider_configs (org_id, provider, status, meta_json) VALUES ($1, 'waba', 'disconnected', $2::jsonb)`, [orgA, JSON.stringify({ phone_number_id: e, waba_id: waba.one, connected_via: 'migration' })]);
  await mk(ext.other);
  await mk(ext.other);
  r = runScript(applyArgs(A.client, A.slug, inputs([wa(ext.other, waba.one, tok.one)], { b: entry(ext.other, 'O') })));
  assert.match(r.out, /more than one WhatsApp connection/);
  await q(`DELETE FROM wa_provider_configs WHERE org_id = $1 AND meta_json->>'phone_number_id' = $2`, [orgA, ext.other]);
  // an existing connection that was made by the app (not by this tool): not touched
  await q(`INSERT INTO wa_provider_configs (org_id, provider, status, meta_json) VALUES ($1, 'waba', 'pending', $2::jsonb)`, [orgA, JSON.stringify({ phone_number_id: ext.other, waba_id: waba.one, connected_via: 'manual' })]);
  r = runScript(applyArgs(A.client, A.slug, inputs([wa(ext.other, waba.one, tok.one)], { b: entry(ext.other, 'O') })));
  assert.match(r.out, /not pending|not made by this tool/);
  await q(`DELETE FROM wa_provider_configs WHERE org_id = $1 AND meta_json->>'phone_number_id' = $2`, [orgA, ext.other]);
  // the number is connected in another workspace
  await q(`INSERT INTO wa_provider_configs (org_id, provider, status, meta_json) VALUES ($1, 'waba', 'connected', $2::jsonb)`, [orgB, JSON.stringify({ phone_number_id: ext.other, waba_id: waba.one })]);
  r = runScript(applyArgs(A.client, A.slug, inputs([wa(ext.other, waba.one, tok.one)], { b: entry(ext.other, 'O') })));
  assert.match(r.out, /already connected in another workspace/);
  await q(`DELETE FROM wa_provider_configs WHERE org_id = $1`, [orgB]);
  assert.equal((await cfgOf(ext.other)).length, 0);
});

test('apply: only the whitelisted keys, sealed exactly like the app, nothing else touched', { skip }, async () => {
  const before = await counts();
  const chBefore = await channelsDigest();
  const r = runScript(applyArgs(A.client, A.slug));
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /APPLY/);
  assert.match(r.out, /create/);
  const after = await counts();
  const diff = Object.keys(after).filter((t) => after[t] !== before[t]);
  assert.deepEqual(diff, ['wa_provider_configs'], 'only wa_provider_configs may change (no outbox, audit, notification, channel row)');
  assert.equal(after.wa_provider_configs - before.wa_provider_configs, 2);
  assert.deepEqual(await channelsDigest(), chBefore, 'channels are byte-identical');

  const one = (await cfgOf(ext.one))[0];
  const two = (await cfgOf(ext.two))[0];
  // the app's own CryptoService opens it; format v1:iv:tag:ct:keyid
  assert.match(one.credentials_json, /^v1:[^:]+:[^:]+:[^:]+:[0-9a-f]{8}$/);
  assert.equal(one.credentials_json.split(':')[4], appCrypto().currentKeyId);
  assert.deepEqual(decryptStored(one.credentials_json), { access_token: tok.one });
  assert.deepEqual(decryptStored(two.credentials_json), { access_token: tok.two }, 'auth_key is not copied by default');
  assert.equal(one.status, 'pending');
  assert.equal(one.provider, 'waba');
  assert.equal(one.is_primary, true);
  assert.equal(two.is_primary, false);
  assert.deepEqual(one.meta_json, { provider: 'interakt', provider_key: 'interakt', waba_id: waba.one, phone_number_id: ext.one, connected_via: 'migration', inbound_wired: false, inbound_checked_at: null, token_expires_at: null, last_error: null });
  // no ignored secret is anywhere in the rows this tool wrote
  const dump = JSON.stringify(await q(`SELECT * FROM wa_provider_configs WHERE org_id = $1`, [orgA]));
  for (const s of [tok.one, tok.two, tok.auth, tok.google, tok.refresh, tok.secret, tok.openai]) assert.ok(!dump.includes(s));
});

test('the app seals what this tool reads, and this tool seals what the app reads (byte-compatible both ways)', { skip }, async () => {
  const dir = path.join(work, `${tag}appcrypto`);
  fs.mkdirSync(dir, { recursive: true });
  // a blob made by the app's CryptoService is accepted as "unchanged" (inline decrypt equals app decrypt)
  const app = appCrypto();
  await q(`UPDATE wa_provider_configs SET credentials_json = $1 WHERE meta_json->>'phone_number_id' = $2`, [app.encrypt(JSON.stringify({ access_token: tok.one })), ext.one]);
  let r = runScript(applyArgs(A.client, A.slug));
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /unchanged/);
  // CRYPTO_FROM makes the tool seal with the app's compiled service: a refresh is read back by the inline reader
  await q(`UPDATE wa_provider_configs SET credentials_json = NULL WHERE meta_json->>'phone_number_id' = $1`, [ext.one]);
  r = runScript(applyArgs(A.client, A.slug), { CRYPTO_FROM: cryptoDir });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /crypto app/);
  assert.match(r.out, /fill/);
  assert.deepEqual(decryptStored((await cfgOf(ext.one))[0].credentials_json), { access_token: tok.one });
  r = runScript(base(A.client, A.slug, ['--verify']));
  assert.match(r.out, /verify OK/);
});

test('idempotent: a second apply changes nothing; a different source value is refused unless --refresh-secrets', { skip }, async () => {
  const blobs = (await q(`SELECT credentials_json, row_version FROM wa_provider_configs WHERE org_id = $1 ORDER BY id`, [orgA])).map((x) => [x.credentials_json, x.row_version]);
  const before = await counts();
  const r = runScript(applyArgs(A.client, A.slug));
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /"unchanged":2/);
  assert.deepEqual(await counts(), before);
  assert.deepEqual((await q(`SELECT credentials_json, row_version FROM wa_provider_configs WHERE org_id = $1 ORDER BY id`, [orgA])).map((x) => [x.credentials_json, x.row_version]), blobs);
  // the source now says another token
  writeClient(A.client, { docs: [wa(ext.one, waba.one, tok.changed), wa(ext.two, waba.two, tok.two)], map: mapA() });
  const refused = runScript(applyArgs(A.client, A.slug));
  assert.equal(refused.status, 3);
  assert.match(refused.out, /differs from the source/);
  assert.deepEqual(decryptStored((await cfgOf(ext.one))[0].credentials_json), { access_token: tok.one });
  const refreshed = runScript(applyArgs(A.client, A.slug, ['--refresh-secrets']));
  assert.equal(refreshed.status, 0, refreshed.out);
  assert.match(refreshed.out, /refresh/);
  assert.deepEqual(decryptStored((await cfgOf(ext.one))[0].credentials_json), { access_token: tok.changed });
  // the source is back to the first token; verify says the stored one no longer matches, a refresh brings it back
  writeClient(A.client, { docs: docsA(), map: mapA() });
  assert.match(runScript(base(A.client, A.slug, ['--verify'])).out, /"matchesSource":false/);
  assert.equal(runScript(applyArgs(A.client, A.slug, ['--refresh-secrets'])).status, 0);
});

test('other channels and other organizations are untouched', { skip }, async () => {
  const bConfigs = await q(`SELECT count(*) n FROM wa_provider_configs WHERE org_id = $1`, [orgB]);
  assert.equal(Number(bConfigs[0].n), 0);
  const other = await q(`SELECT credentials_enc, waba_config_id, status FROM channels WHERE org_id = $1 AND external_id = $2`, [orgA, ext.other]);
  assert.deepEqual(other[0], { credentials_enc: null, waba_config_id: null, status: 'disconnected' });
  const mine = await q(`SELECT credentials_enc, waba_config_id, status, webhook_token_hash FROM channels WHERE org_id = $1 AND external_id IN ($2, $3)`, [orgA, ext.one, ext.two]);
  for (const c of mine) assert.deepEqual(c, { credentials_enc: null, waba_config_id: null, status: 'disconnected', webhook_token_hash: null });
});

test('auth_key policy: skip (default), source, env; pinnacle uses channel_token', { skip }, async () => {
  const c = `${tag}auth`;
  const files = (docs, map) => {
    writeClient(c, { docs, map });
    return ['--input', path.join(work, c, 'chatbot_misc_config.ndjson'), '--channel-map', path.join(work, c, 'channel-map.json')];
  };
  const m = { b: entry(ext.other, 'Other') };
  const doc = [wa(ext.other, waba.two, tok.two, { auth_key: tok.auth })];
  const dry = (extra, over) => runScript([...base(A.client, A.slug), ...files(doc, m), ...extra], over);
  assert.match(dry([]).out, /secret keys \[access_token\]/);
  assert.match(dry(['--auth-key', 'source']).out, /secret keys \[access_token, auth_key\]/);
  assert.match(dry(['--auth-key', 'env'], { INTERAKT_PARTNER_AUTH_KEY: fake('PK') }).out, /auth_key \(platform env\)/);
  assert.match(dry(['--auth-key', 'env']).out, /INTERAKT_PARTNER_AUTH_KEY is not set/);
  const pin = [wa(ext.other, waba.two, tok.two, { auth_key: tok.auth, provider: 'pinnacle' })];
  const r = runScript([...base(A.client, A.slug), ...files(pin, m)]);
  assert.match(r.out, /secret keys \[access_token, channel_token\]/);
  const noKey = [wa(ext.other, waba.two, tok.two, { provider: 'pinnacle' })];
  assert.match(runScript([...base(A.client, A.slug), ...files(noKey, m)]).out, /needs the per-user key/);
});

test('--verify checks format, never prints, and fails on a wrong key', { skip }, () => {
  const ok = runScript(base(A.client, A.slug, ['--verify']));
  assert.equal(ok.status, 0, ok.out);
  assert.match(ok.out, /verify OK/);
  assert.match(ok.out, /"tokenFormat":true/);
  assert.match(ok.out, /"matchesSource":true/);
  assert.match(ok.out, /"keyIsCurrent":true/);
  const wrong = runScript(base(A.client, A.slug, ['--verify']), { CREDENTIALS_ENCRYPTION_KEY: OTHER_KEY });
  assert.equal(wrong.status, 3);
  assert.match(wrong.out, /verify FAIL/);
  assert.match(wrong.out, /cannot be decrypted/);
  // after a rotation the old key stays in the ring, so the blob is still readable but no longer current
  const rotated = runScript(base(A.client, A.slug, ['--verify']), { CREDENTIALS_ENCRYPTION_KEY: OTHER_KEY, CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS: KEY });
  assert.match(rotated.out, /"keyIsCurrent":false/);
});

test('no secret value in any output of any run above', { skip }, () => {
  const all = ALL_OUT.join('\n');
  assert.ok(all.length > 500);
  for (const s of ALL_SECRETS) assert.ok(!all.includes(s), 'a secret value reached stdout/stderr');
});

test('no secret value in the database outside the sealed column', { skip }, async () => {
  const text = JSON.stringify(await q(`SELECT org_id, id, provider, status, meta_json, phone_number, display_label FROM wa_provider_configs WHERE org_id = $1`, [orgA]));
  for (const s of Object.values(tok)) assert.ok(!text.includes(s));
  const chText = JSON.stringify(await q(`SELECT * FROM channels WHERE org_id = $1`, [orgA]));
  for (const s of Object.values(tok)) assert.ok(!chText.includes(s));
});
