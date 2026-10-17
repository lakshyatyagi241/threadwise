import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  TELEGRAM_API,
  type MediaKind,
  type MediaSource,
  type SendOptions,
  type SentMessage,
  type TelegramApiFactory,
  type TelegramBotApi,
  type TelegramResult,
} from '../../../src/infra/providers/channel-telegram/telegram.port';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { TgBroadcastSenderService } from '../../../src/modules/channel-telegram/tg-broadcast-sender.service';
import { SendWindowService } from '../../../src/modules/compliance-center';
import { ConsentGate } from '../../../src/modules/contact-consent';
import { ConsentKit, refusedWith } from '../contact-consent/broadcast-consent.support';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/** Telegram broadcasts (TW-TG-010 to 014): audience, draft, the sender run, pause, retry, delete. Real Postgres, fake Telegram. */
let h: Harness;
let api: Api;
let sender: TgBroadcastSenderService;

interface Call {
  method: 'sendMessage' | 'sendMedia';
  chat: string;
  text: string;
  kind?: MediaKind;
  source?: MediaSource;
  opts?: SendOptions;
}
const calls: Call[] = [];
/** What Telegram answers for a chat; default is a success. */
let answer: (chat: string) => TelegramResult<SentMessage> = () => ({
  ok: true,
  result: { message_id: 90 },
});

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  sender = h.app.get(TgBroadcastSenderService);
  sender.sleep = () => Promise.resolve();
  h.app.get<TelegramApiFactory>(TELEGRAM_API).forToken = (token) =>
    ({
      getMe: () =>
        Promise.resolve({
          ok: true,
          result: { id: Number(token.split(':')[0]), username: 'shop_bot', first_name: 'Shop' },
        }),
      setWebhook: () => Promise.resolve({ ok: true }),
      deleteWebhook: () => Promise.resolve({ ok: true }),
      sendMessage: (chat: string, text: string, opts?: SendOptions) => {
        calls.push({ method: 'sendMessage', chat, text, opts });
        return Promise.resolve(answer(chat));
      },
      sendMedia: (
        chat: string,
        kind: MediaKind,
        source: MediaSource,
        caption?: string | null,
        opts?: SendOptions,
      ) => {
        calls.push({ method: 'sendMedia', chat, text: caption ?? '', kind, source, opts });
        return Promise.resolve(answer(chat));
      },
    }) as unknown as TelegramBotApi;
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  calls.length = 0;
  answer = () => ({ ok: true, result: { message_id: 90 } });
});

let n = 0;
/** A connected bot with a known webhook secret, so tests can push inbound messages to create threads. */
async function bot(t: Tenant) {
  const id = 6000000 + n++;
  const res = await api
    .http()
    .post('/v2/telegram/bots')
    .set(bearer(t.admin))
    .set('idempotency-key', randomUUID())
    .send({ botToken: `${id}:AAH${'z'.repeat(30)}_${n}` });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const row = (
    await h.owner.query(`SELECT id, webhook_token FROM telegram_bots WHERE uuid = $1`, [
      res.body.id,
    ])
  ).rows[0];
  const secret = `T${n}`.padEnd(48, 'T');
  await h.owner.query(`UPDATE telegram_bots SET secret_token = $2 WHERE id = $1`, [
    row.id,
    h.app.get(CryptoService).encrypt(secret),
  ]);
  return {
    rowId: Number(row.id),
    token: row.webhook_token as string,
    secret,
    uuid: res.body.id as string,
  };
}
type Bot = Awaited<ReturnType<typeof bot>>;

/** A chat writes to the bot, which creates its inbox thread. */
async function chatWrites(b: Bot, chat: object, from: object | null) {
  const res = await api
    .http()
    .post(`/v2/telegram/inbound/${b.token}`)
    .set('x-telegram-bot-api-secret-token', b.secret)
    .send({
      update_id: 1,
      message: { message_id: 5, chat, ...(from ? { from } : {}), date: 1, text: 'hi' },
    });
  expect(res.status).toBe(200);
}

