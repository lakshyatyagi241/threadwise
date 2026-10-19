import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { QUEUES } from '../../../src/infra/queue/queues';
import { BroadcastSenderService } from '../../../src/modules/channel-wechat/broadcast-sender.service';
import { SendWindowService } from '../../../src/modules/compliance-center';
import { ConsentGate } from '../../../src/modules/contact-consent';
import { ConsentKit, refusedWith } from '../contact-consent/broadcast-consent.support';
import { BroadcastProcessor } from '../../../src/modules/channel-wechat/broadcast.processor';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';
import { textXml } from '../../support/wechat-crypto';
import {
  connect,
  installFakeWechat,
  post,
  push,
  refused,
  type Account,
  type Fake,
} from './support';

/** WeChat broadcasts (WECH): audience, draft, the one mass-send call run by the worker job, retry, delete. Real Postgres, fake WeChat. */
let h: Harness;
let api: Api;
let wechat: Fake;
let sender: BroadcastSenderService;
let queue: Queue;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  wechat = installFakeWechat(h);
  sender = h.app.get(BroadcastSenderService);
  queue = h.app.get<Queue>(getQueueToken(QUEUES.WECHAT_BROADCAST));
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => wechat.reset());

let mid = 5000;
/** An account whose inbox has `count` followers (oFollower0 ...). */
async function accountWithFollowers(t: Tenant, count: number): Promise<Account> {
  const a = await connect(api, h, t);
  for (let i = 0; i < count; i++) {
    await push(api, a, textXml({ openid: `oFollower${i}`, content: 'hi', msgId: ++mid }));
  }
  return a;
}
const openids = (count: number) => Array.from({ length: count }, (_, i) => `oFollower${i}`);
const code = (res: { body: { code?: string } }) => res.body.code;
const create = (t: Tenant, a: Account, over: object = {}) =>
  post(api, t, '/v2/wechat/broadcasts', {
    name: 'Weekend sale',
    channelId: a.uuid,
    body: 'Big sale this weekend 你好',
    audience: 'list',
    openids: openids(3),
    ...over,
  });
const rowOf = async (uuid: string) =>
  (await h.owner.query(`SELECT * FROM wechat_broadcasts WHERE uuid = $1`, [uuid])).rows[0];
const recipients = async (uuid: string) =>
  (
    await h.owner.query(
      `SELECT r.openid, r.status, r.title, r.conversation_id FROM wechat_broadcast_recipients r
       JOIN wechat_broadcasts b ON b.org_id = r.org_id AND b.id = r.wechat_broadcast_id
       WHERE b.uuid = $1 ORDER BY r.id`,
      [uuid],
    )
  ).rows as Array<{ openid: string; status: string; title: string; conversation_id: string }>;
const idOf = async (uuid: string) => Number((await rowOf(uuid)).id);
const mass = () =>
  wechat.calls.filter((x) => x.method === 'massSend' || x.method === 'massSendAll');
const queued = async () => (await queue.getJobs(['waiting', 'delayed', 'active'])).map((j) => j.id);

describe('WECH audience: the followers a channel carries', () => {
  it("lists this channel's inbox threads with their OpenIDs, never another channel's or another workspace's", async () => {
    const t = await api.signup('wb1');
    const u = await api.signup('wb1b');
    const a = await accountWithFollowers(t, 2);
    const other = await connect(api, h, t);
    await push(api, other, textXml({ openid: 'oElsewhere', content: 'x', msgId: ++mid }));
    await push(api, a, textXml({ openid: 'oCaseSensitive', content: 'x', msgId: ++mid }));
    const foreign = await accountWithFollowers(u, 1);

    const res = await api.http().get(`/v2/wechat/channels/${a.uuid}/chats`).set(bearer(t.admin));
    expect(res.status).toBe(200);
    expect((res.body.data as Array<{ openid: string }>).map((c) => c.openid).sort()).toEqual([
      'oCaseSensitive',
      'oFollower0',
      'oFollower1',
    ]);
    expect(res.body.data[0]).toMatchObject({ title: expect.any(String) });
    expect(
      (await api.http().get(`/v2/wechat/channels/${foreign.uuid}/chats`).set(bearer(t.admin)))
        .status,
    ).toBe(404);
  });
});

describe('WECH compose: the page opens with channels and WeChat templates', () => {
  it('lists the channels and only the templates written for WeChat', async () => {
    const t = await api.signup('wb2');
    const a = await accountWithFollowers(t, 0);
    await h.owner.query(
      `INSERT INTO wa_templates (org_id, template_name, template_body, channel) VALUES ($1, 'wx-offer', 'Offer text', 'wechat'), ($1, 'tg-offer', 'No', 'telegram')`,
      [t.orgId],
    );
    const res = await api.http().get('/v2/wechat/broadcasts/compose').set(bearer(t.admin));
    expect(res.status).toBe(200);
    expect(res.body.channels).toEqual([
      { id: a.uuid, accountName: expect.any(String), appId: a.appId, active: true },
    ]);
    expect(res.body.templates.map((x: { name: string }) => x.name)).toEqual(['wx-offer']);
    expect(res.body.templates[0].body).toBe('Offer text');
  });
});

