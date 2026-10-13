#!/usr/bin/env node
/**
 * Sets the password of the migrated OWNER of ONE named organization, so the pilot workspace can be opened on staging (migrated users
 * have no password, the owner's email is not verified, and neither mail nor Clerk is configured there). Single file; runs inside the
 * desk-api image (needs only `pg` and `@node-rs/argon2`, which the API ships) as the WORKER login, never the owner:
 *
 *   OWNER_NEW_PASSWORD=... TARGET_DATABASE_URL=<crm_worker_user url> node set-owner-password.cjs \
 *       --org-slug <slug> --email <owner email> --confirm-db-name <exact db name> [--allow-docker-host postgres] [--allow-target-host H]
 *
 * The password comes ONLY from the environment variable OWNER_NEW_PASSWORD (no flag exists for it; an unknown flag is refused without
 * echoing its value). It is never printed or logged. Output on success: `ok <user uuid>`. Nothing else is written: the users row's
 * password_hash and the user_security row (email_verified_at, password_changed_at, force_password_change = false), exactly what the app's
 * own password-reset flow writes (auth/flows/recovery.service.ts), in ONE transaction with the tenant GUCs set (withTenant semantics).
 *
 * Refuses: no/another database name than --confirm-db-name; a host the migration tool would refuse; a login that is a superuser or has
 * BYPASSRLS; an unknown org; a user that is not that org's owner (organizations.settings.ownerUserId) or is not active; more than one match;
 * a password the app's default policy would refuse (and anything under 12 characters, without a symbol, or containing the email name).
 * Hash = @node-rs/argon2 `hash(password)` with its defaults (argon2id), exactly password.service.ts; no pepper exists in the app.
 */
'use strict';
const path = require('node:path');
const { Client } = require('pg');
const { hash } = require('@node-rs/argon2');

const ALLOWED = new Set([
  'org-slug',
  'email',
  'confirm-db-name',
  'allow-docker-host',
  'allow-target-host',
]);
const PW_ENV = 'OWNER_NEW_PASSWORD';

class Refused extends Error {}
const refuse = (m) => {
  throw new Refused(m);
};

// --- the production guard of the tool (tools/migration/load/db.ts), same rules ------------------------------------------------------

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
  for (const k of ['host', 'hostaddr', 'service', 'socket', 'unix_socket', 'sslrootcert']) {
    if (u.searchParams.has(k)) refuse(`refusing a database URL with a ?${k}= override`);
  }
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
    user: decodeURIComponent(u.username),
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
  const docker = [
    ...(flags['allow-docker-host'] ?? '').split(','),
    ...(process.env.MIGRATION_ALLOW_DOCKER_HOSTS ?? '').split(','),
  ]
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  const local = loopback(t.host) || [...DEFAULT_DOCKER_HOSTS, ...docker].includes(t.host);
  if (!local) {
    const allowed = (flags['allow-target-host'] ?? '')
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .includes(t.host);
    if (!allowed)
      refuse(
        `refusing to run against ${t.host}: not localhost / a known docker name (--allow-docker-host ${t.host} for a compose service, --allow-target-host ${t.host} otherwise)`,
      );
  }
  // unlike the tool, a local database needs the confirmation too: this writes a credential
  if (flags['confirm-db-name'] !== t.db)
    refuse(`--confirm-db-name must be exactly the database name (${t.db})`);
  return t;
}

// --- the app's password rules (auth/support/password-policy.ts, default policy) made stricter -------------------------------------------

const COMMON = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwertyuiop',
  'qwerty123',
  'iloveyou',
  'admin123',
  'welcome1',
  'letmein1',
  'passw0rd',
  'passw0rd!',
]);
function violations(password, email) {
  const out = [];
  if ([...password].length < 12) out.push('at least 12 characters');
  if (!(/\p{Ll}/u.test(password) && /\p{Lu}/u.test(password)))
    out.push('upper and lower case letters');
  if (!/\p{N}/u.test(password)) out.push('a number');
  if (!/[\p{Z}\p{S}\p{P}]/u.test(password)) out.push('a symbol');
  const lower = password.toLowerCase();
  const local = email.split('@')[0].toLowerCase();
  if (COMMON.has(lower) || (local.length >= 4 && lower.includes(local)))
    out.push('not a common password and not containing the email name');
  return out;
}