/** A bot with `count` private chats (ids 1001.., titled Person0..). */
async function botWithChats(t: Tenant, count: number) {
  const b = await bot(t);
  for (let i = 0; i < count; i++) {
    await chatWrites(b, { id: 1001 + i, type: 'private', first_name: `Person${i}` }, null);
  }
  return b;
}
const ids = (count: number) => Array.from({ length: count }, (_, i) => String(1001 + i));

const post = (t: Tenant, path: string, body?: object) =>
  api
    .http()
    .post(`/v2/telegram/${path}`)
    .set(bearer(t.admin))
    .set('idempotency-key', randomUUID())
    .send(body ?? {});
const create = (t: Tenant, b: Bot, over: object = {}) =>
  post(t, 'broadcasts', {
    name: 'Promo',
    botId: b.uuid,
    body: 'Hi {{name}}',
    chatIds: ids(3),
    ...over,
  });
const code = (res: { body: { code?: string; error?: { code?: string } } }) =>
  res.body.code ?? res.body.error?.code;
const recipients = async (id: string) =>
  (
    await h.owner.query(
      `SELECT r.chat_id, r.status, r.error FROM telegram_broadcast_recipients r
       JOIN telegram_broadcasts b ON b.org_id = r.org_id AND b.id = r.telegram_broadcast_id
       WHERE b.uuid = $1 ORDER BY r.id`,
      [id],
    )
  ).rows as Array<{ chat_id: string; status: string; error: string | null }>;
const rowOf = async (id: string) =>
  (await h.owner.query(`SELECT * FROM telegram_broadcasts WHERE uuid = $1`, [id])).rows[0];
const runId = async (id: string) => Number((await rowOf(id)).id);

describe('TW-TG-010: the audience is the chats a bot carries', () => {
  it("lists only this bot's chats with their type, and never another workspace's", async () => {
    const t = await api.signup('tb1');
    const u = await api.signup('tb1b');
    const a = await botWithChats(t, 2);
    await chatWrites(
      a,
      { id: -100777, type: 'supergroup', title: 'Team' },
      { id: 9, first_name: 'Z' },
    );
    await botWithChats(t, 3);
    const other = await botWithChats(u, 1);

    const res = await api.http().get(`/v2/telegram/bots/${a.uuid}/chats`).set(bearer(t.admin));
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(
      (res.body.data as Array<{ chatId: string; type: string; title: string }>).map((c) => [
        c.chatId,
        c,
      ]),
    );
    expect(Object.keys(byId).sort()).toEqual(['-100777', '1001', '1002']);
    expect(byId['-100777']).toMatchObject({ type: 'group', title: 'Team' });
    expect(byId['1001']!.type).toBe('private');

    const foreign = await api
      .http()
      .get(`/v2/telegram/bots/${other.uuid}/chats`)
      .set(bearer(t.admin));
    expect(foreign.status).toBe(404);
  });
});