describe('WECH create: a draft with a frozen audience', () => {
  it('a picked-users broadcast freezes its recipients, drops forged and repeated OpenIDs, and keeps the text encrypted', async () => {
    const t = await api.signup('wb3');
    const a = await accountWithFollowers(t, 3);
    const res = await create(t, a, {
      openids: ['oFollower0', 'oFollower1', 'oNotOurs', 'oFollower0', 'ofollower2'],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      status: 'draft',
      audience: 'list',
      total: 2,
      sent: 0,
      failed: 0,
      massMsgId: null,
      tagId: null,
      lastError: null,
      canRetry: false,
      channelId: a.uuid,
    });
    expect((await recipients(res.body.id)).map((r) => r.openid)).toEqual([
      'oFollower0',
      'oFollower1',
    ]);
    const row = await rowOf(res.body.id);
    expect(row.body).toMatch(/^v1:/);
    expect(JSON.stringify(res.body)).not.toContain('Big sale');
    expect(await api.auditCount(t.orgId, 'wechat_broadcasts', 'insert')).toBe(1);
    expect((await api.events(t.orgId, 'wechat.broadcast.created'))[0]).toMatchObject({
      audience: 'list',
      total: 2,
    });
  });

  it('a picked-users broadcast needs at least two followers that belong to the channel', async () => {
    const t = await api.signup('wb4');
    const a = await accountWithFollowers(t, 2);
    for (const picked of [
      [],
      ['oFollower0'],
      ['oFollower0', 'oNotOurs'],
      ['oFollower0', 'oFollower0'],
    ]) {
      const res = await create(t, a, { openids: picked });
      expect(res.status, JSON.stringify(picked)).toBe(422);
      expect(code(res)).toBe('WECH_TOO_FEW_RECIPIENTS');
    }
    const none = await create(t, a, { openids: undefined });
    expect(code(none)).toBe('WECH_TOO_FEW_RECIPIENTS');
    expect(
      (
        await h.owner.query(`SELECT count(*)::int n FROM wechat_broadcasts WHERE org_id = $1`, [
          t.orgId,
        ])
      ).rows[0].n,
    ).toBe(0);
  });

  it('all followers and a tag need no list: no recipients, a total of 0', async () => {
    const t = await api.signup('wb5');
    const a = await accountWithFollowers(t, 0);
    const all = await create(t, a, { audience: 'all', openids: undefined });
    expect(all.status, JSON.stringify(all.body)).toBe(201);
    expect(all.body).toMatchObject({ audience: 'all', total: 0, tagId: null });
    expect(await recipients(all.body.id)).toHaveLength(0);
    const tag = await create(t, a, { audience: 'tag', tagId: '107', openids: ['oIgnored'] });
    expect(tag.body).toMatchObject({ audience: 'tag', tagId: '107', total: 0 });
    expect(await recipients(tag.body.id)).toHaveLength(0);
  });

  it('validates the form: a name, text up to 2000 characters, a numeric tag, a known audience', async () => {
    const t = await api.signup('wb6');
    const a = await accountWithFollowers(t, 2);
    for (const bad of [
      { name: '' },
      { name: 'x'.repeat(192) },
      { body: '' },
      { body: '   ' },
      { body: 'x'.repeat(2001) },
      { audience: 'everyone' },
      { audience: 'tag' },
      { audience: 'tag', tagId: 'abc' },
      { audience: 'tag', tagId: '1'.repeat(11) },
      { channelId: 'not-a-uuid' },
    ]) {
      const res = await create(t, a, bad);
      expect(res.status, JSON.stringify(bad)).toBe(422);
      expect(code(res)).toBe('VALIDATION_FAILED');
    }
    // The limits themselves are fine; tag 0 is WeChat's "untagged" group.
    expect((await create(t, a, { body: 'x'.repeat(2000), name: 'n'.repeat(191) })).status).toBe(
      201,
    );
    expect((await create(t, a, { audience: 'tag', tagId: '0' })).status).toBe(201);
  });

  it("another workspace's channel or template is not found; a WeChat template is linked", async () => {
    const t = await api.signup('wb7');
    const u = await api.signup('wb7b');
    const a = await accountWithFollowers(t, 2);
    const foreign = await accountWithFollowers(u, 2);
    expect((await create(t, foreign)).status).toBe(404);
    const tpl = (
      await h.owner.query(
        `INSERT INTO wa_templates (org_id, template_name, template_body, channel) VALUES ($1, 'wx', 'Hi', 'wechat') RETURNING id, uuid`,
        [t.orgId],
      )
    ).rows[0];
    const foreignTpl = (
      await h.owner.query(
        `INSERT INTO wa_templates (org_id, template_name, template_body, channel) VALUES ($1, 'wx', 'Hi', 'wechat') RETURNING uuid`,
        [u.orgId],
      )
    ).rows[0];
    expect((await create(t, a, { templateId: foreignTpl.uuid })).status).toBe(404);
    const made = await create(t, a, { templateId: tpl.uuid });
    expect(made.status).toBe(201);
    expect(Number((await rowOf(made.body.id)).template_id)).toBe(Number(tpl.id));
  });
});

