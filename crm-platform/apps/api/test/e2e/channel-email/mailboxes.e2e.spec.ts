import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  connectMailbox,
  CALLBACK,
  mailWorkspace,
  outcomeOf,
  setMailPlan,
  startMailRig,
  stateFor,
  WEB,
  type MailRig,
} from './support';
import type { Tenant } from '../contacts-attributes-tags/support';

/**
 * The Email channel's mailboxes (TW-MAIL-019 to 023, 028, 030), end to end through HTTP: Connect Google (the signed state, the public
 * callback), what is stored (sealed tokens, never returned), the inbox channel each mailbox feeds, the plan limit, the wrong-account refusal,
 * rename / sync / disconnect, permissions, the plan gate and tenant isolation. Google is a local stand-in written from its documentation:
 * nothing here talks to a real Google account.
 */
let rig: MailRig;
let a: Tenant;
let b: Tenant;
const ANA = 'support@acme.test';
const SALES = 'sales@acme.test';

const as = (t: Tenant | string) => rig.p.api.as(typeof t === 'string' ? t : t.admin);
const list = async (t: Tenant) => {
  const res = await as(t).get('/v2/email/mailboxes');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as {
    data: Array<{
      id: string;
      address: string;
      displayName: string;
      status: string;
      channelId: string | null;
      connectedAt: string | null;
      lastError: string | null;
      conversationCount: number;
      rowVersion: number;
    }>;
    limit: number;
    used: number;
    providerReady: boolean;
  };
};
const rowsOf = async (orgId: number) =>
  (await rig.p.h.owner.query(`SELECT * FROM mail_mailboxes WHERE org_id = $1 ORDER BY id`, [orgId]))
    .rows as Array<Record<string, unknown>>;
const outboxTypes = async (orgId: number) =>
  (
    await rig.p.h.owner.query(
      `SELECT event_type FROM event_outbox WHERE org_id = $1 AND aggregate_module = 'mail_mailboxes' ORDER BY id`,
      [orgId],
    )
  ).rows.map((r) => r.event_type as string);

beforeAll(async () => {
  rig = await startMailRig();
  a = await mailWorkspace(rig.p, 'mba', 2);
  b = await mailWorkspace(rig.p, 'mbb', 3);
}, 300_000);

afterAll(async () => {
  await rig?.restore();
});