describe('TW-TG-012: composing a draft', () => {
  it('freezes the recipients, drops forged chat ids and totals what is left', async () => {
    const t = await api.signup('tb2');
    const b = await botWithChats(t, 3);
    const res = await create(t, b, { chatIds: ['1001', '1002', '999999', '1001'] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ status: 'draft', total: 2, sent: 0, progress: 0 });
    expect((await recipients(res.body.id)).map((r) => r.chat_id)).toEqual(['1001', '1002']);
    // The text is encrypted at rest.
    expect((await rowOf(res.body.id)).body).not.toContain('Hi');
  });

  it('refuses nothing to send and nobody to send to', async () => {
    const t = await api.signup('tb3');
    const b = await botWithChats(t, 1);
    const empty = await create(t, b, { body: '' });
    expect(empty.status).toBe(422);
    expect(code(empty)).toBe('TG_BROADCAST_EMPTY');
    const nobody = await create(t, b, { chatIds: ['424242'] });
    expect(nobody.status).toBe(422);
    expect(code(nobody)).toBe('TG_NO_RECIPIENTS');
  });

  it("a Telegram template fills an empty body and its buttons ride on the send; another workspace's bot is not found", async () => {
    const t = await api.signup('tb4');
    const u = await api.signup('tb4b');
    const b = await botWithChats(t, 1);
    const tpl = (
      await h.owner.query(
        `INSERT INTO wa_templates (org_id, template_name, template_body, buttons, channel)
         VALUES ($1, 'tg-offer', 'Offer for {{name}}', $2::jsonb, 'telegram') RETURNING uuid`,
        [t.orgId, JSON.stringify([{ type: 'url', text: 'Shop', url: 'https://x.test' }])],
      )
    ).rows[0];
    const compose = await api.http().get('/v2/telegram/broadcasts/compose').set(bearer(t.admin));
    expect(compose.body.templates.map((x: { name: string }) => x.name)).toEqual(['tg-offer']);

    const made = await create(t, b, { body: '', templateId: tpl.uuid, chatIds: ['1001'] });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    await post(t, `broadcasts/${made.body.id}/start`);
    await sender.run(t.orgId, await runId(made.body.id));
    expect(calls[0]!.text).toBe('Offer for Person0');
    expect(calls[0]!.opts?.replyMarkup).toEqual({
      inline_keyboard: [[{ text: 'Shop', url: 'https://x.test' }]],
    });

    expect((await create(u, b)).status).toBe(404);
  });
});

