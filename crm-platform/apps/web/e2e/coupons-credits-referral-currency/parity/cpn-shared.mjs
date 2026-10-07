// Helpers shared by the three CPN twin specs (coupons, currencies, affiliate). Plain ES module, no build step.
// Nothing here copies WaDesk wording: WaDesk locators in the specs only ever run against WaDesk.
//
// Data access (never the shared `crm` database):
//   ours    -> docker exec crm-postgres psql ... -d $CPN_DB (default crm_cpn_parity); a `crm` target is refused
//   WaDesk  -> mysql -h127.0.0.1 -uwadesk (read-only SELECTs to find rows this run created; deletes go through its own routes)
// Our operator console (platform admin) is a separate login with two-factor: PARITY_CONFIG carries
// ours.operator { email, password, totpSecret } of a super_admin operator that exists only in the scratch database.
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

export const WD = (c) => c.side === 'wadesk';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const uuid = () => globalThis.crypto.randomUUID();
export const idem = () => ({ 'Idempotency-Key': uuid() });
/** Escapes a value for a single-quoted SQL literal (both engines): backslash and quote. */
export const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "''");
/** Postgres literal (standard_conforming_strings: a backslash is a backslash) and MySQL literal, chosen by side. */
export const qp = (s) => String(s).replace(/'/g, "''");
export const qs = (c, s) => (c.side === 'wadesk' ? q(s) : qp(s));

const OURS_DB_NAME = process.env.CPN_DB || 'crm_cpn_parity';
if (OURS_DB_NAME === 'crm')
  throw new Error('CPN parity specs must never target the shared crm database');
export const psql = (sql) =>
  execFileSync(
    'docker',
    ['exec', 'crm-postgres', 'psql', '-U', 'crm', '-d', OURS_DB_NAME, '-tAc', sql],
    { encoding: 'utf8' },
  ).trim();
export const mysql = (sql) =>
  execFileSync(
    'mysql',
    ['-h127.0.0.1', '-uwadesk', '-pwadesk_local_pw', 'wadesk', '-N', '-B', '-r', '-e', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim();
/** One SQL text per side, each side's own dialect. */
export const sql = (c, wadesk, ours) => (WD(c) ? mysql(wadesk) : psql(ours ?? wadesk));
/** Same classes the harness uses for `status.*` keys, so 302/201 and 422/400 compare as what they mean. */
export const cls = (s) =>
  s == null
    ? 'none'
    : s >= 200 && s < 400
      ? 'ok'
      : s === 401
        ? 'unauthenticated'
        : s === 403
          ? 'forbidden'
          : s === 404 || s === 410
            ? 'not-found'
            : s === 409 || s === 412
              ? 'conflict'
              : s === 419
                ? 'session-expired'
                : s === 429
                  ? 'throttled'
                  : s === 400 || s === 422
                    ? 'rejected'
                    : s >= 500
                      ? 'crash'
                      : 'client-error';
export const lines = (s) => (s ? s.split('\n').filter(Boolean) : []);

// --- our platform operator session -------------------------------------------------------------------------------
const b32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const totp = (secret, t = Date.now()) => {
  let bits = '';
  for (const ch of secret.replace(/[\s=]/g, '').toUpperCase())
    bits += b32.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8);
  ctr.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const mac = createHmac('sha1', key).update(ctr).digest();
  const off = mac[19] & 15;
  const n = ((mac[off] & 127) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(n % 1e6).padStart(6, '0');
};

let opCookies = null;
let lastMfaStep = 0;
let lock = Promise.resolve();

/**
 * Signs our operator in inside this scenario's browser context (the context's base session is the tenant's; the
 * cookies are replaced). Serialised across scenarios (a two-factor code and a rotating refresh token cannot be
 * used twice) and cached for the whole run.
 */
export function operatorSession(c) {
  if (WD(c)) return Promise.resolve();
  const run = lock.then(() => operatorSessionInner(c));
  lock = run.catch(() => undefined);
  return run;
}

async function operatorSessionInner(c) {
  const op = c.cfg.ours.operator;
  if (!op?.email)
    throw new Error(
      'PARITY_CONFIG has no ours.operator { email, password, totpSecret }: the admin screens need a platform operator',
    );
  const web = c.sideObj.baseUrl.replace(/\/$/, '');
  const probe = async () =>
    (
      await c.context.request.get(`${web}/api/platform/coupons?status=all`, {
        failOnStatusCode: false,
      })
    ).ok();
  await c.context.clearCookies();
  if (opCookies) {
    await c.context.addCookies(opCookies);
    if (await probe()) return;
    await c.context.request
      .get(`${web}/api/platform-auth/refresh?next=/admin`, {
        maxRedirects: 0,
        failOnStatusCode: false,
      })
      .catch(() => undefined);
    if (await probe()) {
      opCookies = (await c.context.storageState()).cookies;
      return;
    }
    await c.context.clearCookies();
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const lr = await c.context.request.post(`${web}/api/platform-auth/login`, {
      data: { email: op.email, password: op.password },
      failOnStatusCode: false,
    });
    const j = await lr.json().catch(() => ({}));
    if (j.status === 'mfa_required') {
      let step = Math.floor(Date.now() / 30000);
      if (step <= lastMfaStep) {
        await sleep((step + 1) * 30000 - Date.now() + 700);
        step = Math.floor(Date.now() / 30000);
      }
      lastMfaStep = step;
      const mr = await c.context.request.post(`${web}/api/platform-auth/mfa`, {
        data: { challengeToken: j.challengeToken, code: totp(op.totpSecret) },
        failOnStatusCode: false,
      });
      if (!mr.ok()) continue;
    } else if (!lr.ok()) continue;
    if (await probe()) {
      opCookies = (await c.context.storageState()).cookies;
      return;
    }
  }
  throw new Error('platform operator sign-in failed');
}

/** Our operator API through the web proxy (cookies of the context). Resolves { status, ok, json }. */
export async function opFetch(c, method, path, data) {
  const web = c.sideObj.baseUrl.replace(/\/$/, '');
  const r = await c.context.request.fetch(`${web}/api/platform${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(method === 'GET' ? {} : idem()) },
    data: data === undefined ? undefined : JSON.stringify(data),
    failOnStatusCode: false,
    maxRedirects: 0,
  });
  const text = await r.text().catch(() => '');
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: r.status(), ok: r.ok(), json, text };
}

/** The run's short code, upper-case, for values that must stay short (currency codes carry it). */
export const runCode = (c) =>
  c.tagBase
    .replace(/^pwp-/, '')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
    .slice(0, 4);