describe('TW-MAIL-020: connect Google', () => {
  it('the connect route returns the consent URL with offline access, both Gmail scopes and a signed state', async () => {
    const res = await as(a).post('/v2/email/mailboxes/connect').send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const url = new URL(res.body.authorizeUrl as string);
    expect(url.origin + url.pathname).toBe(`${rig.fake.url}/auth`);
    expect(url.searchParams.get('client_id')).toBe('mail-client');
    expect(url.searchParams.get('redirect_uri')).toBe(`http://localhost:3999${CALLBACK}`);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('scope')).toBe(
      'openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send',
    );
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('the callback stores a connected mailbox with sealed tokens, creates its inbox channel and answers a redirect with the outcome', async () => {
    const location = await connectMailbox(rig, a, rig.fake.account(ANA, 'Acme Support'));
    expect(location).toBe(`${WEB}/email?email=connected`);

    const res = await list(a);
    expect(res).toMatchObject({ limit: 2, used: 1, providerReady: true });
    const [m] = res.data;
    expect(m).toMatchObject({
      address: ANA,
      displayName: 'Acme Support',
      status: 'connected',
      lastError: null,
      conversationCount: 0,
    });
    expect(m!.connectedAt).not.toBeNull();
    expect(JSON.stringify(res)).not.toMatch(/rt-|at-|token/i);

    const [row] = await rowsOf(a.orgId);
    expect(String(row!.refresh_token_enc)).toMatch(/^v1:/);
    expect(String(row!.access_token_enc)).toMatch(/^v1:/);
    expect(String(row!.refresh_token_enc)).not.toContain('rt-');
    expect(row).toMatchObject({
      address: ANA,
      provider: 'google',
      scope: 'shared',
      owner_user_id: null,
    });

    // One inbox channel per mailbox: kind email, named by the address, not metered.
    const ch = await rig.p.h.owner.query(
      `SELECT * FROM channels WHERE org_id = $1 AND kind = 'email'`,
      [a.orgId],
    );
    expect(ch.rows).toHaveLength(1);
    expect(ch.rows[0]).toMatchObject({
      name: ANA,
      status: 'connected',
      display_address: ANA,
      external_id: row!.uuid,
    });
    expect(ch.rows[0].settings).toMatchObject({ metered: false });
    expect(m!.channelId).toBe(ch.rows[0].uuid);

    expect(await outboxTypes(a.orgId)).toEqual(['mail.mailbox.connected']);
    const audit = await rig.p.h.owner.query(
      `SELECT action FROM audit_log WHERE org_id = $1 AND module = 'mail_mailboxes'`,
      [a.orgId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['insert']);
  });

  it('reconnecting the same address updates the row (no second mailbox, same channel), new tokens and a reconnected event', async () => {
    const before = (await rowsOf(a.orgId))[0]!;
    const location = await connectMailbox(rig, a, rig.fake.account(ANA));
    expect(outcomeOf(location)).toBe('connected');
    const rows = await rowsOf(a.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.uuid).toBe(before.uuid);
    expect(rows[0]!.refresh_token_enc).not.toBe(before.refresh_token_enc);
    expect(rows[0]!.display_name).toBe('Acme Support');
    expect(
      (
        await rig.p.h.owner.query(
          `SELECT count(*)::int AS n FROM channels WHERE org_id = $1 AND kind = 'email'`,
          [a.orgId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(await outboxTypes(a.orgId)).toEqual([
      'mail.mailbox.connected',
      'mail.mailbox.reconnected',
    ]);
  });

  it('the plan limit counts connected mailboxes: the second fits, the third is refused (route and callback)', async () => {
    expect(outcomeOf(await connectMailbox(rig, a, rig.fake.account(SALES)))).toBe('connected');
    expect((await list(a)).used).toBe(2);
    // The route refuses before the person goes through Google.
    const start = await as(a).post('/v2/email/mailboxes/connect').send({});
    expect(start.status).toBe(422);
    expect(start.body.code).toBe('MAIL_MAILBOX_LIMIT');
    // A state issued before the limit was reached is still checked at the callback.
    const state = stateFor(a.orgId, a.adminUserId);
    const code = rig.fake.grant('late-1', rig.fake.account('third@acme.test'));
    const res = await request(rig.p.h.app.getHttpServer())
      .get(CALLBACK)
      .query({ code, state })
      .redirects(0);
    expect(res.headers.location).toBe(`${WEB}/email?email=limit`);
    expect(await rowsOf(a.orgId)).toHaveLength(2);
    // The grant that was just obtained is withdrawn rather than left dangling.
    expect(rig.fake.revoked.length).toBeGreaterThan(0);
  });

  it('a person who is not the mailbox being reconnected is refused: wrong_account, nothing changes', async () => {
    const mailbox = (await list(a)).data.find((m) => m.address === SALES)!;
    const before = (await rowsOf(a.orgId)).find((r) => r.address === SALES)!;
    const location = await connectMailbox(rig, a, rig.fake.account('someone.else@acme.test'), {
      mailboxId: mailbox.id,
    });
    expect(outcomeOf(location)).toBe('wrong_account');
    const after = (await rowsOf(a.orgId)).find((r) => r.address === SALES)!;
    expect(after.refresh_token_enc).toBe(before.refresh_token_enc);
    expect(after.status).toBe('connected');
  });

  it('a reconnect of the right address by a different Google account (same address text, other id) is also refused', async () => {
    const mailbox = (await list(a)).data.find((m) => m.address === SALES)!;
    const impostor = { sub: 'sub-impostor', email: SALES, name: 'x' };
    rig.fake.account(SALES);
    const location = await connectMailbox(rig, a, impostor, { mailboxId: mailbox.id });
    expect(outcomeOf(location)).toBe('wrong_account');
  });

  it('a refusal on Google (denied), a missing permission and a missing refresh token each end without storing anything', async () => {
    const t = await mailWorkspace(rig.p, 'mbx', 3);
    const denied = await request(rig.p.h.app.getHttpServer())
      .get(CALLBACK)
      .query({ error: 'access_denied', state: stateFor(t.orgId, t.adminUserId) })
      .redirects(0);
    expect(denied.headers.location).toBe(`${WEB}/email?email=denied`);

    const noMail = await connectMailbox(rig, t, rig.fake.account('p1@acme.test'), {
      scope:
        'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.readonly',
    });
    expect(outcomeOf(noMail)).toBe('missing_scope');
    const noRefresh = await connectMailbox(rig, t, rig.fake.account('p2@acme.test'), {
      refresh: false,
    });
    expect(outcomeOf(noRefresh)).toBe('failed');
    expect(await rowsOf(t.orgId)).toHaveLength(0);
    expect(await list(t)).toMatchObject({ used: 0 });
  });

  it('a bad, forged, expired or foreign state is refused before Google is called; the code is never exchanged', async () => {
    const calls = rig.fake.forms('authorization_code').length;
    const go = async (state: string) =>
      (
        await request(rig.p.h.app.getHttpServer())
          .get(CALLBACK)
          .query({ code: 'whatever', state })
          .redirects(0)
      ).headers.location;
    expect(await go('garbage')).toBe(`${WEB}/email?email=failed`);
    expect(await go(stateFor(a.orgId, a.adminUserId, null, Date.now() - 3_600_000))).toBe(
      `${WEB}/email?email=failed`,
    );
    const forged = stateFor(a.orgId, a.adminUserId).split('.')[0]! + '.AAAA';
    expect(await go(forged)).toBe(`${WEB}/email?email=failed`);
    const noState = await request(rig.p.h.app.getHttpServer())
      .get(CALLBACK)
      .query({ code: 'x' })
      .redirects(0);
    expect(noState.headers.location).toBe(`${WEB}/email?email=failed`);
    expect(rig.fake.forms('authorization_code').length).toBe(calls);
  });

  it('the callback is never cached and sends no referrer', async () => {
    const res = await request(rig.p.h.app.getHttpServer())
      .get(CALLBACK)
      .query({ error: 'access_denied' })
      .redirects(0);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('without a platform Google client the route says so and the hub reports providerReady false', async () => {
    const id = process.env.GOOGLE_MAIL_CLIENT_ID;
    delete process.env.GOOGLE_MAIL_CLIENT_ID;
    try {
      const res = await as(b).post('/v2/email/mailboxes/connect').send({});
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('MAIL_NOT_CONFIGURED');
      expect((await list(b)).providerReady).toBe(false);
    } finally {
      process.env.GOOGLE_MAIL_CLIENT_ID = id;
    }
    expect((await list(b)).providerReady).toBe(true);
  });

  it('a return address outside the app is refused when the connection starts', async () => {
    for (const returnTo of ['https://evil.example/x', '//evil.example']) {
      const res = await as(a).post('/v2/email/mailboxes/connect').send({ returnTo });
      expect(res.status).toBe(422);
    }
  });
});

describe('TW-MAIL-019, 028: list, rename, sync, disconnect', () => {
  it('renames under the optimistic lock', async () => {
    const m = (await list(a)).data.find((x) => x.address === SALES)!;
    const ok = await as(a)
      .patch(`/v2/email/mailboxes/${m.id}`)
      .set('idempotency-key', crypto.randomUUID())
      .send({ displayName: 'Acme Sales', rowVersion: m.rowVersion });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ displayName: 'Acme Sales', address: SALES });
    expect(ok.body.rowVersion).toBeGreaterThan(m.rowVersion);
    const stale = await as(a)
      .patch(`/v2/email/mailboxes/${m.id}`)
      .set('idempotency-key', crypto.randomUUID())
      .send({ displayName: 'Stale', rowVersion: m.rowVersion });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');
    const empty = await as(a)
      .patch(`/v2/email/mailboxes/${m.id}`)
      .set('idempotency-key', crypto.randomUUID())
      .send({ displayName: '  ', rowVersion: ok.body.rowVersion });
    expect(empty.status).toBe(422);
  });

  it('sync now queues a sync and answers 202 with the mailbox; the worker stores its time', async () => {
    const m = (await list(a)).data.find((x) => x.address === ANA)!;
    const res = await as(a).post(`/v2/email/mailboxes/${m.id}/sync`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.address).toBe(ANA);
    const deadline = Date.now() + 20_000;
    let synced: Date | null = null;
    while (Date.now() < deadline && !synced) {
      const row = (await rowsOf(a.orgId)).find((r) => r.address === ANA)!;
      synced = (row.last_synced_at as Date | null) ?? null;
      if (!synced) await new Promise((r) => setTimeout(r, 100));
    }
    expect(synced).not.toBeNull();
    expect((await rowsOf(a.orgId)).find((r) => r.address === ANA)!.sync_cursor).not.toBeNull();
  });

  it('disconnect revokes at Google, wipes the tokens, keeps the row and its channel (read-only), and is idempotent', async () => {
    const m = (await list(a)).data.find((x) => x.address === SALES)!;
    const revokedBefore = rig.fake.revoked.length;
    const res = await as(a)
      .delete(`/v2/email/mailboxes/${m.id}`)
      .set('idempotency-key', crypto.randomUUID());
    expect(res.status).toBe(204);
    expect(rig.fake.revoked.length).toBe(revokedBefore + 1);
    const row = (await rowsOf(a.orgId)).find((r) => r.address === SALES)!;
    expect(row).toMatchObject({
      status: 'disconnected',
      refresh_token_enc: null,
      access_token_enc: null,
    });
    const ch = await rig.p.h.owner.query(
      `SELECT status FROM channels WHERE org_id = $1 AND external_id = $2`,
      [a.orgId, row.uuid],
    );
    expect(ch.rows[0].status).toBe('disconnected');
    const after = await list(a);
    expect(after.used).toBe(1);
    expect(after.data.find((x) => x.address === SALES)!.status).toBe('disconnected');
    expect(await outboxTypes(a.orgId)).toContain('mail.mailbox.disconnected');
    const again = await as(a)
      .delete(`/v2/email/mailboxes/${m.id}`)
      .set('idempotency-key', crypto.randomUUID());
    expect(again.status).toBe(204);
    expect(rig.fake.revoked.length).toBe(revokedBefore + 1);
    // A disconnected mailbox cannot sync.
    const sync = await as(a).post(`/v2/email/mailboxes/${m.id}/sync`).send({});
    expect(sync.status).toBe(409);
    expect(sync.body.code).toBe('MAIL_MAILBOX_UNAVAILABLE');
  });

  it('a disconnected mailbox frees its place; reconnecting the same address reattaches the same row and channel', async () => {
    const before = (await rowsOf(a.orgId)).find((r) => r.address === SALES)!;
    // Both places are free again (one connected, one disconnected): a new address fits.
    expect(outcomeOf(await connectMailbox(rig, a, rig.fake.account('third@acme.test')))).toBe(
      'connected',
    );
    expect((await list(a)).used).toBe(2);
    // The old address now needs a place, and there is none.
    const start = await as(a).post('/v2/email/mailboxes/connect').send({});
    expect(start.body.code).toBe('MAIL_MAILBOX_LIMIT');
    const code = rig.fake.grant('limit-2', rig.fake.account(SALES));
    const cb = await request(rig.p.h.app.getHttpServer())
      .get(CALLBACK)
      .query({ code, state: stateFor(a.orgId, a.adminUserId) })
      .redirects(0);
    expect(outcomeOf(cb.headers.location as string)).toBe('limit');
    expect((await rowsOf(a.orgId)).find((r) => r.address === SALES)!.status).toBe('disconnected');
    // Free one, then reconnect: same row, same channel, connected again.
    const third = (await list(a)).data.find((x) => x.address === 'third@acme.test')!;
    expect(
      (
        await as(a)
          .delete(`/v2/email/mailboxes/${third.id}`)
          .set('idempotency-key', crypto.randomUUID())
      ).status,
    ).toBe(204);
    expect(outcomeOf(await connectMailbox(rig, a, rig.fake.account(SALES)))).toBe('connected');
    const after = (await rowsOf(a.orgId)).find((r) => r.address === SALES)!;
    expect(after.uuid).toBe(before.uuid);
    expect(after.status).toBe('connected');
    expect(after.channel_uuid).toBe(before.channel_uuid);
    const ch = await rig.p.h.owner.query(
      `SELECT status FROM channels WHERE org_id = $1 AND external_id = $2`,
      [a.orgId, after.uuid],
    );
    expect(ch.rows[0].status).toBe('connected');
  });
});

describe('TW-MAIL-030: permissions, plan gate, isolation', () => {
  it('reading needs mail.mailboxes.read; connecting, renaming, syncing and disconnecting need mail.mailboxes.manage', async () => {
    const viewer = await rig.p.api.member(a, 'viewer', [['mail.mailboxes.read']]);
    const nobody = await rig.p.api.member(a, 'nobody', [['record.contacts.read']]);
    const manager = await rig.p.api.member(a, 'manager', [['mail.mailboxes.manage']]);
    const m = (await list(a)).data[0]!;
    expect((await as(viewer.token).get('/v2/email/mailboxes')).status).toBe(200);
    expect((await as(nobody.token).get('/v2/email/mailboxes')).status).toBe(403);
    expect((await as(viewer.token).post('/v2/email/mailboxes/connect').send({})).status).toBe(403);
    expect((await as(viewer.token).post(`/v2/email/mailboxes/${m.id}/sync`).send({})).status).toBe(
      403,
    );
    expect(
      (
        await as(viewer.token)
          .delete(`/v2/email/mailboxes/${m.id}`)
          .set('idempotency-key', crypto.randomUUID())
      ).status,
    ).toBe(403);
    expect(
      (
        await as(viewer.token)
          .patch(`/v2/email/mailboxes/${m.id}`)
          .set('idempotency-key', crypto.randomUUID())
          .send({ displayName: 'x', rowVersion: 1 })
      ).status,
    ).toBe(403);
    // Manage alone does not read.
    expect((await as(manager.token).get('/v2/email/mailboxes')).status).toBe(403);
    // Permission passed: the answer is the route's own (a consent URL, or the plan limit), never 403.
    expect((await as(manager.token).post('/v2/email/mailboxes/connect').send({})).status).not.toBe(
      403,
    );
  });

  it('a workspace without the add-on is locked out of every route (422 PLAN_FEATURE_LOCKED), a lapse included', async () => {
    const t = await rig.p.api.signup('mblock');
    await setMailPlan(rig.p, t.orgId, { feature: false });
    for (const [method, path] of [
      ['get', '/v2/email/mailboxes'],
      ['post', '/v2/email/mailboxes/connect'],
    ] as const) {
      const res = await as(t)[method](path);
      expect(res.status, path).toBe(422);
      expect(res.body.code).toBe('PLAN_FEATURE_LOCKED');
    }
    // A workspace that had the add-on and lost it: same answer, data kept.
    await setMailPlan(rig.p, a.orgId, { feature: false });
    try {
      const res = await as(a).get('/v2/email/mailboxes');
      expect(res.status).toBe(422);
      expect(await rowsOf(a.orgId)).not.toHaveLength(0);
      // A consent that finishes after the lapse stores nothing.
      const code = rig.fake.grant('lapse-1', rig.fake.account('late@acme.test'));
      const cb = await request(rig.p.h.app.getHttpServer())
        .get(CALLBACK)
        .query({ code, state: stateFor(a.orgId, a.adminUserId) })
        .redirects(0);
      expect(cb.headers.location).toBe(`${WEB}/email?email=failed`);
      expect((await rowsOf(a.orgId)).some((r) => r.address === 'late@acme.test')).toBe(false);
    } finally {
      await setMailPlan(rig.p, a.orgId, { feature: true, mailboxes: 2 });
    }
  });

  it("another workspace's mailbox is a 404 for every action and absent from the list", async () => {
    expect(outcomeOf(await connectMailbox(rig, b, rig.fake.account('b-support@other.test')))).toBe(
      'connected',
    );
    const mine = (await list(b)).data[0]!;
    expect((await list(a)).data.find((x) => x.id === mine.id)).toBeUndefined();
    expect((await as(a).post(`/v2/email/mailboxes/${mine.id}/sync`).send({})).status).toBe(404);
    expect(
      (
        await as(a)
          .patch(`/v2/email/mailboxes/${mine.id}`)
          .set('idempotency-key', crypto.randomUUID())
          .send({ displayName: 'x', rowVersion: mine.rowVersion })
      ).status,
    ).toBe(404);
    expect(
      (
        await as(a)
          .delete(`/v2/email/mailboxes/${mine.id}`)
          .set('idempotency-key', crypto.randomUUID())
      ).status,
    ).toBe(404);
    // Reconnecting it from another workspace is refused at start.
    expect(
      (await as(a).post('/v2/email/mailboxes/connect').send({ mailboxId: mine.id })).status,
    ).toBe(404);
    expect((await list(b)).data[0]!.status).toBe('connected');
  });

  it('the same Gmail address can be connected by two workspaces, each with its own mailbox and channel', async () => {
    const shared = rig.fake.account('shared@both.test');
    expect(outcomeOf(await connectMailbox(rig, b, shared))).toBe('connected');
    const t = await mailWorkspace(rig.p, 'mbc', 3);
    expect(outcomeOf(await connectMailbox(rig, t, shared))).toBe('connected');
    expect((await list(t)).data).toHaveLength(1);
  });
});