describe('TW-TG-013 and 014: sending, pausing, retrying', () => {
  it('sends in order, personalises, tells blocked from failed, mirrors into the thread and ends done', async () => {
    const t = await api.signup('tb5');
    const b = await botWithChats(t, 30);
    answer = (chat) =>
      chat === '1002'
        ? { ok: false, error: 'Forbidden: bot was blocked by the user' }
        : chat === '1003'
          ? { ok: false, error: 'Bad Request: something odd' }
          : { ok: true, result: { message_id: 90 } };
    const made = await create(t, b, { chatIds: ids(30) });
    const started = await post(t, `broadcasts/${made.body.id}/start`);
    expect(started.status).toBe(200);
    expect(started.body.status).toBe('sending');
    expect(started.body.startedAt).not.toBeNull();

    const id = await runId(made.body.id);
    expect(await sender.run(t.orgId, id)).toBe('done');

    expect(calls.map((c) => c.chat)).toEqual(ids(30));
    expect(calls[0]!.text).toBe('Hi Person0');
    const rows = await recipients(made.body.id);
    expect(rows.find((r) => r.chat_id === '1002')).toMatchObject({ status: 'blocked' });
    expect(rows.find((r) => r.chat_id === '1003')).toMatchObject({
      status: 'failed',
      error: 'Bad Request: something odd',
    });
    const row = await rowOf(made.body.id);
    expect(row).toMatchObject({ status: 'done', sent: 28, failed: 1, blocked: 1 });
    expect(row.finished_at).not.toBeNull();

    const outbound = await h.owner.query(
      `SELECT count(*)::int AS n FROM messages WHERE org_id = $1 AND direction = 'out' AND meta ->> 'source' = 'broadcast' AND sender_kind = 'broadcast'`,
      [t.orgId],
    );
    expect(outbound.rows[0].n).toBe(28);

    // A second run of a finished broadcast does nothing: nobody is messaged twice.
    calls.length = 0;
    expect(await sender.run(t.orgId, id)).toBe('skipped');
    expect(calls).toHaveLength(0);
  });

  it('a file is uploaded once and every later chat gets its Telegram file id; the largest photo size is kept', async () => {
    const t = await api.signup('tb6');
    const b = await botWithChats(t, 3);
    answer = () => ({
      ok: true,
      result: { message_id: 90, photo: [{ file_id: 'small' }, { file_id: 'big' }] },
    });
    const made = await create(t, b, { mediaUrl: 'https://cdn.example.com/promo.png' });
    await post(t, `broadcasts/${made.body.id}/start`);
    await sender.run(t.orgId, await runId(made.body.id));
    expect(calls.map((c) => c.method)).toEqual(['sendMedia', 'sendMedia', 'sendMedia']);
    expect(calls[0]).toMatchObject({
      kind: 'image',
      source: { url: 'https://cdn.example.com/promo.png' },
    });
    expect(calls[1]!.source).toEqual({ fileId: 'big' });
    expect(calls[2]!.source).toEqual({ fileId: 'big' });
    expect((await rowOf(made.body.id)).media_file_id).toBe('big');
  });

  it('a paused bot cannot start a broadcast, and a bot paused mid-way fails a running one with a reason', async () => {
    const t = await api.signup('tb7');
    const b = await botWithChats(t, 2);
    const made = await create(t, b, { chatIds: ['1001', '1002'] });
    await post(t, `bots/${b.uuid}/toggle`);
    const refused = await post(t, `broadcasts/${made.body.id}/start`);
    expect(refused.status).toBe(422);
    expect(code(refused)).toBe('TG_BOT_UNAVAILABLE');

    await post(t, `bots/${b.uuid}/toggle`);
    await post(t, `broadcasts/${made.body.id}/start`);
    await h.owner.query(`UPDATE telegram_bots SET active = false WHERE id = $1`, [b.rowId]);
    expect(await sender.run(t.orgId, await runId(made.body.id))).toBe('failed');
    expect(await rowOf(made.body.id)).toMatchObject({ status: 'failed' });
    expect((await rowOf(made.body.id)).last_error).toMatch(/paused|connected/);
    expect(calls).toHaveLength(0);
  });

  it('pause stops at the next batch, leaves the rest pending, and a second start sends only those', async () => {
    const t = await api.signup('tb8');
    const b = await botWithChats(t, 30);
    const made = await create(t, b, { chatIds: ids(30) });
    await post(t, `broadcasts/${made.body.id}/start`);
    const id = await runId(made.body.id);

    let slept = 0;
    sender.sleep = async () => {
      slept += 1;
      if (slept === 25) await post(t, `broadcasts/${made.body.id}/pause`);
    };
    expect(await sender.run(t.orgId, id)).toBe('stopped');
    sender.sleep = () => Promise.resolve();
    expect(calls).toHaveLength(25);
    expect(await rowOf(made.body.id)).toMatchObject({ status: 'draft', sent: 25 });
    expect((await recipients(made.body.id)).filter((r) => r.status === 'pending')).toHaveLength(5);

    await post(t, `broadcasts/${made.body.id}/start`);
    expect(await sender.run(t.orgId, id)).toBe('done');
    expect(calls).toHaveLength(30);
    expect(new Set(calls.map((c) => c.chat)).size).toBe(30);
    expect(await rowOf(made.body.id)).toMatchObject({ status: 'done', sent: 30 });
  });

  it('retry puts only failed chats back, blocked stay, and it is refused with nothing to retry', async () => {
    const t = await api.signup('tb9');
    const b = await botWithChats(t, 3);
    answer = (chat) =>
      chat === '1001'
        ? { ok: false, error: 'Forbidden: bot was blocked by the user' }
        : chat === '1002'
          ? { ok: false, error: 'Bad Request: flaky' }
          : { ok: true, result: { message_id: 90 } };
    const made = await create(t, b);
    await post(t, `broadcasts/${made.body.id}/start`);
    const id = await runId(made.body.id);
    await sender.run(t.orgId, id);

    const retried = await post(t, `broadcasts/${made.body.id}/retry`);
    expect(retried.status).toBe(200);
    expect(retried.body).toEqual({ retried: 1 });
    expect(await rowOf(made.body.id)).toMatchObject({
      status: 'draft',
      sent: 1,
      failed: 0,
      blocked: 1,
    });
    expect((await rowOf(made.body.id)).finished_at).toBeNull();

    calls.length = 0;
    answer = () => ({ ok: true, result: { message_id: 91 } });
    await post(t, `broadcasts/${made.body.id}/start`);
    await sender.run(t.orgId, id);
    expect(calls.map((c) => c.chat)).toEqual(['1002']);

    const again = await post(t, `broadcasts/${made.body.id}/retry`);
    expect(again.status).toBe(422);
    expect(code(again)).toBe('TG_NOTHING_TO_RETRY');
  });

  it('start with nobody pending is refused', async () => {
    const t = await api.signup('tb10');
    const b = await botWithChats(t, 1);
    const made = await create(t, b, { chatIds: ['1001'] });
    await post(t, `broadcasts/${made.body.id}/start`);
    await sender.run(t.orgId, await runId(made.body.id));
    const again = await post(t, `broadcasts/${made.body.id}/start`);
    expect(again.status).toBe(422);
    expect(code(again)).toBe('TG_NOTHING_TO_SEND');
  });
});