describe('WECH send: ONE mass-send call, made by a worker job', () => {
  it('Send queues the job and marks it sending; the job calls WeChat once for all followers and ends done with its msg_id', async () => {
    const t = await api.signup('wb8');
    const a = await accountWithFollowers(t, 0);
    const made = await create(t, a, { audience: 'all', openids: undefined });
    const started = await post(api, t, `/v2/wechat/broadcasts/${made.body.id}/start`);
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body).toMatchObject({ status: 'sending', canRetry: false });
    expect(started.body.startedAt).not.toBeNull();
    expect(mass()).toHaveLength(0);
    expect(await queued()).toContainEqual(expect.stringContaining(made.body.id));
    expect((await api.events(t.orgId, 'wechat.broadcast.started'))[0]).toMatchObject({
      audience: 'all',
    });

    expect(await sender.run(t.orgId, await idOf(made.body.id))).toBe('done');
    expect(mass()).toHaveLength(1);
    const call = mass()[0]!;
    expect(call.method).toBe('massSendAll');
    const [token, filter, message, clientMsgId] = call.args as [string, object, object, string];
    expect(token).toMatch(/^access-/);
    expect(filter).toEqual({ is_to_all: true });
    expect(message).toEqual({ msgtype: 'text', text: { content: 'Big sale this weekend 你好' } });
    // WeChat's own de-duplication key: the same broadcast sent twice is one mass send.
    expect(clientMsgId).toBe(made.body.id);

    const row = await rowOf(made.body.id);
    expect(row).toMatchObject({
      status: 'done',
      mass_msg_id: '4002',
      total: 0,
      sent: 0,
      failed: 0,
      last_error: null,
    });
    expect(row.finished_at).not.toBeNull();

    // A finished broadcast cannot be sent again, by the job or by the button.
    expect(await sender.run(t.orgId, await idOf(made.body.id))).toBe('skipped');
    expect(mass()).toHaveLength(1);
    const again = await post(api, t, `/v2/wechat/broadcasts/${made.body.id}/start`);
    expect(again.status).toBe(409);
    expect(code(again)).toBe('WECH_ALREADY_SENT');
    const retry = await post(api, t, `/v2/wechat/broadcasts/${made.body.id}/retry`);
    expect(retry.status).toBe(409);
    expect(code(retry)).toBe('WECH_ALREADY_SENT');
  });

  it('a tag audience sends to that tag', async () => {
    const t = await api.signup('wb9');
    const a = await accountWithFollowers(t, 0);
    const made = await create(t, a, { audience: 'tag', tagId: '107', openids: undefined });
    await post(api, t, `/v2/wechat/broadcasts/${made.body.id}/start`);
    await sender.run(t.orgId, await idOf(made.body.id));
    expect(mass()[0]!.method).toBe('massSendAll');
    expect(mass()[0]!.args[1]).toEqual({ is_to_all: false, tag_id: 107 });
  });

  it('a picked-users broadcast goes to its OpenIDs in one call, marks every recipient sent and copies the text into each thread', async () => {
    const t = await api.signup('wb10');
    const a = await accountWithFollowers(t, 4);
    const made = await create(t, a, { openids: ['oFollower3', 'oFollower1', 'oFollower0'] });
    await post(api, t, `/v2/wechat/broadcasts/${made.body.id}/start`);
    const unreadBefore = (
      await h.owner.query(`SELECT sum(unread_count)::int n FROM conversations WHERE org_id = $1`, [
        t.orgId,
      ])
    ).rows[0].n;

    expect(await sender.run(t.orgId, await idOf(made.body.id))).toBe('done');
    expect(mass()).toHaveLength(1);
    expect(mass()[0]!.method).toBe('massSend');
    expect(mass()[0]!.args[1]).toEqual(['oFollower3', 'oFollower1', 'oFollower0']);
    expect(mass()[0]!.args[3]).toBe(made.body.id);

    const row = await rowOf(made.body.id);
    expect(row).toMatchObject({
      status: 'done',
      mass_msg_id: '4001',
      total: 3,
      sent: 3,
      failed: 0,
    });
    expect((await recipients(made.body.id)).map((r) => r.status)).toEqual(['sent', 'sent', 'sent']);

    const out = await h.owner.query(
      `SELECT body, status FROM messages WHERE org_id = $1 AND direction = 'out' AND meta ->> 'source' = 'broadcast'`,
      [t.orgId],
    );
    expect(out.rows).toHaveLength(3);
    expect(out.rows[0].body).toBe('Big sale this weekend 你好');
    // A broadcast copy never raises the unread count of a thread.
    expect(
      (
        await h.owner.query(
          `SELECT sum(unread_count)::int n FROM conversations WHERE org_id = $1`,
          [t.orgId],
        )
      ).rows[0].n,
    ).toBe(unreadBefore);
  });

  it('starting twice queues one job (the second press returns the sending broadcast)', async () => {
    const t = await api.signup('wb11');
    const a = await accountWithFollowers(t, 0);
    const made = await create(t, a, { audience: 'all', openids: undefined });
    const first = await post(api, t, `/v2/wechat/broadcasts/${made.body.id}/start`);
    const second = await post(api, t, `/v2/wechat/broadcasts/${made.body.id}/start`);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('sending');
    expect(first.body.id).toBe(second.body.id);
    expect((await queued()).filter((id) => String(id).startsWith(made.body.id))).toHaveLength(1);
    expect((await api.events(t.orgId, 'wechat.broadcast.started')).length).toBe(1);
  });

  it('a paused or missing channel cannot send: the broadcast stays a draft and says why', async () => {
    const t = await api.signup('wb12');
    const a = await accountWithFollowers(t, 0);
    const made = await create(t, a, { audience: 'all', openids: undefined });
    await h.owner.query(`UPDATE wechat_channels SET active = false WHERE id = $1`, [a.rowId]);
    const res = await post(api, t, `/v2/wechat/broadcasts/${made.body.id}/start`);
    expect(res.status).toBe(422);
    expect(code(res)).toBe('WECH_CHANNEL_UNAVAILABLE');
    expect((await rowOf(made.body.id)).status).toBe('draft');
    expect(mass()).toHaveLength(0);
  });

  it('a channel paused after Send but before the job ran fails the broadcast without calling WeChat', async () => {
    const t = await api.signup('wb13');
    const a = await accountWithFollowers(t, 0);
    const made = await create(t, a, { audience: 'all', openids: undefined });
    await post(api, t, `/v2/wechat/broadcasts/${made.body.id}/start`);
    await h.owner.query(`UPDATE wechat_channels SET active = false WHERE id = $1`, [a.rowId]);
    expect(await sender.run(t.orgId, await idOf(made.body.id))).toBe('failed');
    expect(mass()).toHaveLength(0);
    expect(await rowOf(made.body.id)).toMatchObject({
      status: 'failed',
      last_error: 'The WeChat channel for this broadcast is not connected/active.',
    });
  });

  it('two jobs for one broadcast at the same time make ONE mass-send call', async () => {
    const t = await api.signup('wb14b');
    const a = await accountWithFollowers(t, 0);
    const made = await create(t, a, { audience: 'all', openids: undefined });
    await post(api, t, `/v2/wechat/broadcasts/${made.body.id}/start`);
    wechat.answers.massSendAll = async () => {
      await new Promise((r) => setTimeout(r, 200));
      return { ok: true, data: { msg_id: 7001 }, errcode: null, error: null };
    };
    const id = await idOf(made.body.id);
    const results = await Promise.all([sender.run(t.orgId, id), sender.run(t.orgId, id)]);
    expect(results.sort()).toEqual(['done', 'skipped']);
    expect(mass()).toHaveLength(1);
    expect((await rowOf(made.body.id)).mass_msg_id).toBe('7001');
  });

  it('the queue job runs the same code: the worker processor sends and returns the result', async () => {
    const t = await api.signup('wb14');
    const a = await accountWithFollowers(t, 0);
    const made = await create(t, a, { audience: 'all', openids: undefined });
    await post(api, t, `/v2/wechat/broadcasts/${made.body.id}/start`);
    const processor = new BroadcastProcessor(sender);
    const job = { data: { orgId: t.orgId, broadcastId: await idOf(made.body.id) } } as Job;
    expect(await processor.process(job as never)).toBe('done');
    expect((await rowOf(made.body.id)).status).toBe('done');
  });
});

