import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DPDP_GROUPS,
  ERROR_CODES,
  type DpdpAttestationView,
  type DpdpCheckKey,
  type DpdpCheckView,
  type DpdpHistoryResponse,
  type DpdpRegisterResponse,
} from '@crm/contracts';
import { AiKeyResolver } from '../../../src/modules/ai-keys-usage-admin';
import { ENDED_SESSION_RETENTION_DAYS } from '../../../src/modules/auth';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';
import { Api, bearer } from '../contacts-attributes-tags/support';

/**
 * The DPDP compliance register end to end through HTTP: the real API, real Postgres (restricted role, forced RLS) and real Redis.
 * One app for the file; each test attests its own check so none depends on another.
 */
let h: Harness;
let api: Api;
let superToken = '';
let supportToken = '';
let auditorToken = '';
let operatorId = 0;

const http = () => request(h.app.getHttpServer());
const reg = (token: string, method: 'get' | 'post', path = '') =>
  http()[method](`/v2/platform/dpdp-register${path}`).set(bearer(token));
const attest = (token: string, key: string, body: Record<string, unknown>) =>
  reg(token, 'post', `/checks/${key}/attest`).send(body);
const history = (token: string, key: string) => reg(token, 'get', `/checks/${key}/history`);

const allItems = (r: DpdpRegisterResponse) => r.groups.flatMap((g) => g.items);
/** The check as the register shows it (a key listed under two rows reads the same under both). */
function checkOf(r: DpdpRegisterResponse, key: DpdpCheckKey): DpdpCheckView {
  const found = allItems(r)
    .flatMap((i) => i.checks)
    .find((c) => c.key === key);
  expect(found, `check ${key} is in the register`).toBeDefined();
  return found!;
}
const attestationRows = async (): Promise<number> =>
  Number(
    (await h.owner.query(`SELECT count(*)::int AS n FROM dpdp_register_attestations`)).rows[0].n,
  );
const eventRows = async (): Promise<number> =>
  Number(
    (
      await h.owner.query(
        `SELECT count(*)::int AS n FROM security_events WHERE event = 'dpdp_register.attested'`,
      )
    ).rows[0].n,
  );

async function login(email: string): Promise<string> {
  const res = await api
    .http()
    .post('/v2/platform/auth/login')
    .send({ email, password: OPERATOR_PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.tokens.accessToken as string;
}

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);

  // Super admins must enrol two-factor before any operator route opens (the harness switches that policy on).
  superToken = await login(OPERATOR_EMAIL);
  const setup = await api.http().post('/v2/platform/auth/mfa/setup').set(bearer(superToken));
  const enabled = await api
    .http()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(superToken))
    .send({ code: hotp(base32Decode(setup.body.secret as string), totpStep(Date.now())) });
  expect(enabled.status, JSON.stringify(enabled.body)).toBe(201);

  supportToken = await login('support@platform.test');
  await h.owner.query(
    `INSERT INTO platform_operators (email, full_name, password_hash, role)
     SELECT 'auditor@platform.test', 'Auditor', password_hash, 'auditor' FROM platform_operators WHERE email = $1`,
    [OPERATOR_EMAIL],
  );
  auditorToken = await login('auditor@platform.test');

  operatorId = Number(
    (await h.owner.query(`SELECT id FROM platform_operators WHERE email = $1`, [OPERATOR_EMAIL]))
      .rows[0].id,
  );
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('the register', () => {
  it('GET returns 47 items in groups A to I with the summary adding up', async () => {
    const res = await reg(superToken, 'get');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as DpdpRegisterResponse;

    expect(body.groups.map((g) => g.id)).toEqual([...DPDP_GROUPS]);
    const items = allItems(body);
    expect(items).toHaveLength(47);
    expect(new Set(items.map((i) => i.id)).size).toBe(47);
    for (const group of body.groups) {
      for (const item of group.items) expect(item.group).toBe(group.id);
    }

    const notApplicable = items.filter((i) => i.status === 'not_applicable').length;
    const count = (status: string) => items.filter((i) => i.status === status).length;
    expect(body.summary.total).toBe(47 - notApplicable);
    expect(body.summary).toMatchObject({
      following: count('following'),
      partial: count('partial'),
      notFollowing: count('not_following'),
      unverified: count('unverified'),
    });
    expect(
      body.summary.following +
        body.summary.partial +
        body.summary.notFollowing +
        body.summary.unverified,
    ).toBe(body.summary.total);

    expect(body.milestones.map((m) => [m.id, m.date])).toEqual([
      ['consent_managers', '2026-11-14'],
      ['main_duties', '2027-05-14'],
    ]);
    for (const m of body.milestones) expect(m.daysLeft).toBeGreaterThanOrEqual(0);
    expect(Math.abs(Date.parse(body.generatedAt) - Date.now())).toBeLessThan(60_000);
  });

  it('reads the live checks from the running platform', async () => {
    const body = (await reg(superToken, 'get')).body as DpdpRegisterResponse;

    // No live check failed to read: the wiring of every dependency works.
    const live = allItems(body)
      .flatMap((i) => i.checks)
      .filter((c) => c.source === 'live');
    expect(live.length).toBeGreaterThanOrEqual(10);
    for (const c of live) expect(c.detail, c.key).not.toBe('probe_error');

    // The harness turns operator two-factor on, leaves the workspace-admin switch at its default, and gives Redis no password.
    expect(checkOf(body, 'mfa.operators')).toMatchObject({ result: 'pass', detail: 'mfa_on' });
    expect(checkOf(body, 'mfa.workspace_admins')).toMatchObject({
      result: 'fail',
      detail: 'mfa_off',
    });
    expect(checkOf(body, 'redis.auth')).toMatchObject({ result: 'fail', detail: 'redis_auth_off' });
    // The check reads the purge constant of the maintenance job: it fails today (90 days) and passes once the constant is 365 or more.
    expect(checkOf(body, 'logs.session_retention')).toMatchObject(
      ENDED_SESSION_RETENTION_DAYS >= 365
        ? { result: 'pass', detail: 'retention_ok', params: { days: ENDED_SESSION_RETENTION_DAYS } }
        : {
            result: 'fail',
            detail: 'retention_below_floor',
            params: { days: ENDED_SESSION_RETENTION_DAYS },
          },
    );
    // No platform AI key is stored in a fresh database.
    expect(checkOf(body, 'ai.platform_key_off')).toMatchObject({
      result: 'pass',
      detail: 'no_platform_key',
    });
    // The adoption counts are numbers read through the platform store.
    const consent = checkOf(body, 'consent.default_opt_in');
    expect(typeof consent.params?.on).toBe('number');
    expect(typeof consent.params?.total).toBe('number');
    expect(consent.params!.on as number).toBeLessThanOrEqual(consent.params!.total as number);
  });
});

