import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { QUEUES } from '../../../src/infra/queue/queues';
import {
  BroadcastsService,
  IG_HELD_JOB,
  type IgHeldJob,
} from '../../../src/modules/channel-instagram/broadcasts.service';
import { SendWindowService } from '../../../src/modules/compliance-center';
import {
  INSTAGRAM_BRIDGE,
  type BridgeReply,
  type BridgeResult,
  type InstagramBridgeFactory,
} from '../../../src/infra/providers/channel-instagram/instagram-bridge.port';
import { PlatformSettingsService } from '../../../src/modules/auth';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/** The reply-only send and the data behind its pickers (TW-IG-013, 014), against a real Postgres and a fake engine. */
let h: Harness;
let api: Api;
let settings: PlatformSettingsService;

const SECRET = 's3cret';
const sent: Array<{ thread: string; reply: BridgeReply }> = [];
let answer: (thread: string) => BridgeResult<{ messageId: string | null }> = (thread) => ({
  ok: true,
  data: { messageId: `mid-${thread}` },
});

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  settings = h.app.get(PlatformSettingsService);
  const bridge = h.app.get<InstagramBridgeFactory>(INSTAGRAM_BRIDGE);
  bridge.with = () => ({
    accounts: (q) =>
      Promise.resolve(
        q.workspace !== undefined
          ? [
              { id: 'a1', username: 'shop', name: 'Shop', avatar: '', connected: true },
              { id: 'a12', username: '@shop12', name: 'Shop 12', avatar: '', connected: true },
            ]
          : [],
      ),
    conversations: () => Promise.resolve([]),
    messages: () => Promise.resolve([]),
    reply: (thread, reply) => {
      sent.push({ thread, reply });
      return Promise.resolve(answer(thread));
    },
    flows: () => Promise.resolve([]),
    runFlow: () => Promise.resolve({ ok: true, data: null }),
    connectStart: () => Promise.resolve({ ok: true, data: { url: 'https://engine.test/x' } }),
  });
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

async function engine(on: boolean): Promise<void> {
  await settings.mergeMember(
    'addons.engines',
    'instagram',
    { url: on ? 'https://engine.test' : '', brand: 'IgDesk', connected: on },
    null,
  );
  if (on) await settings.setSecret('addons.engine.instagram.secret', SECRET, null);
  else await settings.clearSecret('addons.engine.instagram.secret');
}

beforeEach(async () => {
  sent.length = 0;
  answer = (thread) => ({ ok: true, data: { messageId: `mid-${thread}` } });
  await engine(true);
});

const link = (t: Tenant, id: string) =>
  api.http().post('/v2/instagram/accounts').set(bearer(t.admin)).send({ instaflowAccountId: id });

