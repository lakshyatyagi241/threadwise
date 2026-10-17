import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MailDriverRegistry } from '../../../src/modules/channel-email/drivers/mail-driver.registry';
import { MailPushService } from '../../../src/modules/channel-email/mail-push.service';
import { MicrosoftMailConfig } from '../../../src/modules/channel-email/microsoft-mail-config.service';
import { startPipeline, until, type Pipeline } from '../chat-conversations/pipeline-support';
import type { Tenant } from '../contacts-attributes-tags/support';
import { FakeGraph, type GraphAccount } from './fake-graph';
import { mailWorkspace, outcomeOf } from './support';

/**
 * Microsoft Graph change notifications (E-17), end to end against the local Graph stand-in (fake-graph.ts, written from Microsoft's
 * documentation): the subscription is created with the validation handshake answered by the REAL public route, renewed before it ends,
 * recreated when Graph dropped it, withdrawn on disconnect; a notification syncs exactly the mailbox its signed clientState and
 * subscription id name, and a forged one syncs nothing. Nothing here talks to Microsoft.
 */
const CALLBACK = '/v2/public/email/microsoft/callback';
const PUSH = '/v2/public/email/microsoft/push';
const NOTIFY_URL = `http://push.test${PUSH}`;
const A1 = 'sales@contoso.test';
const A2 = 'help@contoso.test';
const ENV_KEYS = [
  'MICROSOFT_LOGIN_URL',
  'MICROSOFT_GRAPH_URL',
  'MICROSOFT_MAIL_CLIENT_ID',
  'MICROSOFT_MAIL_CLIENT_SECRET',
  'MICROSOFT_MAIL_TENANT',
  'MAIL_GRAPH_PUSH_ENABLED',
  'MICROSOFT_MAIL_NOTIFICATION_URL',
];

let fake: FakeGraph;
let p: Pipeline;
let t: Tenant;
const saved: Record<string, string | undefined> = {};
const acc: Record<string, GraphAccount> = {};
let codeSeq = 0;

const row = async (address: string) =>
  (await p.h.owner.query(`SELECT * FROM mail_mailboxes WHERE address = $1`, [address]))
    .rows[0] as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const sweep = () => p.h.app.get(MailPushService).sweep();
const post = (body: unknown) =>
  request(p.h.app.getHttpServer())
    .post(PUSH)
    .send(body as object);
const deltaCalls = () => fake.count('GET', /\/mailFolders\/inbox\/messages\/delta$/);
const convCount = async (address: string) =>
  Number(
    (
      await p.h.owner.query(
        `SELECT count(*)::int AS n FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
          WHERE ch.uuid = $1`,
        [(await row(address)).channel_uuid],
      )
    ).rows[0].n,
  );
const subOf = (address: string) => fake.subscriptionsOf(address)[0]!;
const setPush = (address: string, patch: Record<string, unknown>) =>
  p.h.owner.query(
    `UPDATE mail_mailboxes SET push_state = push_state || $2::jsonb WHERE address = $1`,
    [address, JSON.stringify(patch)],
  );
const ms = (n: number) => new Promise((r) => setTimeout(r, n));

async function connect(address: string): Promise<void> {
  const start = await p.api
    .as(t.admin)
    .post('/v2/email/mailboxes/connect')
    .send({ provider: 'microsoft', returnTo: '/email' });
  expect(start.status, JSON.stringify(start.body)).toBe(200);
  const state = new URL(start.body.authorizeUrl as string).searchParams.get('state')!;
  const code = fake.grant(`code-${++codeSeq}`, acc[address]!);
  const res = await request(p.h.app.getHttpServer())
    .get(CALLBACK)
    .query({ code, state })
    .redirects(0);
  expect(outcomeOf(res.headers.location as string)).toBe('connected');
  await until(`${address} first sync`, async () =>
    (await row(address)).last_synced_at ? true : undefined,
  );
}

beforeAll(async () => {
  fake = await FakeGraph.start();
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  Object.assign(process.env, fake.env(), {
    MAIL_GRAPH_PUSH_ENABLED: 'false',
    MICROSOFT_MAIL_NOTIFICATION_URL: NOTIFY_URL,
  });
  p = await startPipeline(async () => [
    (await import('../../../src/modules/channel-email/channel-email-worker.module'))
      .ChannelEmailWorkerModule,
  ]);
  // What Graph does when it validates the address: POST the token, expect it back as text.
  fake.validator = async (_url, token) => {
    const res = await request(p.h.app.getHttpServer()).post(PUSH).query({ validationToken: token });
    return { status: res.status, text: res.text };
  };
  t = await mailWorkspace(p, 'mspush', 3);
  for (const a of [A1, A2]) acc[a] = fake.account(a, a);
  await connect(A1);
  await connect(A2);
}, 300_000);

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await p?.stop();
  await fake?.stop();
});