describe('WECH failure and retry', () => {
  it('WeChat refusing the mass send ends the broadcast failed with its reason, leaves the recipients pending, and Retry sends it again', async () => {
    const t = await api.signup('wb15');
    const a = await accountWithFollowers(t, 3);
    const made = await create(t, a);
    wechat.answers.massSend = () => Promise.resolve(refused(45028, 'has no masssend quota'));
    await post(api, t, `/v2/wechat/broadcasts/${made.body.id}/start`);
    expect(await sender.run(t.orgId, await idOf(made.body.id))).toBe('failed');

    const row = await rowOf(made.body.id);
    expect(row).toMatchObject({ status: 'failed', mass_msg_id: null, sent: 0 });
    expect(row.last_error).toBe('45028 has no masssend quota');
    expect((await recipients(made.body.id)).map((r) => r.status)).toEqual([
      'pending',
      'pending',
      'pending',
    ]);
    const out = await h.owner.query(
      `SELECT count(*)::int n FROM messages WHERE org_id = $1 AND meta ->> 'source' = 'broadcast'`,
      [t.orgId],
    );
    expect(out.rows[0].n).toBe(0);

    const listed = await api.http().get('/v2/wechat/broadcasts').set(bearer(t.admin));
    expect(listed.body.data[0]).toMatchObject({ status: 'failed', canRetry: true });
    expect(listed.body.data[0].lastError).toBe('45028 has no masssend quota');

    wechat.answers.massSend = () =>
      Promise.resolve({ ok: true, data: { msg_id: 9001 }, errcode: null, error: null });
    const retry = await post(api, t, `/v2/wechat/broadcasts/${made.body.id}/retry`);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ status: 'sending', lastError: null });
    expect((await api.events(t.orgId, 'wechat.broadcast.retry_requested')).length).toBe(1);
    expect(await sender.run(t.orgId, await idOf(made.body.id))).toBe('done');
    expect(await rowOf(made.body.id)).toMatchObject({
      status: 'done',
      mass_msg_id: '9001',
      sent: 3,
      last_error: null,
    });
    expect((await recipients(made.body.id)).map((r) => r.status)).toEqual(['sent', 'sent', 'sent']);
  });

  it("Send on a failed broadcast works as Reference's Send button did (a second try)", async () => {
    const t = await api.signup('wb16');
    const a = await accountWithFollowers(t, 0);
    const made = await create(t, a, { audience: 'all', openids: undefined });
    wechat.answers.massSendAll = () => Promise.resolve(refused(-1, 'system busy'));
    await post(api, t, `/v2/wechat/broadcasts/${made.body.id}/start`);
    await sender.run(t.orgId, await idOf(made.body.id));
    const again = await post(api, t, `/v2/wechat/broadcasts/${made.body.id}/start`);
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('sending');
  });

  it('a transport failure (WeChat unreachable) is a failed broadcast, not a crash', async () => {
    const t = await api.signup('wb17');
    const a = await accountWithFollowers(t, 0);
    const made = await create(t, a, { audience: 'all', openids: undefined });
    wechat.answers.massSendAll = () =>
      Promise.resolve({ ok: false, data: {}, errcode: null, error: 'fetch failed' });
    await post(api, t, `/v2/wechat/broadcasts/${made.body.id}/start`);
    expect(await sender.run(t.orgId, await idOf(made.body.id))).toBe('failed');
    expect((await rowOf(made.body.id)).last_error).toBe('fetch failed');
  });

  it('a duplicate client message id means an earlier call of the same broadcast was accepted: it ends done, not failed', async () => {
    const t = await api.signup('wb18');
    const a = await accountWithFollowers(t, 0);
    const made = await create(t, a, { audience: 'all', openids: undefined });
    wechat.answers.massSendAll = () => Promise.resolve(refused(45065, 'clientmsgid exist'));
    await post(api, t, `/v2/wechat/broadcasts/${made.body.id}/start`);
    expect(await sender.run(t.orgId, await idOf(made.body.id))).toBe('done');
    expect(await rowOf(made.body.id)).toMatchObject({
      status: 'done',
      mass_msg_id: null,
      last_error: null,
    });
  });

  it('Retry is for a failed broadcast: a draft, a fresh sending one and a missing one are refused', async () => {
    const t = await api.signup('wb19');
    const a = await accountWithFollowers(t, 0);
    const made = await create(t, a, { audience: 'all', openids: undefined });
    const draft = await post(api, t, `/v2/wechat/broadcasts/${made.body.id}/retry`);
    expect(draft.status).toBe(409);
    expect(code(draft)).toBe('WECH_NOT_RETRYABLE');
    await post(api, t, `/v2/wechat/broadcasts/${made.body.id}/start`);
    const sending = await post(api, t, `/v2/wechat/broadcasts/${made.body.id}/retry`);
    expect(sending.status).toBe(409);
    expect(code(sending)).toBe('WECH_NOT_RETRYABLE');
    expect((await post(api, t, `/v2/wechat/broadcasts/${randomUUID()}/retry`)).status).toBe(404);
  });

  it('a broadcast stuck in sending (its worker died) can be retried after 15 minutes; the job uses the same clientmsgid', async () => {
    const t = await api.signup('wb20');
    const a = await accountWithFollowers(t, 0);
    const made = await create(t, a, { audience: 'all', openids: undefined });
    await post(api, t, `/v2/wechat/broadcasts/${made.body.id}/start`);
    await h.owner.query(
      `ALTER TABLE wechat_broadcasts DISABLE TRIGGER trg_wechat_broadcasts_touch`,
    );
    await h.owner.query(
      `UPDATE wechat_broadcasts SET updated_at = now() - interval '20 minutes' WHERE uuid = $1`,
      [made.body.id],
    );
    await h.owner.query(`ALTER TABLE wechat_broadcasts ENABLE TRIGGER trg_wechat_broadcasts_touch`);
    const listed = await api.http().get('/v2/wechat/broadcasts').set(bearer(t.admin));
    expect(listed.body.data[0]).toMatchObject({ status: 'sending', canRetry: true });
    const retry = await post(api, t, `/v2/wechat/broadcasts/${made.body.id}/retry`);
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    await sender.run(t.orgId, await idOf(made.body.id));
    expect(mass()[0]!.args[3]).toBe(made.body.id);
  });
});