describe('listing, deleting, isolation, permissions', () => {
  it('the list carries totals across every broadcast, delete works in any status and takes the recipients with it', async () => {
    const t = await api.signup('tb11');
    const b = await botWithChats(t, 3);
    const one = await create(t, b);
    const two = await create(t, b, { name: 'Second' });
    await post(t, `broadcasts/${two.body.id}/start`);
    await sender.run(t.orgId, await runId(two.body.id));

    const list = await api.http().get('/v2/telegram/broadcasts').set(bearer(t.admin));
    expect(list.status).toBe(200);
    expect(list.body.stats).toMatchObject({ total: 2, sent: 3, audience: 6, sending: 0 });
    expect(list.body.data.map((x: { name: string }) => x.name)).toEqual(['Second', 'Promo']);

    const del = await api
      .http()
      .delete(`/v2/telegram/broadcasts/${one.body.id}`)
      .set(bearer(t.admin))
      .set('idempotency-key', randomUUID());
    expect(del.status).toBe(204);
    expect(await recipients(one.body.id)).toEqual([]);
    expect(await rowOf(one.body.id)).toBeUndefined();
  });

  it("another workspace's broadcast is 404 for every action, and each route needs its permission", async () => {
    const t = await api.signup('tb12');
    const u = await api.signup('tb12b');
    const b = await botWithChats(t, 1);
    const made = await create(t, b, { chatIds: ['1001'] });
    for (const path of ['start', 'pause', 'retry']) {
      expect((await post(u, `broadcasts/${made.body.id}/${path}`)).status).toBe(404);
    }
    const foreignDelete = await api
      .http()
      .delete(`/v2/telegram/broadcasts/${made.body.id}`)
      .set(bearer(u.admin))
      .set('idempotency-key', randomUUID());
    expect(foreignDelete.status).toBe(404);

    const viewer = await api.member(t, 'viewer', []);
    const asViewer = await api.http().get('/v2/telegram/broadcasts').set(bearer(viewer.token));
    expect(asViewer.status).toBe(403);
    const reader = await api.member(t, 'reader', [['tg.broadcasts.read']]);
    const asReader = await api.http().get('/v2/telegram/broadcasts').set(bearer(reader.token));
    expect(asReader.status).toBe(200);
    const denied = await api
      .http()
      .post('/v2/telegram/broadcasts')
      .set(bearer(reader.token))
      .set('idempotency-key', randomUUID())
      .send({ name: 'x', botId: b.uuid, body: 'x', chatIds: ['1001'] });
    expect(denied.status).toBe(403);
    expect((await api.http().get('/v2/telegram/broadcasts')).status).toBe(401);
  });
});