describe('who may call it', () => {
  it('auditor and support can read, only super_admin can attest', async () => {
    const key = 'legal.counsel_engaged';
    const body = { result: 'pass', note: 'Counsel engaged, letter on file' };
    const before = await attestationRows();

    for (const token of [supportToken, auditorToken, superToken]) {
      expect((await reg(token, 'get')).status).toBe(200);
      expect((await history(token, key)).status).toBe(200);
    }

    for (const token of [supportToken, auditorToken]) {
      const denied = await attest(token, key, body);
      expect(denied.status, JSON.stringify(denied.body)).toBe(403);
      expect(denied.body.code).toBe(ERROR_CODES.AUTH_OPERATOR_ROLE_REQUIRED);
    }
    expect(await attestationRows()).toBe(before);

    const ok = await attest(superToken, key, body);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(await attestationRows()).toBe(before + 1);
  });

  it('no token and a tenant user are refused', async () => {
    const t = await api.signup('dpdpten');
    const body = { result: 'pass', note: 'Nobody may write this' };
    const key = 'legal.vendor_dpas';
    const before = await attestationRows();

    expect((await http().get('/v2/platform/dpdp-register')).status).toBe(401);
    expect((await http().get(`/v2/platform/dpdp-register/checks/${key}/history`)).status).toBe(401);
    expect(
      (await http().post(`/v2/platform/dpdp-register/checks/${key}/attest`).send(body)).status,
    ).toBe(401);

    // A workspace token belongs to another identity pool: the platform API does not know it at all.
    expect((await api.as(t.admin).get('/v2/platform/dpdp-register')).status).toBe(401);
    expect((await history(t.admin, key)).status).toBe(401);
    expect((await attest(t.admin, key, body)).status).toBe(401);

    expect(await attestationRows()).toBe(before);
  });
});