function parseFlags(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--'))
      refuse(
        'unexpected argument (the password is never an argument; use the environment variable ' +
          PW_ENV +
          ')',
      );
    const eq = a.indexOf('=');
    const k = eq > 0 ? a.slice(2, eq) : a.slice(2);
    if (!ALLOWED.has(k)) refuse(`unknown flag --${k.slice(0, 40)}`); // the value is never echoed
    f[k] =
      eq > 0
        ? a.slice(eq + 1)
        : argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')
          ? argv[++i]
          : '';
  }
  return f;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const password = process.env[PW_ENV];
  delete process.env[PW_ENV];
  for (const k of ['org-slug', 'email', 'confirm-db-name'])
    if (!flags[k]) refuse(`--${k} is required`);
  if (!password) refuse(`${PW_ENV} is not set`);
  if (password.length > 128) refuse('the password is longer than 128 characters');
  const url = process.env.TARGET_DATABASE_URL;
  if (!url) refuse('TARGET_DATABASE_URL (the crm_worker_user login) is not set');
  assertTargetAllowed(url, flags);
  const email = flags.email.trim().toLowerCase();
  const slug = flags['org-slug'].trim().toLowerCase();
  const bad = violations(password, email);
  if (bad.length) refuse(`the password needs: ${bad.join('; ')}`);

  const db = new Client({
    connectionString: url,
    application_name: 'waboo-set-owner-password',
    connectionTimeoutMillis: 10000,
  });
  await db.connect();
  try {
    const me = (
      await db.query(
        'SELECT r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user',
      )
    ).rows[0];
    if (me.rolsuper || me.rolbypassrls)
      refuse(
        'this login bypasses row-level security (superuser or BYPASSRLS): use the crm_worker_user login',
      );

    // 1. the organization: organizations is under FORCE RLS, so the lookup (read only, rolled back) uses the privileged switch the
    //    tools and the app's TenantDirectory use for it
    await db.query('BEGIN');
    let org;
    try {
      await db.query(`SELECT set_config('app.privileged', 'on', true)`);
      const r = await db.query(
        `SELECT id, status, settings->>'ownerUserId' AS owner FROM organizations WHERE lower(slug) = $1`,
        [slug],
      );
      if (r.rows.length === 0) refuse(`no organization with slug "${slug}"`);
      if (r.rows.length > 1) refuse(`more than one organization matches slug "${slug}"`);
      org = r.rows[0];
    } finally {
      await db.query('ROLLBACK');
    }

    // 2. the write, ONE transaction, tenant GUCs set like withTenant (set_config(..., true): transaction-local)
    const digest = await hash(password);
    await db.query('BEGIN');
    try {
      await db.query(`SELECT set_config('app.org_id', $1, true)`, [String(org.id)]);
      await db.query(`SELECT set_config('app.user_id', '', true)`);
      const u = await db.query(
        `SELECT id, uuid::text AS uuid, status FROM users WHERE org_id = $1 AND lower(email) = $2 FOR UPDATE`,
        [org.id, email],
      );
      if (u.rows.length === 0) refuse(`no user with that email in organization "${slug}"`);
      if (u.rows.length > 1) refuse('more than one user matches that email');
      const user = u.rows[0];
      if (!org.owner || org.owner !== user.uuid)
        refuse(
          'that user is not the owner of the organization (organizations.settings.ownerUserId); this tool only sets the owner password',
        );
      if (user.status !== 'active') refuse(`the owner is not active (status ${user.status})`);
      const up = await db.query(
        `UPDATE users SET password_hash = $1 WHERE org_id = $2 AND id = $3`,
        [digest, org.id, user.id],
      );
      if (up.rowCount !== 1) throw new Error('the users row was not updated (row-level security?)');
      await db.query(
        `INSERT INTO user_security (org_id, user_id, email_verified_at, password_changed_at, force_password_change)
         VALUES ($1, $2, now(), now(), false)
         ON CONFLICT (org_id, user_id) DO UPDATE
           SET email_verified_at = COALESCE(user_security.email_verified_at, now()), password_changed_at = now(), force_password_change = false`,
        [org.id, user.id],
      );
      await db.query('COMMIT');
      console.log(`ok ${user.uuid}`);
    } catch (e) {
      await db.query('ROLLBACK').catch(() => undefined);
      throw e;
    }
  } finally {
    await db.end().catch(() => undefined);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    const msg = String(e && e.message ? e.message : e)
      .split('\n')[0]
      .replace(/[a-z]+:\/\/\S+/gi, '<url>')
      .slice(0, 300);
    console.error(e instanceof Refused ? `refused: ${msg}` : `failed: ${msg}`);
    process.exit(e instanceof Refused ? 3 : 1);
  },
);
