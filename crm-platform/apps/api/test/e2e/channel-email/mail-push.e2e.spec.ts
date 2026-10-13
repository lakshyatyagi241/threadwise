import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { MailPushService } from '../../../src/modules/channel-email/mail-push.service';
import { MailSyncPublisher } from '../../../src/modules/channel-email/mail-sync.publisher';
import { MailSyncService } from '../../../src/modules/channel-email/mail-sync.service';
import { MailSyncSweep } from '../../../src/modules/channel-email/mail-sync.sweep';
import { until } from '../chat-conversations/pipeline-support';
import type { Tenant } from '../contacts-attributes-tags/support';
import {
  AUDIENCE,
  FakeJwks,
  newKey,
  SERVICE_ACCOUNT,
  signToken,
} from '../../unit/channel-email/google-push-token';
import { connectMailbox, mailWorkspace, outcomeOf, startMailRig, type MailRig } from './support';

/**
 * Gmail push through Pub/Sub (TW-MAIL-033), end to end: the watch is set on connect-time sweeps and renewed near expiry, the public push
 * endpoint verifies Google's OIDC token (a locally generated key behind a fake JWKS) and syncs exactly the mailbox the notification
 * names, replays and unknown addresses are ignored, a lapse or a disconnect stops the watch. Gmail and Pub/Sub are local stand-ins
 * written from documentation: nothing here talks to Google.
 */
const PUSH = '/v2/public/email/google/push';
const TOPIC = 'projects/acme-mail/topics/gmail-push';
const A1 = 'push-a1@acme.test';
const A2 = 'push-a2@acme.test';
const B1 = 'push-b1@beta.test';
const ENV = [
  'GOOGLE_MAIL_PUBSUB_TOPIC',
  'GOOGLE_MAIL_PUSH_SERVICE_ACCOUNT',
  'GOOGLE_MAIL_PUSH_AUDIENCE',
  'GOOGLE_OIDC_JWKS_URL',
];

let rig: MailRig;
let jwks: FakeJwks;
const key = newKey('push-k1');
const savedEnv: Record<string, string | undefined> = {};
let a: Tenant;
let b: Tenant;
const uuids: Record<string, string> = {};
const orgOf: Record<string, number> = {};

const row = async (address: string) =>
  (await rig.p.h.owner.query(`SELECT * FROM mail_mailboxes WHERE address = $1`, [address]))
    .rows[0] as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const convCount = async (address: string) =>
  Number(
    (
      await rig.p.h.owner.query(
        `SELECT count(*)::int AS n FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
          WHERE ch.uuid = $1`,
        [(await row(address)).channel_uuid],
      )
    ).rows[0].n,
  );
const synced = (address: string) =>
  until(`${address} first sync`, async () =>
    (await row(address)).last_synced_at ? true : undefined,
  );
const sweep = () => rig.p.h.app.get(MailPushService).sweep();
const syncNow = (address: string) =>
  RequestContextStore.run(
    {
      requestId: `spec-${randomUUID()}`,
      orgId: orgOf[address]!,
      actorType: 'system',
      actorId: null,
      userId: null,
    },
    () => rig.p.h.app.get(MailSyncService).sync(orgOf[address]!, uuids[address]!),
  );
const envelope = (data: unknown) => ({
  message: { data: Buffer.from(JSON.stringify(data)).toString('base64'), messageId: '1' },
  subscription: 'projects/acme-mail/subscriptions/gmail-push',
});
const push = (data: unknown, opts: { token?: string | null; body?: unknown } = {}) => {
  const req = request(rig.p.h.app.getHttpServer()).post(PUSH);
  const token = opts.token === undefined ? signToken(key) : opts.token;
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.send(opts.body ?? envelope(data));
};
const historyCalls = () => rig.fake.count('GET', /\/users\/me\/history$/);
const setExpiry = (address: string, ms: number) =>
  rig.p.h.owner.query(
    `UPDATE mail_mailboxes SET push_state = jsonb_set(push_state, '{expiresAt}', to_jsonb($2::text)) WHERE address = $1`,
    [address, new Date(Date.now() + ms).toISOString()],
  );

