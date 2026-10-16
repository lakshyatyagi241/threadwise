import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import type { Tenant } from '../contacts-attributes-tags/support';
import { mailWorkspace, setMailPlan, startMailRig, type MailRig } from './support';

/**
 * "Test credentials" (E-08) and the sync lag on the hub, end to end through the real routes. The server tested here is deliberately a
 * private address: the SSRF guard refuses it (as it does for connect and sync), which proves the guard is on the test path and
 * lets both sides answer without any mail server. The mail-server outcomes (refused password, bad certificate, unreachable port, an INBOX
 * that will not open) are covered at the driver by `imap-test-credentials.spec.ts`. Nothing here talks to a real mail server.
 */
const SECRET = 'a-very-secret-password';
let rig: MailRig;
let t: Tenant;
let crypto: CryptoService;

const as = (token = t.admin) => rig.p.api.as(token);
const body = () => ({
  imap: { host: '127.0.0.1', port: 993, security: 'ssl', username: 'support', password: SECRET },
  smtp: { host: '127.0.0.1', port: 465, security: 'ssl' },
});
const login = () => ({
  imap: { host: '127.0.0.1', port: 993, security: 'ssl', username: 'support', password: SECRET },
  smtp: { host: '127.0.0.1', port: 465, security: 'ssl', username: 'support', password: SECRET },
});

async function insertMailbox(
  tenant: Tenant,
  address: string,
  o: {
    provider?: string;
    status?: string;
    scope?: string;
    owner?: number;
    syncedAgoSec?: number;
  } = {},
): Promise<string> {
  const provider = o.provider ?? 'imap';
  const sealed =
    provider === 'imap' ? crypto.encrypt(JSON.stringify({ v: 1, login: login() })) : null;
  const res = await rig.p.h.owner.query(
    `INSERT INTO mail_mailboxes (org_id, provider, address, display_name, status, scope, owner_user_id, connection_enc,
                                 connection_public, last_synced_at, connected_at)
     VALUES ($1, $2, $3, 'Support', $4, $5, $6, $7, $8::jsonb,
             CASE WHEN $9::int IS NULL THEN NULL ELSE now() - make_interval(secs => $9::int) END, now())
     RETURNING uuid`,
    [
      tenant.orgId,
      provider,
      address,
      o.status ?? 'connected',
      o.scope ?? 'shared',
      o.owner ?? null,
      sealed,
      provider === 'imap'
        ? JSON.stringify({
            host: '127.0.0.1',
            port: 993,
            security: 'ssl',
            username: 'support',
            smtpHost: '127.0.0.1',
            smtpPort: 465,
            smtpSecurity: 'ssl',
          })
        : null,
      o.syncedAgoSec ?? null,
    ],
  );
  return res.rows[0].uuid as string;
}

beforeAll(async () => {
  rig = await startMailRig();
  crypto = rig.p.h.app.get(CryptoService, { strict: false });
  t = await mailWorkspace(rig.p, 'mtc', 6);
}, 300_000);

afterAll(async () => {
  await rig?.restore();
});

describe('E-08: testing settings before connecting', () => {
  it('tries BOTH sides and answers each on its own, in our words, without echoing the password or the host', async () => {
    const res = await as().post('/v2/email/mailboxes/test-imap').send(body());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      ok: false,
      imap: { ok: false, failedStep: 'connect', reason: 'blocked_address', inboxMessages: null },
      smtp: { ok: false, failedStep: 'connect', reason: 'blocked_address', inboxMessages: null },
    });
    expect(typeof res.body.imap.message).toBe('string');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('127.0.0.1');
  });

  it('stores nothing and sends nothing: no mailbox appears, nothing is queued', async () => {
    const before = (
      await rig.p.h.owner.query(`SELECT count(*)::int AS n FROM mail_mailboxes WHERE org_id = $1`, [
        t.orgId,
      ])
    ).rows[0].n;
    await as().post('/v2/email/mailboxes/test-imap').send(body());
    const after = (
      await rig.p.h.owner.query(`SELECT count(*)::int AS n FROM mail_mailboxes WHERE org_id = $1`, [
        t.orgId,
      ])
    ).rows[0].n;
    expect(after).toBe(before);
  });

  it('refuses a body that is not settings', async () => {
    const res = await as()
      .post('/v2/email/mailboxes/test-imap')
      .send({ imap: { host: 'x' } });
    expect([400, 422]).toContain(res.status);
    const bad = await as()
      .post('/v2/email/mailboxes/test-imap')
      .send({ ...body(), imap: { ...body().imap, host: 'bad host!' } });
    expect([400, 422]).toContain(bad.status);
  });

  it('needs a signed-in person who may manage mailboxes, and the add-on', async () => {
    expect((await rig.p.api.http().post('/v2/email/mailboxes/test-imap').send(body())).status).toBe(
      401,
    );
    const nobody = await rig.p.api.member(t, 'nomail', [['inbox.conversation.read']]);
    expect((await as(nobody.token).post('/v2/email/mailboxes/test-imap').send(body())).status).toBe(
      403,
    );
    const personal = await rig.p.api.member(t, 'persmail', [['mail.mailboxes.manage_personal']]);
    expect(
      (await as(personal.token).post('/v2/email/mailboxes/test-imap').send(body())).status,
    ).toBe(200);
    const locked = await rig.p.api.signup('mtc-locked');
    await setMailPlan(rig.p, locked.orgId, { feature: false });
    const res = await as(locked.admin).post('/v2/email/mailboxes/test-imap').send(body());
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PLAN_FEATURE_LOCKED');
  });
});