describe('WECH list, delete and access control', () => {
  it('lists the 50 newest first with their audience, status and channel name; another workspace sees none of it', async () => {
    const t = await api.signup('wb21');
    const u = await api.signup('wb21b');
    const a = await accountWithFollowers(t, 2);
    const first = await create(t, a, { name: 'First' });
    const second = await create(t, a, { name: 'Second', audience: 'all', openids: undefined });
    const res = await api.http().get('/v2/wechat/broadcasts').set(bearer(t.admin));
    expect(res.body.data.map((b: { name: string }) => b.name)).toEqual(['Second', 'First']);
    expect(res.body.data[1]).toMatchObject({ id: first.body.id, audience: 'list', total: 2 });
    expect(res.body.data[0].channelName).toBeTruthy();
    expect(second.status).toBe(201);
    expect((await api.http().get('/v2/wechat/broadcasts').set(bearer(u.admin))).body.data).toEqual(
      [],
    );
    const many = Array.from({ length: 52 }, (_, i) => i);
    await h.owner.query(
      `INSERT INTO wechat_broadcasts (org_id, wechat_channel_id, name, body, audience, status)
       SELECT $1, $2, 'bulk ' || g, 'x', 'all', 'draft' FROM generate_series(1, ${many.length}) g`,
      [t.orgId, a.rowId],
    );
    expect(
      (await api.http().get('/v2/wechat/broadcasts').set(bearer(t.admin))).body.data,
    ).toHaveLength(50);
  });

  it('deleting removes the broadcast and its recipients in any status, audited; a foreign one is not found', async () => {
    const t = await api.signup('wb22');
    const u = await api.signup('wb22b');
    const a = await accountWithFollowers(t, 2);
    const made = await create(t, a);
    await post(api, t, `/v2/wechat/broadcasts/${made.body.id}/start`);
    const rowId = await idOf(made.body.id);
    const del = (tenant: Tenant) =>
      api
        .http()
        .delete(`/v2/wechat/broadcasts/${made.body.id}`)
        .set(bearer(tenant.admin))
        .set('idempotency-key', randomUUID());
    expect((await del(u)).status).toBe(404);
    expect((await del(t)).status).toBe(204);
    expect(await rowOf(made.body.id)).toBeUndefined();
    expect(await recipients(made.body.id)).toHaveLength(0);
    expect(await api.auditCount(t.orgId, 'wechat_broadcasts', 'delete')).toBe(1);
    expect((await api.events(t.orgId, 'wechat.broadcast.deleted'))[0]).toMatchObject({
      status: 'sending',
    });
    // The job that was already queued finds nothing and does nothing.
    expect(await sender.run(t.orgId, rowId)).toBe('skipped');
    expect((await del(t)).status).toBe(404);
  });

  it('deleting the channel removes its broadcasts', async () => {
    const t = await api.signup('wb23');
    const a = await accountWithFollowers(t, 2);
    const made = await create(t, a);
    await api
      .http()
      .delete(`/v2/wechat/channels/${a.uuid}`)
      .set(bearer(t.admin))
      .set('idempotency-key', randomUUID());
    expect(await rowOf(made.body.id)).toBeUndefined();
  });

  it('reading needs the read key, writing the manage key', async () => {
    const t = await api.signup('wb24');
    const a = await accountWithFollowers(t, 2);
    const made = await create(t, a);
    const reader = await api.member(t, 'bcast-reader', [['wechat.broadcasts.read']]);
    const get = (path: string) => api.http().get(path).set(bearer(reader.token));
    expect((await get('/v2/wechat/broadcasts')).status).toBe(200);
    expect((await get('/v2/wechat/broadcasts/compose')).status).toBe(200);
    expect((await get(`/v2/wechat/channels/${a.uuid}/chats`)).status).toBe(200);
    const write = (method: 'post' | 'delete', path: string, body: object = {}) =>
      api
        .http()
        [method](path)
        .set(bearer(reader.token))
        .set('idempotency-key', randomUUID())
        .send(body);
    expect((await write('post', '/v2/wechat/broadcasts', { name: 'x' })).status).toBe(403);
    expect((await write('post', `/v2/wechat/broadcasts/${made.body.id}/start`)).status).toBe(403);
    expect((await write('post', `/v2/wechat/broadcasts/${made.body.id}/retry`)).status).toBe(403);
    expect((await write('delete', `/v2/wechat/broadcasts/${made.body.id}`)).status).toBe(403);
    const nobody = await api.member(t, 'bcast-nobody', []);
    expect((await api.http().get('/v2/wechat/broadcasts').set(bearer(nobody.token))).status).toBe(
      403,
    );
  });
});