describe('E-17: off until the operator switches it on', () => {
  it('creates no subscription and the public route answers 404 (not an open echo)', async () => {
    expect(await sweep()).toMatchObject({ started: 0, renewed: 0 });
    expect(fake.subscriptions.size).toBe(0);
    expect((await row(A1)).push_state).toBeNull();
    expect(
      (await request(p.h.app.getHttpServer()).post(PUSH).query({ validationToken: 'x' })).status,
    ).toBe(404);
  });
});

describe('E-17: the subscription', () => {
  it('is created for each connected mailbox, validated through the real route, and stored', async () => {
    process.env.MAIL_GRAPH_PUSH_ENABLED = 'true';
    const out = await sweep();
    expect(out).toMatchObject({ started: 2, failed: 0 });
    for (const a of [A1, A2]) {
      const s = subOf(a);
      expect(s).toMatchObject({
        resource: "me/mailFolders('inbox')/messages",
        changeType: 'created',
        notificationUrl: NOTIFY_URL,
        lifecycleNotificationUrl: NOTIFY_URL,
      });
      const mb = await row(a);
      expect(s.clientState.startsWith(`${t.orgId}.${mb.uuid}.`)).toBe(true);
      expect(s.clientState.length).toBeLessThanOrEqual(128);
      expect(mb.push_state).toMatchObject({ kind: 'graph-subscription', id: s.id });
      expect(Date.parse(mb.push_state.expiresAt)).toBeGreaterThan(Date.now() + 40 * 3_600_000);
    }
    const config = p.h.app.get(MicrosoftMailConfig);
    const cfg = (await config.push())!;
    expect(cfg.verify(subOf(A1).clientState)).toEqual({
      orgId: t.orgId,
      mailboxUuid: (await row(A1)).uuid,
    });
  });

  it('is left alone while far from its end, and the hub reports push as active', async () => {
    const before =
      fake.count('PATCH', /\/subscriptions\//) + fake.count('POST', /\/subscriptions$/);
    expect(await sweep()).toMatchObject({ started: 0, renewed: 0 });
    expect(fake.count('PATCH', /\/subscriptions\//) + fake.count('POST', /\/subscriptions$/)).toBe(
      before,
    );
    const list = await p.api.as(t.admin).get('/v2/email/mailboxes');
    expect(list.body.data.every((m: { pushActive: boolean }) => m.pushActive)).toBe(true);
  });

  it('answers the validation handshake as plain text and refuses an empty or oversized token', async () => {
    const ok = await request(p.h.app.getHttpServer())
      .post(PUSH)
      .query({ validationToken: 'abc 123+x' });
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toMatch(/^text\/plain/);
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    expect(ok.text).toBe('abc 123+x');
    expect(
      (await request(p.h.app.getHttpServer()).post(PUSH).query({ validationToken: '' })).status,
    ).toBe(400);
    expect(
      (
        await request(p.h.app.getHttpServer())
          .post(PUSH)
          .query({ validationToken: 'x'.repeat(1_001) })
      ).status,
    ).toBe(400);
  });

  it('is renewed in place (same id, later end) once it has less than the renewal window left', async () => {
    const id = subOf(A1).id;
    await setPush(A1, { expiresAt: new Date(Date.now() + 2 * 3_600_000).toISOString() });
    fake.subscriptions.get(id)!.expires = Date.now() + 2 * 3_600_000;
    const patches = fake.count('PATCH', /\/subscriptions\//);
    expect(await sweep()).toMatchObject({ renewed: 1, started: 0, failed: 0 });
    expect(fake.count('PATCH', /\/subscriptions\//)).toBe(patches + 1);
    expect(fake.subscriptionsOf(A1)).toHaveLength(1);
    expect(subOf(A1).id).toBe(id);
    expect(subOf(A1).expires).toBeGreaterThan(Date.now() + 40 * 3_600_000);
    expect(Date.parse((await row(A1)).push_state.expiresAt)).toBeGreaterThan(
      Date.now() + 40 * 3_600_000,
    );
  });

  it('is created again when Graph no longer has it', async () => {
    const oldId = subOf(A2).id;
    fake.dropSubscription(oldId);
    await setPush(A2, { expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect(await sweep()).toMatchObject({ renewed: 1, failed: 0 });
    expect(subOf(A2).id).not.toBe(oldId);
    expect((await row(A2)).push_state.id).toBe(subOf(A2).id);
  });
});

describe('E-17: a notification', () => {
  it('syncs the mailbox it names: the new mail is a conversation within seconds, read through the delta cursor', async () => {
    const before = await convCount(A1);
    fake.deliver(A1, {
      conversationId: 'push-1',
      subject: 'Pushed hello',
      from: 'new@example.com',
    });
    const res = await post(fake.notification(subOf(A1)));
    expect(res.status).toBe(202);
    await until('the pushed mail', async () => ((await convCount(A1)) > before ? true : undefined));
  });

  it('is dropped silently when forged: a wrong clientState, another mailbox’s subscription id, an unknown one or garbage', async () => {
    fake.deliver(A1, {
      conversationId: 'push-2',
      subject: 'Should wait',
      from: 'late@example.com',
    });
    const calls = deltaCalls();
    const before = await convCount(A1);
    const sub = subOf(A1);
    const other = subOf(A2);
    expect((await post(fake.notification(sub, { clientState: 'forged' }))).status).toBe(202);
    expect(
      (
        await post(
          fake.notification(sub, { clientState: `${t.orgId}.${randomUUID()}.${'A'.repeat(43)}` }),
        )
      ).status,
    ).toBe(202);
    // A genuine clientState of A1 carried by A2's subscription id.
    expect((await post(fake.notification(sub, { subscriptionId: other.id }))).status).toBe(202);
    expect((await post(fake.notification(sub, { subscriptionId: 'sub-unknown' }))).status).toBe(
      202,
    );
    expect((await post({ nope: true })).status).toBe(400);
    expect((await post('not json')).status).toBe(400);
    await ms(1_500);
    expect(deltaCalls()).toBe(calls);
    expect(await convCount(A1)).toBe(before);
  });

  it('a burst for one mailbox is one sync job', async () => {
    const calls = deltaCalls();
    await Promise.all(Array.from({ length: 5 }, () => post(fake.notification(subOf(A1)))));
    await until('the held mail', async () => ((await convCount(A1)) >= 2 ? true : undefined));
    await ms(1_500);
    expect(deltaCalls() - calls).toBeLessThanOrEqual(3);
  });
});

describe('E-17: lifecycle events', () => {
  it('reauthorizationRequired flags the subscription for renewal and the sweep renews it', async () => {
    const id = subOf(A1).id;
    expect(
      (await post(fake.notification(subOf(A1), { lifecycleEvent: 'reauthorizationRequired' })))
        .status,
    ).toBe(202);
    await until('the flag', async () =>
      (await row(A1)).push_state?.renewNow === true ? true : undefined,
    );
    const patches = fake.count('PATCH', /\/subscriptions\//);
    expect(await sweep()).toMatchObject({ renewed: 1, failed: 0 });
    expect(fake.count('PATCH', /\/subscriptions\//)).toBe(patches + 1);
    expect(subOf(A1).id).toBe(id);
    expect((await row(A1)).push_state.renewNow).toBeUndefined();
  });

  it('subscriptionRemoved forgets the subscription and the sweep makes a new one', async () => {
    const old = subOf(A1);
    fake.dropSubscription(old.id);
    expect(
      (await post(fake.notification(old, { lifecycleEvent: 'subscriptionRemoved' }))).status,
    ).toBe(202);
    await until('forgotten', async () => ((await row(A1)).push_state === null ? true : undefined));
    expect(await sweep()).toMatchObject({ started: 1, failed: 0 });
    expect(subOf(A1).id).not.toBe(old.id);
  });
});

describe('E-17: failures and the end of a mailbox', () => {
  it('a subscription Microsoft refuses to validate leaves the mailbox polled, counted as failed, never an exception', async () => {
    const id = subOf(A2).id;
    await p.h.owner.query(`UPDATE mail_mailboxes SET push_state = NULL WHERE address = $1`, [A2]);
    fake.dropSubscription(id);
    const keep = fake.validator;
    fake.validator = async () => ({ status: 500, text: '' });
    try {
      expect(await sweep()).toMatchObject({ started: 0, failed: 1 });
      expect((await row(A2)).push_state).toBeNull();
      expect(fake.subscriptionsOf(A2)).toHaveLength(0);
    } finally {
      fake.validator = keep;
    }
    expect(await sweep()).toMatchObject({ started: 1, failed: 0 });
  });

  it('push is lapsed (and the subscription withdrawn) when the platform switches it off', async () => {
    process.env.MAIL_GRAPH_PUSH_ENABLED = 'false';
    try {
      const out = await sweep();
      expect(out.stopped).toBe(2);
      expect((await row(A1)).push_state).toBeNull();
      expect(fake.subscriptions.size).toBe(0);
    } finally {
      process.env.MAIL_GRAPH_PUSH_ENABLED = 'true';
    }
    expect(await sweep()).toMatchObject({ started: 2 });
  });

  it('disconnecting a mailbox deletes its subscription at Microsoft and forgets it here', async () => {
    const id = subOf(A2).id;
    const res = await p.api
      .as(t.admin)
      .delete(`/v2/email/mailboxes/${(await row(A2)).uuid as string}`);
    expect(res.status).toBe(204);
    expect(fake.subscriptions.has(id)).toBe(false);
    expect((await row(A2)).push_state).toBeNull();
    // A late notification for it is ignored.
    const calls = deltaCalls();
    await post(fake.notification({ ...subOf(A1), id }, {}));
    await ms(800);
    expect(deltaCalls()).toBe(calls);
  });

  it('the driver says it supports push, and Gmail’s sweep is untouched', () => {
    const drivers = p.h.app.get(MailDriverRegistry);
    expect(drivers.get('microsoft').push).toBeTruthy();
    expect(drivers.get('google').push).toBeTruthy();
    expect(drivers.get('imap').push).toBeUndefined();
  });
});