async function thread(
  t: Tenant,
  key: string,
  title: string,
  opts: { channel?: string; inboundHoursAgo?: number | null } = {},
): Promise<string> {
  const ago = opts.inboundHoursAgo === undefined ? 1 : opts.inboundHoursAgo;
  // An Instagram thread lives on its account's channel (the account id is the first part of the key); a WhatsApp one on a number's.
  const instagram = (opts.channel ?? 'instagram') === 'instagram';
  const account = key.slice(3).split(/[_:]/)[0]!;
  const ch = instagram
    ? await h.owner.query(
        `INSERT INTO channels (org_id, kind, name, status, external_id) VALUES ($1, 'instagram', $2, 'connected', $2)
         ON CONFLICT (org_id, kind, external_id) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [t.orgId, account],
      )
    : await h.owner.query(
        `INSERT INTO channels (org_id, kind, name, status) VALUES ($1, 'whatsapp_cloud', 'WA', 'connected') RETURNING id`,
        [t.orgId],
      );
  const c = await h.owner.query(
    `INSERT INTO conversations (org_id, channel_id, peer_key, title, last_message_at, last_inbound_at)
     VALUES ($1, $2, $3, $4, now(), CASE WHEN $5::numeric IS NULL THEN NULL ELSE now() - ($5::numeric * interval '1 hour') END)
     RETURNING uuid`,
    [t.orgId, ch.rows[0].id, key, title, ago],
  );
  return c.rows[0].uuid as string;
}

async function template(
  t: Tenant,
  name: string,
  body: string,
  buttons: unknown[],
): Promise<string> {
  const r = await h.owner.query(
    `INSERT INTO wa_templates (org_id, template_name, template_body, buttons, channel) VALUES ($1, $2, $3, $4::jsonb, 'instagram') RETURNING uuid`,
    [t.orgId, name, body, JSON.stringify(buttons)],
  );
  return r.rows[0].uuid as string;
}

const broadcast = (t: Tenant, body: Record<string, unknown>) =>
  api.http().post('/v2/instagram/broadcasts').set(bearer(t.admin)).send(body);
const composer = (t: Tenant, body: Record<string, unknown>) =>
  api.http().post('/v2/instagram/composer/send').set(bearer(t.admin)).send(body);

const outbound = async (t: Tenant) =>
  (
    await h.owner.query(
      `SELECT m.body, m.meta, m.sender_user_id, m.sender_kind, m.provider_message_id, m.conversation_id
       FROM messages m
       JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
       JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
       WHERE m.org_id = $1 AND ch.kind = 'instagram' AND m.direction = 'out' ORDER BY m.id`,
      [t.orgId],
    )
  ).rows;

describe('the pickers’ data (TW-IG-013)', () => {
  it('lists each connected account with its threads by newest customer message, the window state and the templates', async () => {
    const t = await api.signup('igba');
    await link(t, 'a1');
    await link(t, 'a12');
    const fresh = await thread(t, 'ig:a1_555', 'Asha', { inboundHoursAgo: 1 });
    const stale = await thread(t, 'ig:a1:777', 'Ravi', { inboundHoursAgo: 40 });
    await thread(t, 'ig:a12_900', 'Other shop', { inboundHoursAgo: 2 });
    await thread(t, 'ig:a1_999', '', { inboundHoursAgo: null });
    await thread(t, 'wa:1', 'WhatsApp', { channel: 'whatsapp' });
    const tpl = await template(t, 'Promo', 'Big sale', [{ text: 'Yes' }]);

    const res = await api.http().get('/v2/instagram/compose').set(bearer(t.admin));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.accounts.map((a: { handle: string }) => a.handle).sort()).toEqual([
      '@shop',
      '@shop12',
    ]);
    const a1 = res.body.threads.a1 as Array<{ id: string; title: string; windowOpen: boolean }>;
    // Account 1 does not claim account 12's thread.
    expect(a1.map((x) => x.title)).toEqual(['Asha', 'Ravi', 'Instagram user']);
    expect(a1[0]).toEqual({ id: fresh, title: 'Asha', windowOpen: true });
    expect(a1[1]).toEqual({ id: stale, title: 'Ravi', windowOpen: false });
    expect(res.body.threads.a12.map((x: { title: string }) => x.title)).toEqual(['Other shop']);
    expect(res.body.templates).toEqual([
      { id: tpl, name: 'Promo', body: 'Big sale', buttons: [{ text: 'Yes' }] },
    ]);
  });

  it('has no accounts while the engine is off, and never shows another organization’s threads', async () => {
    const a = await api.signup('igbb');
    const b = await api.signup('igbc');
    await link(a, 'a1');
    await thread(a, 'ig:a1_555', 'Mine');
    await link(b, 'a1');
    expect(
      (await api.http().get('/v2/instagram/compose').set(bearer(b.admin))).body.threads.a1,
    ).toEqual([]);
    await engine(false);
    const off = await api.http().get('/v2/instagram/compose').set(bearer(a.admin));
    expect(off.body.accounts).toEqual([]);
    expect(off.body.threads).toEqual({});
  });

  it('needs ig.broadcasts.manage', async () => {
    const t = await api.signup('igbd');
    const viewer = await api.member(t, 'viewer', [['ig.accounts.read']]);
    const res = await api.http().get('/v2/instagram/compose').set(bearer(viewer.token));
    expect(res.status).toBe(403);
  });
});

describe('the broadcasts page (TW-IG-014)', () => {
  it('sends to every picked thread with {name} replaced, mirrors each into its thread and says what went', async () => {
    const t = await api.signup('igbe');
    const asha = await thread(t, 'ig:a1_555', 'Asha');
    const nameless = await thread(t, 'ig:a1_556', '');
    const res = await broadcast(t, {
      name: 'Autumn',
      message: 'Hi {name}!',
      threadIds: [asha, nameless, asha],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ sent: 2, failed: 0, errors: [], held: 0, heldUntil: null });
    expect(sent.map((s) => [s.thread, s.reply.text]).sort()).toEqual([
      ['a1_555', 'Hi Asha!'],
      ['a1_556', 'Hi there!'],
    ]);
    const rows = await outbound(t);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.body).sort()).toEqual(['Hi Asha!', 'Hi there!']);
    // Sent by a person: the thread shows who, and the engine's id is the ledger key the pull dedupes on.
    expect(rows.every((r) => r.sender_user_id === t.adminUserId && r.sender_kind === 'agent')).toBe(
      true,
    );
    expect(rows.map((r) => r.provider_message_id).sort()).toEqual(['mid-a1_555', 'mid-a1_556']);
    const t1 = await h.owner.query(
      `SELECT preview, unread_count, last_outbound_at FROM conversations WHERE org_id = $1 AND uuid = $2`,
      [t.orgId, asha],
    );
    expect(t1.rows[0]).toMatchObject({ preview: 'Hi Asha!', unread_count: 0 });
    expect(t1.rows[0].last_outbound_at).not.toBeNull();
  });

  it('counts a refusal, a foreign thread and a non-Instagram thread as failed, and keeps the engine’s words', async () => {
    const t = await api.signup('igbf');
    const other = await api.signup('igbg');
    const ok = await thread(t, 'ig:a1_1', 'Ok');
    const refused = await thread(t, 'ig:a1_2', 'Refused');
    const wa = await thread(t, 'wa:1', 'WA', { channel: 'whatsapp' });
    const foreign = await thread(other, 'ig:a1_3', 'Foreign');
    answer = (thread) =>
      thread === 'a1_2'
        ? { ok: false, error: 'Outside the 24 hour window', status: 400 }
        : { ok: true, data: { messageId: null } };
    const res = await broadcast(t, {
      name: 'x',
      message: 'hello',
      threadIds: [ok, refused, wa, foreign],
    });
    expect(res.body).toEqual({
      sent: 1,
      failed: 3,
      errors: ['IgDesk HTTP 400: Outside the 24 hour window'],
      held: 0,
      heldUntil: null,
    });
    expect(sent.map((s) => s.thread).sort()).toEqual(['a1_1', 'a1_2']);
    // No engine id: the thread is stored, no message was sent for it.
    expect(await outbound(t)).toHaveLength(1);
    expect(await outbound(other)).toHaveLength(0);
  });

  it('is refused while the engine is off, and for a message that is empty, too long, or aimed at no one or too many', async () => {
    const t = await api.signup('igbh');
    const id = await thread(t, 'ig:a1_1', 'Ok');
    expect((await broadcast(t, { name: 'x', message: '', threadIds: [id] })).status).toBe(422);
    expect(
      (await broadcast(t, { name: 'x', message: 'y'.repeat(1001), threadIds: [id] })).status,
    ).toBe(422);
    expect((await broadcast(t, { name: '', message: 'hi', threadIds: [id] })).status).toBe(422);
    expect((await broadcast(t, { name: 'x', message: 'hi', threadIds: [] })).status).toBe(422);
    const many = Array.from({ length: 201 }, () => '00000000-0000-4000-8000-000000000000');
    expect((await broadcast(t, { name: 'x', message: 'hi', threadIds: many })).status).toBe(422);
    await engine(false);
    const off = await broadcast(t, { name: 'x', message: 'hi', threadIds: [id] });
    expect(off.status).toBe(422);
    expect(off.body.code).toBe('IG_NOT_CONNECTED');
    expect(sent).toHaveLength(0);
  });

  it('needs ig.broadcasts.manage', async () => {
    const t = await api.signup('igbi');
    const id = await thread(t, 'ig:a1_1', 'Ok');
    const viewer = await api.member(t, 'viewer', [['ig.accounts.read']]);
    const res = await api
      .http()
      .post('/v2/instagram/broadcasts')
      .set(bearer(viewer.token))
      .send({ name: 'x', message: 'hi', threadIds: [id] });
    expect(res.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it('a send that was mirrored is not shown a second time when the engine reports the same message', async () => {
    const t = await api.signup('igbj');
    const id = await thread(t, 'ig:a1_555', 'Asha');
    await broadcast(t, { name: 'x', message: 'hi', threadIds: [id] });
    await settings.setSecret('addons.engine.instagram.secret', SECRET, null);
    const pushed = await api
      .http()
      .post('/v2/instaflow/inbound')
      .set('X-Instaflow-Secret', SECRET)
      .send({
        event: 'message',
        workspace_id: t.orgId,
        conversation: { id: 'a1_555', name: 'Asha' },
        message: { id: 'mid-a1_555', from_me: true, text: 'hi' },
      });
    expect(pushed.status, JSON.stringify(pushed.body)).toBe(200);
    expect(await outbound(t)).toHaveLength(1);
  });
});

describe('the inbox composer (TW-IG-013)', () => {
  it('sends the typed text as it is, without {name}', async () => {
    const t = await api.signup('igbk');
    const id = await thread(t, 'ig:a1_555', 'Asha');
    const res = await composer(t, { body: 'Hello {name}', threadIds: [id] });
    expect(res.body).toEqual({ sent: 1, failed: 0, errors: [], held: 0, heldUntil: null });
    expect(sent[0]!.reply).toMatchObject({ type: 'text', text: 'Hello {name}' });
  });

  it('a template’s body and buttons replace the typed text, and a link button makes a button card', async () => {
    const t = await api.signup('igbl');
    const id = await thread(t, 'ig:a1_555', 'Asha');
    const tpl = await template(t, 'Promo', 'Big sale', [
      { text: 'Yes' },
      { text: 'Shop', url: 'https://shop.test' },
    ]);
    const res = await composer(t, { body: 'typed', threadIds: [id], templateId: tpl });
    expect(res.body.sent).toBe(1);
    expect(sent[0]!.reply.type).toBe('buttons');
    expect(sent[0]!.reply.text).toBe('Big sale');
    expect(sent[0]!.reply.buttons).toEqual([
      { type: 'postback', title: 'Yes', payload: 'Yes' },
      { type: 'web_url', title: 'Shop', url: 'https://shop.test' },
    ]);
    expect((await outbound(t))[0]!.body).toBe('Big sale');
  });

  it('plain buttons become quick replies, and an unknown template is ignored', async () => {
    const t = await api.signup('igbm');
    const id = await thread(t, 'ig:a1_555', 'Asha');
    const tpl = await template(t, 'Ask', 'Pick one', [{ text: 'A' }, { text: 'B' }]);
    await composer(t, { body: 'typed', threadIds: [id], templateId: tpl });
    expect(sent[0]!.reply.type).toBe('quick_replies');
    expect(sent[0]!.reply.quickReplies).toEqual([
      { title: 'A', payload: 'A' },
      { title: 'B', payload: 'B' },
    ]);
    await composer(t, {
      body: 'typed',
      threadIds: [id],
      templateId: '00000000-0000-4000-8000-000000000000',
    });
    expect(sent[1]!.reply).toMatchObject({ type: 'text', text: 'typed' });
  });
});

describe('BL-191: the broadcasts page is held, not denied, in the quiet hours', () => {
  /** 2030-10-15 16:00 UTC: 21:30 in India (quiet 21:00 to 09:00), 12:00 in New York (open). */
  const EVENING = new Date('2030-10-15T16:00:00Z');
  const MORNING = new Date('2030-10-16T03:31:00Z');
  const OPENS = '2030-10-16T03:30:00.000Z';

  /** A thread whose contact lives in `zone`, in a workspace with quiet hours 21:00 to 09:00. */
  async function arrange(label: string, zones: Record<string, string>) {
    const t = await api.signup(label);
    await h.owner.query(
      `INSERT INTO compliance_settings (org_id, quiet_hours_enabled, quiet_start, quiet_end) VALUES ($1, true, '21:00', '09:00')`,
      [t.orgId],
    );
    const ids: Record<string, string> = {};
    let n = 0;
    for (const [name, zone] of Object.entries(zones)) {
      const id = await thread(t, `ig:a1_${600 + n++}`, name);
      const contact = await h.owner.query(
        `INSERT INTO contacts (org_id, name, data) VALUES ($1, $2, jsonb_build_object('timezone', $3::text)) RETURNING id`,
        [t.orgId, name, zone],
      );
      await h.owner.query(`UPDATE conversations SET contact_id = $2 WHERE uuid = $1`, [
        id,
        contact.rows[0].id,
      ]);
      ids[name] = id;
    }
    return { t, ids };
  }

  beforeEach(() => {
    h.app.get(SendWindowService).now = () => EVENING;
  });

  const heldJobs = async (orgId: number) => {
    const queue = h.app.get<Queue>(getQueueToken(QUEUES.IG_PULL));
    return (await queue.getDelayed()).filter(
      (j) => j.name === IG_HELD_JOB && (j.data as IgHeldJob).orgId === orgId,
    );
  };
  const release = (job: IgHeldJob) =>
    RequestContextStore.run(
      { requestId: 'ig-held', orgId: job.orgId, actorType: 'system', actorId: null, userId: null },
      () => h.app.get(BroadcastsService).releaseHeld(job),
    );

  it('sends whoever is awake, holds whoever is in their quiet hours, and says so in the answer', async () => {
    const { t, ids } = await arrange('igq1', { Asha: 'Asia/Kolkata', Ned: 'America/New_York' });
    const res = await broadcast(t, {
      name: 'Autumn',
      message: 'Hi {name}!',
      threadIds: [ids.Asha, ids.Ned],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ sent: 1, failed: 0, errors: [], held: 1, heldUntil: OPENS });
    expect(sent.map((s) => s.reply.text)).toEqual(['Hi Ned!']);

    const jobs = await heldJobs(t.orgId);
    expect(jobs).toHaveLength(1);
    expect((jobs[0]!.data as IgHeldJob).items).toEqual([{ threadId: ids.Asha, text: 'Hi Asha!' }]);
    expect(jobs[0]!.opts.delay).toBeGreaterThan(11 * 3_600_000);
  });

  it('releases the held person at the opening, and waits again when asked before', async () => {
    const { t, ids } = await arrange('igq2', { Asha: 'Asia/Kolkata' });
    await broadcast(t, { name: 'x', message: 'Hello {name}', threadIds: [ids.Asha] });
    expect(sent).toHaveLength(0);
    const job = (await heldJobs(t.orgId))[0]!.data as IgHeldJob;

    // Asked again in the evening: still inside their hours, waits for the same opening.
    expect(await release(job)).toEqual({ sent: 0, failed: 0, held: 1 });
    expect(sent).toHaveLength(0);

    h.app.get(SendWindowService).now = () => MORNING;
    expect(await release(job)).toEqual({ sent: 1, failed: 0, held: 0 });
    expect(sent.map((s) => s.reply.text)).toEqual(['Hello Asha']);
    expect(await outbound(t)).toHaveLength(1);
  });

  it('a person who unsubscribed while the message waited is not messaged on release', async () => {
    const { t, ids } = await arrange('igq3', { Asha: 'Asia/Kolkata' });
    await broadcast(t, { name: 'x', message: 'Hello', threadIds: [ids.Asha] });
    const job = (await heldJobs(t.orgId))[0]!.data as IgHeldJob;
    await h.owner.query(
      `UPDATE contacts SET is_unsubscribed = true WHERE org_id = $1 AND name = 'Asha'`,
      [t.orgId],
    );
    h.app.get(SendWindowService).now = () => MORNING;
    expect(await release(job)).toEqual({ sent: 0, failed: 1, held: 0 });
    expect(sent).toHaveLength(0);
  });

  it('the inbox composer is a person answering a person and is never held', async () => {
    const { t, ids } = await arrange('igq4', { Asha: 'Asia/Kolkata' });
    const res = await composer(t, { body: 'Hello', threadIds: [ids.Asha] });
    expect(res.body).toEqual({ sent: 1, failed: 0, errors: [], held: 0, heldUntil: null });
    expect(await heldJobs(t.orgId)).toHaveLength(0);
  });
});