describe('BL-141: a WeChat broadcast asks the ConsentGate before the one mass-send call', () => {
  const kit = () => new ConsentKit(h, api);
  const contactOf = (t: Tenant, n: number) => kit().contact(t, 'wechat', `oFollower${n}`);
  const byOpenid = (rows: Awaited<ReturnType<typeof recipients>>) =>
    Object.fromEntries(rows.map((r) => [r.openid, r]));
  const errorsOf = async (uuid: string) =>
    Object.fromEntries(
      (
        await h.owner.query(
          `SELECT r.openid, r.error FROM wechat_broadcast_recipients r
             JOIN wechat_broadcasts b ON b.org_id = r.org_id AND b.id = r.wechat_broadcast_id WHERE b.uuid = $1`,
          [uuid],
        )
      ).rows.map((r: { openid: string; error: string | null }) => [r.openid, r.error]),
    );
  const start = (t: Tenant, uuid: string) => post(api, t, `/v2/wechat/broadcasts/${uuid}/start`);
  const sentOpenids = () => (mass()[0]?.args[1] ?? []) as string[];

  it('a picked list leaves out whoever the gate refuses and sends the rest in the one call', async () => {
    const t = await api.signup('wcg1');
    const a = await accountWithFollowers(t, 4);
    await kit().unsubscribe(t, (await contactOf(t, 0)).id);
    await kit().record(t, (await contactOf(t, 1)).uuid, 'wechat', 'withdrawn');
    await kit().record(t, (await contactOf(t, 2)).uuid, 'wechat', 'granted');
    const made = await create(t, a, { openids: openids(4) });
    await start(t, made.body.id);

    expect(await sender.run(t.orgId, await idOf(made.body.id))).toBe('done');

    expect(mass()).toHaveLength(1);
    expect(sentOpenids()).toEqual(['oFollower2', 'oFollower3']);
    const rows = byOpenid(await recipients(made.body.id));
    expect(rows['oFollower0']!.status).toBe('blocked');
    expect(rows['oFollower1']!.status).toBe('blocked');
    expect(rows['oFollower2']!.status).toBe('sent');
    expect(rows['oFollower3']!.status).toBe('sent');
    const errors = await errorsOf(made.body.id);
    expect(errors['oFollower0']).toBe(refusedWith('withdrawn'));
    expect(errors['oFollower1']).toBe(refusedWith('withdrawn'));
    expect(errors['oFollower2']).toBeNull();
    // The audience stays what was picked (4); the sent count is who was reached.
    expect(await rowOf(made.body.id)).toMatchObject({ status: 'done', total: 4, sent: 2 });
  });

  it('with the workspace switch on a picked list needs a recorded grant for each person', async () => {
    const t = await api.signup('wcg2');
    const a = await accountWithFollowers(t, 4);
    await kit().record(t, (await contactOf(t, 0)).uuid, 'wechat', 'granted');
    await kit().record(t, (await contactOf(t, 1)).uuid, 'wechat', 'granted');
    await kit().setSwitch(t, true);
    const made = await create(t, a, { openids: openids(4) });
    await start(t, made.body.id);
    expect(await sender.run(t.orgId, await idOf(made.body.id))).toBe('done');
    expect(sentOpenids()).toEqual(['oFollower0', 'oFollower1']);
    const errors = await errorsOf(made.body.id);
    expect(errors['oFollower2']).toBe(refusedWith('no_consent_recorded'));
    expect(errors['oFollower3']).toBe(refusedWith('no_consent_recorded'));
  });

  it('with the switch off (the default) a picked list with no grant at all is sent', async () => {
    const t = await api.signup('wcg3');
    const a = await accountWithFollowers(t, 3);
    const made = await create(t, a);
    await start(t, made.body.id);
    expect(await sender.run(t.orgId, await idOf(made.body.id))).toBe('done');
    expect(sentOpenids()).toEqual(openids(3));
  });

  it('a list that is too small after the check makes no call: it fails with the reasons and can be retried once consent changes', async () => {
    const t = await api.signup('wcg4');
    const a = await accountWithFollowers(t, 3);
    await kit().unsubscribe(t, (await contactOf(t, 0)).id);
    await kit().unsubscribe(t, (await contactOf(t, 1)).id);
    const made = await create(t, a);
    await start(t, made.body.id);

    expect(await sender.run(t.orgId, await idOf(made.body.id))).toBe('failed');
    expect(mass()).toHaveLength(0);
    const row = await rowOf(made.body.id);
    expect(row.status).toBe('failed');
    expect(row.last_error).toMatch(/only 1 of 3.*consent: withdrawn 2.*needs 2/);

    // The people agree again (the STOP is lifted): the retry asks the gate again and the broadcast goes.
    await h.owner.query(`UPDATE contacts SET is_unsubscribed = false WHERE org_id = $1`, [t.orgId]);
    const retried = await post(api, t, `/v2/wechat/broadcasts/${made.body.id}/retry`);
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    expect(await sender.run(t.orgId, await idOf(made.body.id))).toBe('done');
    expect(sentOpenids()).toEqual(openids(3));
  });

  it('a send to all followers cannot leave a person out: it is refused while the account knows one the gate refuses', async () => {
    const t = await api.signup('wcg5');
    const a = await accountWithFollowers(t, 3);
    await kit().unsubscribe(t, (await contactOf(t, 0)).id);
    const made = await create(t, a, { audience: 'all', openids: undefined });
    await start(t, made.body.id);

    expect(await sender.run(t.orgId, await idOf(made.body.id))).toBe('failed');
    expect(mass()).toHaveLength(0);
    expect((await rowOf(made.body.id)).last_error).toMatch(
      /1 of 3 known followers cannot be messaged \(consent: withdrawn 1\).*all followers.*picked list/,
    );
  });

  it('a send to a tag is checked the same way, and goes when nobody the account knows is refused', async () => {
    const t = await api.signup('wcg6');
    const a = await accountWithFollowers(t, 2);
    const made = await create(t, a, { audience: 'tag', tagId: '101', openids: undefined });
    await start(t, made.body.id);
    expect(await sender.run(t.orgId, await idOf(made.body.id))).toBe('done');
    expect(mass()).toHaveLength(1);
    expect(mass()[0]!.method).toBe('massSendAll');

    // Another workspace whose account knows a follower flagged as a minor (the workspace's children rule is read once a minute per
    // process, so a rule written straight into the table is only seen by a workspace that has not asked yet).
    wechat.reset();
    const u = await api.signup('wcg6b');
    const b = await accountWithFollowers(u, 2);
    await kit().minor(u, (await contactOf(u, 1)).id);
    const second = await create(u, b, { audience: 'tag', tagId: '101', openids: undefined });
    await start(u, second.body.id);
    expect(await sender.run(u.orgId, await idOf(second.body.id))).toBe('failed');
    expect(mass()).toHaveLength(0);
    expect((await rowOf(second.body.id)).last_error).toMatch(/subject_minor 1/);
  });

  it('with the switch on a send to all followers or a tag is refused outright: nobody unknown can have a grant', async () => {
    const t = await api.signup('wcg7');
    const a = await accountWithFollowers(t, 2);
    await kit().setSwitch(t, true);
    for (const over of [
      { audience: 'all', openids: undefined },
      { audience: 'tag', tagId: '7', openids: undefined },
    ]) {
      const made = await create(t, a, over);
      await start(t, made.body.id);
      expect(await sender.run(t.orgId, await idOf(made.body.id))).toBe('failed');
      expect((await rowOf(made.body.id)).last_error).toMatch(
        /consent \(no_consent_recorded\).*picked list/,
      );
    }
    expect(mass()).toHaveLength(0);
  });

  it('a person flagged as a minor is left out of a list when the workspace says no minors', async () => {
    const t = await api.signup('wcg8');
    const a = await accountWithFollowers(t, 3);
    await kit().minor(t, (await contactOf(t, 0)).id);
    const made = await create(t, a);
    await start(t, made.body.id);
    await sender.run(t.orgId, await idOf(made.body.id));
    expect(sentOpenids()).toEqual(['oFollower1', 'oFollower2']);
    expect((await errorsOf(made.body.id))['oFollower0']).toBe(refusedWith('subject_minor'));
  });

  it('a service message is never blocked: STOP, the switch and a minor flag do not stop a reply or a utility notice', async () => {
    const t = await api.signup('wcg9');
    await accountWithFollowers(t, 1);
    const person = await contactOf(t, 0);
    await kit().unsubscribe(t, person.id);
    await kit().minor(t, person.id);
    await kit().setSwitch(t, true);
    const gate = h.app.get(ConsentGate);
    const subject = { type: 'contact', id: person.id } as const;
    expect((await gate.check(t.orgId, subject, 'wechat', 'marketing_messaging')).decision).toBe(
      'deny',
    );
    expect(
      await gate.check(t.orgId, subject, 'wechat', 'service_messaging', undefined, {
        replyWindowOpen: true,
      }),
    ).toEqual({ decision: 'allow', reason: 'inbound_reply_window' });
    expect(await gate.check(t.orgId, subject, 'wechat', 'service_messaging')).toEqual({
      decision: 'allow',
      reason: 'utility_exempt',
    });
  });

  it('held for the quiet hours, then released: the gate is asked again and a person who unsubscribed while it waited is left out', async () => {
    const window = h.app.get(SendWindowService);
    const realNow = window.now;
    window.now = () => new Date('2030-10-15T22:00:00Z');
    try {
      const t = await api.signup('wcg10');
      const a = await accountWithFollowers(t, 3);
      await h.owner.query(
        `INSERT INTO compliance_settings (org_id, quiet_hours_enabled, quiet_start, quiet_end, window_timezone) VALUES ($1, true, '21:00', '09:00', 'UTC')`,
        [t.orgId],
      );
      const made = await create(t, a);
      await start(t, made.body.id);
      const id = await idOf(made.body.id);
      expect(await sender.run(t.orgId, id)).toBe('held');
      expect(mass()).toHaveLength(0);

      await kit().unsubscribe(t, (await contactOf(t, 0)).id);
      window.now = () => new Date('2030-10-16T09:05:00Z');
      expect(await sender.run(t.orgId, id)).toBe('done');
      expect(sentOpenids()).toEqual(['oFollower1', 'oFollower2']);
      expect((await errorsOf(made.body.id))['oFollower0']).toBe(refusedWith('withdrawn'));
    } finally {
      window.now = realNow;
    }
  });
});