describe('attesting', () => {
  it('attest then read shows the newest result', async () => {
    const key = 'hosting.region_documented';
    const first = await attest(superToken, key, { result: 'pass', note: 'region noted' });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    // The answer is the register itself, already showing the new row.
    expect(checkOf(first.body as DpdpRegisterResponse, key)).toMatchObject({
      result: 'pass',
      source: 'attested',
    });

    const passRead = (await reg(superToken, 'get')).body as DpdpRegisterResponse;
    const pass = checkOf(passRead, key);
    expect(pass).toMatchObject({
      key,
      source: 'attested',
      result: 'pass',
      detail: 'attested_pass',
      attestation: { result: 'pass', note: 'region noted', evidenceUrl: null, byName: 'Ops' },
    });
    // 90 days is the default expiry (the two ends are read from two clocks, so allow a day of drift).
    const a = pass.attestation as DpdpAttestationView;
    const days = (Date.parse(a.expiresAt) - Date.parse(a.at)) / 86_400_000;
    expect(Math.abs(days - 90)).toBeLessThan(1);

    const second = await attest(superToken, key, {
      result: 'fail',
      note: 'The region page was taken down',
      evidenceUrl: 'https://example.test/evidence/region',
      expiresInDays: 30,
    });
    expect(second.status, JSON.stringify(second.body)).toBe(200);

    const failRead = (await reg(superToken, 'get')).body as DpdpRegisterResponse;
    expect(checkOf(failRead, key)).toMatchObject({
      result: 'fail',
      source: 'attested',
      detail: 'attested_fail',
      attestation: {
        result: 'fail',
        note: 'The region page was taken down',
        evidenceUrl: 'https://example.test/evidence/region',
        byName: 'Ops',
      },
    });
  });

  it('an unknown key and a short note return 422 and write nothing', async () => {
    const before = await attestationRows();
    const events = await eventRows();
    const good = { result: 'pass', note: 'A note of fair length' };

    const unknownKey = await attest(superToken, 'not.a.key', good);
    expect(unknownKey.status, JSON.stringify(unknownKey.body)).toBe(422);
    expect(unknownKey.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);

    // A live check and a code check are real keys of the register, but nobody can attest them.
    expect((await attest(superToken, 'mfa.operators', good)).status).toBe(422);
    expect((await attest(superToken, 'pii.column_encryption', good)).status).toBe(422);

    const key = 'storage.encrypted_at_rest';
    const shortNote = await attest(superToken, key, { result: 'pass', note: 'too short' });
    expect(shortNote.status, JSON.stringify(shortNote.body)).toBe(422);
    expect(shortNote.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect((await attest(superToken, key, { result: 'maybe', note: good.note })).status).toBe(422);
    expect((await attest(superToken, key, { ...good, expiresInDays: 0 })).status).toBe(422);
    expect((await attest(superToken, key, { ...good, expiresInDays: 366 })).status).toBe(422);
    expect(
      (await attest(superToken, key, { ...good, evidenceUrl: 'http://plain.test/x' })).status,
    ).toBe(422);

    expect(await attestationRows()).toBe(before);
    expect(await eventRows()).toBe(events);

    const unknownHistory = await history(superToken, 'not.a.key');
    expect(unknownHistory.status, JSON.stringify(unknownHistory.body)).toBe(422);
    expect(unknownHistory.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('history lists newest first with who and when', async () => {
    const key = 'backup.offsite_configured';
    expect(((await history(superToken, key)).body as DpdpHistoryResponse).data).toEqual([]);

    const sentAt = Date.now();
    expect(
      (await attest(superToken, key, { result: 'fail', note: 'The first copy never ran' })).status,
    ).toBe(200);
    expect(
      (
        await attest(superToken, key, {
          result: 'pass',
          note: 'The sealed copy now runs nightly',
          evidenceUrl: 'https://example.test/evidence/backup',
        })
      ).status,
    ).toBe(200);

    for (const token of [superToken, supportToken, auditorToken]) {
      const res = await history(token, key);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const { data } = res.body as DpdpHistoryResponse;
      expect(data.map((a) => [a.result, a.note])).toEqual([
        ['pass', 'The sealed copy now runs nightly'],
        ['fail', 'The first copy never ran'],
      ]);
      expect(data[0]!.byName).toBe('Ops');
      expect(data[0]!.evidenceUrl).toBe('https://example.test/evidence/backup');
      expect(data[1]!.evidenceUrl).toBeNull();
      // Newest first, and the times are the database's (a clock apart from this process, so allow an hour of drift).
      expect(Date.parse(data[0]!.at)).toBeGreaterThan(Date.parse(data[1]!.at));
      expect(Math.abs(Date.parse(data[0]!.at) - sentAt)).toBeLessThan(60 * 60_000);
      expect(Date.parse(data[0]!.expiresAt)).toBeGreaterThan(Date.parse(data[0]!.at));
    }

    // Only that check's rows.
    const other = (await history(superToken, 'backup.restore_drill')).body as DpdpHistoryResponse;
    expect(other.data).toEqual([]);
  });

  it('an attestation writes a security_events row', async () => {
    const before = await eventRows();
    const res = await attest(superToken, 'governance.contacts_named', {
      result: 'pass',
      note: 'Contacts named on the privacy page',
      evidenceUrl: 'https://example.test/privacy',
      expiresInDays: 45,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await eventRows()).toBe(before + 1);

    const row = (
      await h.owner.query(
        `SELECT actor_type, actor_id, status, payload FROM security_events
          WHERE event = 'dpdp_register.attested' ORDER BY id DESC LIMIT 1`,
      )
    ).rows[0];
    expect(row.actor_type).toBe('platform_operator');
    expect(Number(row.actor_id)).toBe(operatorId);
    expect(row.status).toBe('info');
    expect(row.payload).toMatchObject({
      checkKey: 'governance.contacts_named',
      result: 'pass',
      expiresInDays: 45,
      hasEvidence: true,
    });
    // The event names the row it belongs to; the note and the link stay in the table.
    const stored = (
      await h.owner.query(
        `SELECT id, attested_by FROM dpdp_register_attestations WHERE check_key = 'governance.contacts_named'`,
      )
    ).rows[0];
    expect(row.payload.attestationId).toBe(stored.id);
    expect(Number(stored.attested_by)).toBe(operatorId);
    expect(JSON.stringify(row.payload)).not.toContain('privacy page');
    expect(JSON.stringify(row.payload)).not.toContain('example.test');
  });

  it('an expired attestation reads as unknown and still shows who said what', async () => {
    const key = 'security.pentest_report';
    // Straight into the table (the owner connection), dated in the past: nobody can attest backwards.
    await h.owner.query(
      `INSERT INTO dpdp_register_attestations (check_key, result, note, attested_by, attested_at, expires_at)
       VALUES ($1, 'pass', 'Report filed, no open critical', $2, now() - interval '100 days', now() - interval '10 days')`,
      [key, operatorId],
    );
    const body = (await reg(superToken, 'get')).body as DpdpRegisterResponse;
    expect(checkOf(body, key)).toMatchObject({
      result: 'unknown',
      source: 'attested',
      detail: 'attestation_expired',
      attestation: { result: 'pass', note: 'Report filed, no open critical', byName: 'Ops' },
    });

    // A fresh attestation brings it back.
    expect(
      (await attest(superToken, key, { result: 'pass', note: 'Retest report filed in May' }))
        .status,
    ).toBe(200);
    const again = (await reg(superToken, 'get')).body as DpdpRegisterResponse;
    expect(checkOf(again, key)).toMatchObject({ result: 'pass', detail: 'attested_pass' });
  });

  it('the table refuses UPDATE and DELETE', async () => {
    expect(
      (
        await attest(superToken, 'storage.encrypted_at_rest', {
          result: 'pass',
          note: 'Volume encryption evidence filed',
        })
      ).status,
    ).toBe(200);
    const before = await attestationRows();
    expect(before).toBeGreaterThan(0);

    // The owner connection bypasses row level security and holds every grant: only the trigger stands in the way.
    await expect(
      h.owner.query(`UPDATE dpdp_register_attestations SET note = 'rewritten after the fact'`),
    ).rejects.toThrow(/append-only/);
    await expect(h.owner.query(`DELETE FROM dpdp_register_attestations`)).rejects.toThrow(
      /append-only/,
    );
    expect(await attestationRows()).toBe(before);
  });
});

describe('when a dependency fails', () => {
  it('a probe failure does not fail the page', async () => {
    const keys = h.app.get(AiKeyResolver);
    const spy = vi.spyOn(keys, 'resolve').mockRejectedValue(new Error('key store unreachable'));
    try {
      const res = await reg(superToken, 'get');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const body = res.body as DpdpRegisterResponse;
      expect(spy).toHaveBeenCalled();

      // The check that could not be read is unknown, never pass...
      expect(checkOf(body, 'ai.platform_key_off')).toMatchObject({
        source: 'live',
        result: 'unknown',
        detail: 'probe_error',
      });
      const row = allItems(body).find((i) =>
        i.checks.some((c) => c.key === 'ai.platform_key_off'),
      )!;
      expect(row.status).not.toBe('following');
      // ...and every other check is read as usual.
      expect(checkOf(body, 'mfa.operators')).toMatchObject({ result: 'pass', detail: 'mfa_on' });
      expect(allItems(body)).toHaveLength(47);
    } finally {
      spy.mockRestore();
    }
  });

  it('a dependency that never answers is cut off after 5 seconds and the page still returns', async () => {
    const keys = h.app.get(AiKeyResolver);
    const spy = vi.spyOn(keys, 'resolve').mockImplementation(() => new Promise(() => undefined));
    try {
      const started = Date.now();
      const res = await reg(superToken, 'get');
      const took = Date.now() - started;
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(took).toBeGreaterThanOrEqual(4_900);
      expect(took).toBeLessThan(20_000);

      const body = res.body as DpdpRegisterResponse;
      expect(checkOf(body, 'ai.platform_key_off')).toMatchObject({
        result: 'unknown',
        detail: 'probe_error',
      });
      expect(checkOf(body, 'mfa.operators')).toMatchObject({ result: 'pass' });
    } finally {
      spy.mockRestore();
    }
  }, 60_000);
});