beforeAll(async () => {
  rig = await startMailRig();
  jwks = await FakeJwks.start([key]);
  for (const k of ENV) savedEnv[k] = process.env[k];
  Object.assign(process.env, {
    GOOGLE_MAIL_PUBSUB_TOPIC: TOPIC,
    GOOGLE_MAIL_PUSH_SERVICE_ACCOUNT: SERVICE_ACCOUNT,
    GOOGLE_MAIL_PUSH_AUDIENCE: AUDIENCE,
    GOOGLE_OIDC_JWKS_URL: jwks.url,
  });
  a = await mailWorkspace(rig.p, 'pusha');
  b = await mailWorkspace(rig.p, 'pushb');
  for (const [t, addr] of [
    [a, A1],
    [a, A2],
    [b, B1],
  ] as const) {
    rig.fake.account(addr, addr);
    expect(outcomeOf(await connectMailbox(rig, t, rig.fake.account(addr, addr)))).toBe('connected');
    uuids[addr] = (await row(addr)).uuid as string;
    orgOf[addr] = t.orgId;
    await synced(addr);
  }
}, 300_000);

afterAll(async () => {
  for (const k of ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await jwks?.stop();
  await rig?.restore();
});

describe('TW-MAIL-033: the watch', () => {
  it('the sweep sets a Gmail watch on the INBOX for every connected mailbox and stores its state', async () => {
    const r = await sweep();
    expect(r.started).toBe(3);
    for (const addr of [A1, A2, B1]) {
      const s = (await row(addr)).push_state as Record<string, unknown>;
      expect(s.kind).toBe('gmail-watch');
      expect(typeof s.historyId).toBe('string');
      expect(Date.parse(String(s.expiresAt))).toBeGreaterThan(Date.now() + 5 * 86_400_000);
      expect(rig.fake.watches.get(addr)?.topicName).toBe(TOPIC);
    }
    const watchCall = rig.fake.requests.find((q) => q.path === '/gmail/v1/users/me/watch')!;
    expect(watchCall.body).toMatchObject({ topicName: TOPIC, labelIds: ['INBOX'] });
  });

  it('shows pushActive in the hub and does nothing on a second sweep', async () => {
    const list = await rig.p.api.as(a.admin).get('/v2/email/mailboxes');
    expect(list.status).toBe(200);
    for (const m of list.body.data as Array<{ address: string; pushActive: boolean }>) {
      expect(m.pushActive).toBe(true);
    }
    const before = rig.fake.count('POST', /\/users\/me\/watch$/);
    expect(await sweep()).toMatchObject({ started: 0, renewed: 0, stopped: 0 });
    expect(rig.fake.count('POST', /\/users\/me\/watch$/)).toBe(before);
  });

  it('renews a watch that is near expiry and leaves the others', async () => {
    await setExpiry(A1, 3 * 3_600_000); // 3 hours left: inside the 24 hour renewal window
    const before = rig.fake.count('POST', /\/users\/me\/watch$/);
    const r = await sweep();
    expect(r.renewed).toBe(1);
    expect(rig.fake.count('POST', /\/users\/me\/watch$/)).toBe(before + 1);
    expect(Date.parse(String((await row(A1)).push_state.expiresAt))).toBeGreaterThan(
      Date.now() + 5 * 86_400_000,
    );
  });

  it('a renewal that fails keeps the watch until it runs out, then forgets it (polling resumes)', async () => {
    await setExpiry(A2, 3 * 3_600_000);
    rig.fake.failNext('POST', /\/users\/me\/watch$/, 500, { times: 2 });
    const r1 = await sweep();
    expect(r1.failed).toBe(1);
    expect((await row(A2)).push_state).not.toBeNull();
    await setExpiry(A2, -60_000); // ran out
    rig.fake.failNext('POST', /\/users\/me\/watch$/, 500, { times: 2 });
    const r2 = await sweep();
    expect(r2.stopped).toBe(1);
    expect((await row(A2)).push_state).toBeNull();
    rig.fake.clearFailures();
    // Next sweep sets it again.
    expect((await sweep()).started).toBe(1);
    expect((await row(A2)).push_state).not.toBeNull();
  });

  it('a mailbox that needs reconnecting loses its watch; a disconnect stops it at Google', async () => {
    await rig.p.h.owner.query(
      `UPDATE mail_mailboxes SET status = 'needs_reauth' WHERE address = $1`,
      [B1],
    );
    expect((await sweep()).stopped).toBe(1);
    expect((await row(B1)).push_state).toBeNull();
    await rig.p.h.owner.query(`UPDATE mail_mailboxes SET status = 'connected' WHERE address = $1`, [
      B1,
    ]);
    expect((await sweep()).started).toBe(1);

    const stops = rig.fake.count('POST', /\/users\/me\/stop$/);
    const res = await rig.p.api.as(b.admin).delete(`/v2/email/mailboxes/${uuids[B1]}`);
    expect(res.status).toBeLessThan(300);
    expect(rig.fake.count('POST', /\/users\/me\/stop$/)).toBe(stops + 1);
    expect(rig.fake.watches.has(B1)).toBe(false);
    expect((await row(B1)).push_state).toBeNull();
  });

  it('switching push off at the platform stops every watch', async () => {
    const topic = process.env.GOOGLE_MAIL_PUBSUB_TOPIC;
    delete process.env.GOOGLE_MAIL_PUBSUB_TOPIC;
    try {
      expect((await sweep()).stopped).toBe(2);
      expect((await row(A1)).push_state).toBeNull();
      expect(rig.fake.watches.size).toBe(0);
      expect((await sweep()).started).toBe(0);
    } finally {
      process.env.GOOGLE_MAIL_PUBSUB_TOPIC = topic;
    }
    expect((await sweep()).started).toBe(2);
  });
});

describe('TW-MAIL-033: the public push endpoint', () => {
  it('refuses a request with no token, a bad token, a wrong audience and an unconfigured platform: 401, no body', async () => {
    const bad = [
      await push({}, { token: null }),
      await push({}, { token: 'not-a-jwt' }),
      await push({}, { token: signToken(key, { aud: 'https://evil.example' }) }),
      await push({}, { token: signToken(key, { email: 'attacker@evil.iam.gserviceaccount.com' }) }),
      await push({}, { token: signToken(newKey('push-k1')) }),
    ];
    for (const r of bad) {
      expect(r.status).toBe(401);
      expect(r.text).toBe('');
    }
    const sa = process.env.GOOGLE_MAIL_PUSH_SERVICE_ACCOUNT;
    delete process.env.GOOGLE_MAIL_PUSH_SERVICE_ACCOUNT;
    try {
      const r = await push({ emailAddress: A1, historyId: '1' });
      expect(r.status).toBe(401);
      expect(r.text).toBe('');
    } finally {
      process.env.GOOGLE_MAIL_PUSH_SERVICE_ACCOUNT = sa;
    }
  });

  it('a push syncs exactly the mailbox it names, and answers 204 at once', async () => {
    const m1 = rig.fake.deliver(A1, { threadId: 'push-1', subject: 'Pushed to A1' });
    rig.fake.deliver(A2, { threadId: 'push-2', subject: 'Waiting at A2' });
    const a1Before = await convCount(A1);
    const a2Before = await convCount(A2);
    const historyId = String(rig.fake.box(A1).historyId);
    const res = await push({ emailAddress: A1, historyId });
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    await until('A1 synced by push', async () =>
      (await convCount(A1)) > a1Before ? true : undefined,
    );
    expect(m1).toBeTruthy();
    // The other mailbox, which also has new mail, was not touched.
    expect(await convCount(A2)).toBe(a2Before);
    expect((await row(A2)).sync_cursor.historyId).not.toBe(String(rig.fake.box(A2).historyId));
  });

  it('a replay (the same or an older history id) is ignored: no second sync', async () => {
    const cursor = String((await row(A1)).sync_cursor.historyId);
    const before = historyCalls();
    for (const id of [cursor, String(Number(cursor) - 1)]) {
      const r = await push({ emailAddress: A1, historyId: id });
      expect(r.status).toBe(204);
    }
    await new Promise((r) => setTimeout(r, 400));
    expect(historyCalls()).toBe(before);
  });

  it('an unknown address, a disconnected mailbox and garbage after a valid token are acknowledged and do nothing', async () => {
    const before = historyCalls();
    const enqueue = vi.spyOn(rig.p.h.app.get(MailSyncPublisher), 'enqueue');
    try {
      rig.fake.deliver(A2, { threadId: 'push-3', subject: 'Still waiting' });
      const high = '999999999';
      expect((await push({ emailAddress: 'nobody@nowhere.test', historyId: high })).status).toBe(
        204,
      );
      expect((await push({ emailAddress: B1, historyId: high })).status).toBe(204); // disconnected above
      expect((await push({}, { body: { message: { data: '!!!' } } })).status).toBe(204);
      expect((await push({}, { body: { nope: true } })).status).toBe(204);
      expect(enqueue).not.toHaveBeenCalled();
      await new Promise((r) => setTimeout(r, 300));
      expect(historyCalls()).toBe(before);
    } finally {
      enqueue.mockRestore();
    }
  });

  it('a push for an address works whatever its case, and a workspace without the add-on is not synced', async () => {
    const enqueue = vi.spyOn(rig.p.h.app.get(MailSyncPublisher), 'enqueue').mockResolvedValue(true);
    try {
      expect(await rig.p.h.app.get(MailPushService).notify(A2.toUpperCase(), '999999999')).toBe(1);
      await rig.p.h.owner.query(
        `UPDATE org_plan_state SET overrides = '{"features":{"email_channel":false}}'::jsonb WHERE org_id = $1`,
        [a.orgId],
      );
      enqueue.mockClear();
      expect(await rig.p.h.app.get(MailPushService).notify(A2, '999999999')).toBe(0);
      expect(enqueue).not.toHaveBeenCalled();
    } finally {
      await rig.p.h.owner.query(
        `UPDATE org_plan_state SET overrides = '{"features":{"email_channel":true},"limits":{"email_mailboxes":3}}'::jsonb WHERE org_id = $1`,
        [a.orgId],
      );
      enqueue.mockRestore();
    }
  });
});

describe('TW-MAIL-033: polling stays the safety net', () => {
  it('the sweep skips a push-active mailbox synced within the reconcile window and picks it up after', async () => {
    await syncNow(A2);
    const enqueue = vi.spyOn(rig.p.h.app.get(MailSyncPublisher), 'enqueue').mockResolvedValue(true);
    try {
      await rig.p.h.app.get(MailSyncSweep).run();
      const mine = enqueue.mock.calls.filter((c) => c[0] === a.orgId).map((c) => c[1]);
      expect(mine).not.toContain(uuids[A1]);
      expect(mine).not.toContain(uuids[A2]);

      await rig.p.h.owner.query(
        `UPDATE mail_mailboxes SET last_synced_at = now() - interval '11 minutes' WHERE address = $1`,
        [A2],
      );
      enqueue.mockClear();
      await rig.p.h.app.get(MailSyncSweep).run();
      expect(enqueue.mock.calls.filter((c) => c[0] === a.orgId).map((c) => c[1])).toEqual([
        uuids[A2],
      ]);

      // A mailbox without a watch is polled every time.
      await rig.p.h.owner.query(`UPDATE mail_mailboxes SET push_state = NULL WHERE address = $1`, [
        A1,
      ]);
      enqueue.mockClear();
      await rig.p.h.app.get(MailSyncSweep).run();
      expect(enqueue.mock.calls.filter((c) => c[0] === a.orgId).map((c) => c[1])).toContain(
        uuids[A1],
      );
    } finally {
      enqueue.mockRestore();
    }
  });
});