describe('E-08: testing a connected mailbox with its saved login', () => {
  it('uses the stored login (never returned), also when the mailbox needs reconnecting', async () => {
    const ok = await insertMailbox(t, 'stored@acme.test');
    const res = await as().post(`/v2/email/mailboxes/${ok}/test`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      ok: false,
      imap: { reason: 'blocked_address' },
      smtp: { reason: 'blocked_address' },
    });
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    const reauth = await insertMailbox(t, 'reauth@acme.test', { status: 'needs_reauth' });
    expect((await as().post(`/v2/email/mailboxes/${reauth}/test`)).status).toBe(200);
  });

  it('is refused for a disconnected mailbox (409), a Gmail or Microsoft one (422), an unknown one and another workspace (404)', async () => {
    const gone = await insertMailbox(t, 'gone@acme.test', { status: 'disconnected' });
    const r409 = await as().post(`/v2/email/mailboxes/${gone}/test`);
    expect(r409.status).toBe(409);
    expect(r409.body.code).toBe('MAIL_MAILBOX_UNAVAILABLE');
    const g = await insertMailbox(t, 'gmail@acme.test', { provider: 'google' });
    const r422 = await as().post(`/v2/email/mailboxes/${g}/test`);
    expect(r422.status).toBe(422);
    expect(r422.body.code).toBe('MAIL_PROVIDER_UNSUPPORTED');
    expect(
      (await as().post('/v2/email/mailboxes/0b6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f50/test')).status,
    ).toBe(404);
    const other = await mailWorkspace(rig.p, 'mtc-other');
    const mine = await insertMailbox(t, 'mine@acme.test');
    expect((await as(other.admin).post(`/v2/email/mailboxes/${mine}/test`)).status).toBe(404);
  });

  it('follows the same right as Sync now: managing personal mailboxes does not open the company’s', async () => {
    const shared = await insertMailbox(t, 'shared@acme.test');
    const personalOnly = await rig.p.api.member(t, 'persmail2', [
      ['mail.mailboxes.manage_personal'],
    ]);
    expect((await as(personalOnly.token).post(`/v2/email/mailboxes/${shared}/test`)).status).toBe(
      403,
    );
  });

  it('is limited to a few runs a minute per workspace (429 MAIL_RATE_LIMITED)', async () => {
    const busy = await mailWorkspace(rig.p, 'mtc-busy');
    const statuses: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      const res = await as(busy.admin).post('/v2/email/mailboxes/test-imap').send(body());
      statuses.push(res.status);
      if (res.status === 429) expect(res.body.code).toBe('MAIL_RATE_LIMITED');
    }
    expect(statuses.slice(0, 6).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(6).every((s) => s === 429)).toBe(true);
    // Another workspace is not affected.
    expect((await as().post('/v2/email/mailboxes/test-imap').send(body())).status).toBe(200);
  });
});

describe('E-11: how far behind a mailbox is', () => {
  it('the hub shows the seconds since the last sync of a connected mailbox, and nothing otherwise', async () => {
    const lag = await mailWorkspace(rig.p, 'mtc-lag');
    await insertMailbox(lag, 'lag-connected@acme.test', { syncedAgoSec: 300 });
    await insertMailbox(lag, 'lag-never@acme.test');
    await insertMailbox(lag, 'lag-gone@acme.test', { status: 'disconnected', syncedAgoSec: 900 });
    const res = await as(lag.admin).get('/v2/email/mailboxes');
    expect(res.status).toBe(200);
    const by = (a: string) =>
      (res.body.data as Array<{ address: string; syncLagSeconds: number | null }>).find(
        (m) => m.address === a,
      )!;
    expect(by('lag-connected@acme.test').syncLagSeconds).toBeGreaterThanOrEqual(300);
    expect(by('lag-connected@acme.test').syncLagSeconds).toBeLessThan(360);
    expect(by('lag-never@acme.test').syncLagSeconds).toBeNull();
    expect(by('lag-gone@acme.test').syncLagSeconds).toBeNull();
  });
});