describe('BL-141: the first send of a Telegram broadcast asks the ConsentGate', () => {
  const kit = () => new ConsentKit(h, api);

  /** The thread behind a chat of a draft, tied to a contact of its own. */
  async function contactOfChat(t: Tenant, uuid: string, chat: string) {
    const r = await h.owner.query(
      `SELECT r.conversation_id FROM telegram_broadcast_recipients r
         JOIN telegram_broadcasts b ON b.org_id = r.org_id AND b.id = r.telegram_broadcast_id
        WHERE b.uuid = $1 AND r.chat_id = $2`,
      [uuid, chat],
    );
    return kit().forConversation(t, Number(r.rows[0].conversation_id), 'telegram', `tgc-${chat}`);
  }
  const byChat = (rows: Awaited<ReturnType<typeof recipients>>) =>
    Object.fromEntries(rows.map((r) => [r.chat_id, r]));

  it('an opted-out chat is not messaged and keeps the gate reason; a withdrawn ledger, a granted one and a plain one behave', async () => {
    const t = await api.signup('tcg1');
    const b = await botWithChats(t, 4);
    const made = await create(t, b, { chatIds: ids(4) });
    const stopped = await contactOfChat(t, made.body.id, '1001');
    const ledger = await contactOfChat(t, made.body.id, '1002');
    const granted = await contactOfChat(t, made.body.id, '1003');
    await contactOfChat(t, made.body.id, '1004');
    await kit().unsubscribe(t, stopped.id);
    await kit().record(t, ledger.uuid, 'telegram', 'withdrawn');
    await kit().record(t, granted.uuid, 'telegram', 'granted');

    await post(t, `broadcasts/${made.body.id}/start`);
    expect(await sender.run(t.orgId, await runId(made.body.id))).toBe('done');

    expect(calls.map((c) => c.chat)).toEqual(['1003', '1004']);
    const rows = byChat(await recipients(made.body.id));
    expect(rows['1001']).toMatchObject({ status: 'blocked', error: refusedWith('withdrawn') });
    expect(rows['1002']).toMatchObject({ status: 'blocked', error: refusedWith('withdrawn') });
    expect(rows['1003']).toMatchObject({ status: 'sent', error: null });
    expect(rows['1004']).toMatchObject({ status: 'sent', error: null });
    expect(await rowOf(made.body.id)).toMatchObject({
      status: 'done',
      sent: 2,
      blocked: 2,
      total: 4,
    });
  });

  it('with the workspace switch on a chat needs a recorded grant: the granted one goes, the rest are skipped', async () => {
    const t = await api.signup('tcg2');
    const b = await botWithChats(t, 3);
    const made = await create(t, b, { chatIds: ids(3) });
    const granted = await contactOfChat(t, made.body.id, '1001');
    await contactOfChat(t, made.body.id, '1002');
    const orphan = await contactOfChat(t, made.body.id, '1003');
    await kit().record(t, granted.uuid, 'telegram', 'granted');
    // A chat that never became a contact has nothing on record.
    await h.owner.query(
      `UPDATE conversations SET contact_id = NULL WHERE org_id = $1 AND contact_id = $2`,
      [t.orgId, orphan.id],
    );
    await kit().setSwitch(t, true);

    await post(t, `broadcasts/${made.body.id}/start`);
    await sender.run(t.orgId, await runId(made.body.id));

    expect(calls.map((c) => c.chat)).toEqual(['1001']);
    const rows = byChat(await recipients(made.body.id));
    expect(rows['1002']).toMatchObject({
      status: 'blocked',
      error: refusedWith('no_consent_recorded'),
    });
    expect(rows['1003']).toMatchObject({
      status: 'blocked',
      error: refusedWith('no_consent_recorded'),
    });
    expect(await rowOf(made.body.id)).toMatchObject({ sent: 1, blocked: 2 });
  });

  it('with the switch off (the default) a chat with no grant at all is messaged: only withdrawals block', async () => {
    const t = await api.signup('tcg3');
    const b = await botWithChats(t, 2);
    const made = await create(t, b, { chatIds: ids(2) });
    await contactOfChat(t, made.body.id, '1001');
    await post(t, `broadcasts/${made.body.id}/start`);
    await sender.run(t.orgId, await runId(made.body.id));
    expect(calls.map((c) => c.chat)).toEqual(['1001', '1002']);
  });

  it('a contact flagged as a minor is skipped when the workspace says no minors', async () => {
    const t = await api.signup('tcg4');
    const b = await botWithChats(t, 2);
    const made = await create(t, b, { chatIds: ids(2) });
    const child = await contactOfChat(t, made.body.id, '1001');
    await contactOfChat(t, made.body.id, '1002');
    await kit().minor(t, child.id);
    await post(t, `broadcasts/${made.body.id}/start`);
    await sender.run(t.orgId, await runId(made.body.id));
    expect(calls.map((c) => c.chat)).toEqual(['1002']);
    expect(byChat(await recipients(made.body.id))['1001']).toMatchObject({
      status: 'blocked',
      error: refusedWith('subject_minor'),
    });
  });

  it('a service message is never blocked: STOP, the switch and a minor flag do not stop a reply or a utility notice', async () => {
    const t = await api.signup('tcg5');
    const b = await botWithChats(t, 1);
    const made = await create(t, b, { chatIds: ids(1) });
    const c = await contactOfChat(t, made.body.id, '1001');
    await kit().unsubscribe(t, c.id);
    await kit().minor(t, c.id);
    await kit().setSwitch(t, true);
    const gate = h.app.get(ConsentGate);
    const subject = { type: 'contact', id: c.id } as const;
    // The broadcast itself is refused ...
    expect((await gate.check(t.orgId, subject, 'telegram', 'marketing_messaging')).decision).toBe(
      'deny',
    );
    // ... a reply inside the 24 hour window and a utility notice are not.
    expect(
      await gate.check(t.orgId, subject, 'telegram', 'service_messaging', undefined, {
        replyWindowOpen: true,
      }),
    ).toEqual({ decision: 'allow', reason: 'inbound_reply_window' });
    expect(await gate.check(t.orgId, subject, 'telegram', 'service_messaging')).toEqual({
      decision: 'allow',
      reason: 'utility_exempt',
    });
  });

  describe('held for the quiet hours, then released', () => {
    const EVENING = new Date('2030-10-15T16:00:00Z');
    const MORNING = new Date('2030-10-16T03:31:00Z');

    it('is asked again on release: a chat that unsubscribed while it waited is not messaged', async () => {
      const window = h.app.get(SendWindowService);
      const realNow = window.now;
      window.now = () => EVENING;
      try {
        const t = await api.signup('tcg6');
        const b = await botWithChats(t, 2);
        await h.owner.query(
          `INSERT INTO compliance_settings (org_id, quiet_hours_enabled, quiet_start, quiet_end) VALUES ($1, true, '21:00', '09:00')`,
          [t.orgId],
        );
        const made = await create(t, b, { chatIds: ids(2) });
        const first = await contactOfChat(t, made.body.id, '1001');
        const second = await contactOfChat(t, made.body.id, '1002');
        for (const c of [first, second]) {
          await h.owner.query(
            `UPDATE contacts SET data = jsonb_build_object('timezone', 'Asia/Kolkata') WHERE org_id = $1 AND id = $2`,
            [t.orgId, c.id],
          );
        }
        await post(t, `broadcasts/${made.body.id}/start`);
        const id = await runId(made.body.id);
        expect(await sender.run(t.orgId, id)).toBe('held');
        expect(calls).toHaveLength(0);
        expect((await recipients(made.body.id)).map((r) => r.status)).toEqual([
          'pending',
          'pending',
        ]);

        await kit().unsubscribe(t, first.id);
        window.now = () => MORNING;
        await h.owner.query(
          `UPDATE telegram_broadcast_recipients SET held_until = now() - interval '1 minute' WHERE org_id = $1 AND held_until IS NOT NULL`,
          [t.orgId],
        );
        expect(await sender.run(t.orgId, id)).toBe('done');
        expect(calls.map((c) => c.chat)).toEqual(['1002']);
        const rows = byChat(await recipients(made.body.id));
        expect(rows['1001']).toMatchObject({ status: 'blocked', error: refusedWith('withdrawn') });
        expect(rows['1002']).toMatchObject({ status: 'sent' });
      } finally {
        window.now = realNow;
      }
    });
  });
});
