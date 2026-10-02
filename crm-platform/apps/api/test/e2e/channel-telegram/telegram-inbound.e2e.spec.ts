import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  TELEGRAM_API,
  type TelegramApiFactory,
  type TelegramBotApi,
} from '../../../src/infra/providers/channel-telegram/telegram.port';
import {
  INBOUND_HOOKS,
  type InboundHooks,
} from '../../../src/modules/channel-telegram/_shims/tokens';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/** The Telegram webhook (TW-TG-003 to 006): secret check, inbox thread, contact, taps and payments, against a real Postgres. */
let h: Harness;
let api: Api;

const asked: Array<{ method: string; args: unknown[] }> = [];
const handed: Array<{ kind: string; ctx: unknown; extra?: unknown }> = [];
let consume = false;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  const fake: TelegramBotApi = {
    getMe: () =>
      Promise.resolve({
        ok: true,
        result: { id: 7000001, username: 'shop_bot', first_name: 'Shop' },
      }),
    setWebhook: () => Promise.resolve({ ok: true }),
    deleteWebhook: () => Promise.resolve({ ok: true }),
    answerCallbackQuery: (id) => {
      asked.push({ method: 'answerCallbackQuery', args: [id] });
      return Promise.resolve({ ok: true });
    },
    answerPreCheckoutQuery: (id, ok) => {
      asked.push({ method: 'answerPreCheckoutQuery', args: [id, ok] });
      return Promise.resolve({ ok: true });
    },
    downloadFile: () => Promise.resolve(null),
    getUserProfilePhoto: () => Promise.resolve(null),
  };
  h.app.get<TelegramApiFactory>(TELEGRAM_API).forToken = () => fake;
  const hooks = h.app.get<InboundHooks>(INBOUND_HOOKS);
  hooks.handoffToFlow = (ctx) => {
    handed.push({ kind: 'flow', ctx });
    return Promise.resolve(consume);
  };
  hooks.automate = (ctx) => {
    handed.push({ kind: 'automate', ctx });
    return Promise.resolve();
  };
  hooks.resumePaid = (ctx, payment) => {
    handed.push({ kind: 'paid', ctx, extra: payment });
    return Promise.resolve();
  };
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  asked.length = 0;
  handed.length = 0;
  consume = false;
});

let n = 0;
/** A connected bot and its webhook address pieces. */
async function bot(t: Tenant) {
  const id = 7000000 + n++;
  const res = await api
    .http()
    .post('/v2/telegram/bots')
    .set(bearer(t.admin))
    .set('idempotency-key', randomUUID())
    .send({ botToken: `${id}:AAH${'x'.repeat(30)}_${n}` });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const row = (
    await h.owner.query(`SELECT id, webhook_token FROM telegram_bots WHERE uuid = $1`, [
      res.body.id,
    ])
  ).rows[0];
  const secret = `S${n}`.padEnd(48, 'S');
  // The header secret is stored encrypted; the test sets a known one the same way the app does.
  const { CryptoService } = await import('../../../src/common/crypto/crypto.service');
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

const push = (b: { token: string; secret: string }, update: unknown, secret = b.secret) =>
  api
    .http()
    .post(`/v2/telegram/inbound/${b.token}`)
    .set('x-telegram-bot-api-secret-token', secret)
    .send(update as object);

const message = (chat: object, extra: object = {}) => ({
  update_id: 1,
  message: {
    message_id: 11,
    chat: { id: 555, type: 'private', first_name: 'Asha', last_name: 'Rao' },
    from: { id: 555, username: 'asha', first_name: 'Asha' },
    date: 1,
    ...extra,
    ...chat,
  },
});
const convs = async (t: Tenant) =>
  (
    await h.owner.query(`SELECT * FROM conversations WHERE org_id = $1 AND channel = 'telegram'`, [
      t.orgId,
    ])
  ).rows;
const msgs = async (t: Tenant) =>
  (await h.owner.query(`SELECT * FROM messages WHERE org_id = $1 ORDER BY id`, [t.orgId])).rows;

describe('TW-TG-003: the webhook door', () => {
  it('an unknown token, a wrong secret and a paused bot all answer 200 and write nothing', async () => {
    const t = await api.signup('ti1');
    const b = await bot(t);
    const unknown = await api
      .http()
      .post('/v2/telegram/inbound/nope')
      .send(message({ text: 'x' }));
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual({ ok: true, note: 'unknown bot' });

    const bad = await push(b, message({ text: 'hi' }), 'wrong');
    expect(bad.status).toBe(200);
    expect(bad.body.note).toBe('bad secret');
    const none = await api
      .http()
      .post(`/v2/telegram/inbound/${b.token}`)
      .send(message({ text: 'hi' }));
    expect(none.body.note).toBe('bad secret');

    await h.owner.query(`UPDATE telegram_bots SET active = false WHERE id = $1`, [b.rowId]);
    expect((await push(b, message({ text: 'hi' }))).body.note).toBe('bot disabled');
    expect(await convs(t)).toHaveLength(0);
    expect(await msgs(t)).toHaveLength(0);
  });

  it('an update with nothing usable is acknowledged', async () => {
    const t = await api.signup('ti2');
    const b = await bot(t);
    expect((await push(b, { update_id: 9 })).body.note).toBe('no message');
    expect(
      (await push(b, { update_id: 9, chat_join_request: { chat: { id: 1 } } })).body.note,
    ).toBe('chat_join_request');
    expect((await push(b, { update_id: 9, poll_answer: { poll_id: 'p' } })).body.note).toBe(
      'poll_answer',
    );
    const row = (
      await h.owner.query(`SELECT last_inbound_at FROM telegram_bots WHERE id = $1`, [b.rowId])
    ).rows[0];
    expect(row.last_inbound_at).not.toBeNull();
  });
});

describe('TW-TG-004: a message becomes a thread, a contact and a message', () => {
  it('first message: thread keyed by bot and chat, contact keyed by the Telegram user, unread 1, bot marked alive', async () => {
    const t = await api.signup('ti3');
    const b = await bot(t);
    await h.owner.query(`UPDATE telegram_bots SET last_error = 'old' WHERE id = $1`, [b.rowId]);
    const res = await push(b, message({ text: 'Hello there' }));
    expect(res.body).toEqual({ ok: true, note: 'ok' });

    const [c] = await convs(t);
    expect(c).toMatchObject({
      raw_jid: `tg:${b.rowId}:555`,
      title: 'asha',
      provider: 'telegram',
      origin: 'telegram',
      inbox_status: 'open',
      unread_count: 1,
      preview: 'Hello there',
    });
    const [m] = await msgs(t);
    expect(m).toMatchObject({
      direction: 'in',
      body: 'Hello there',
      status: 'received',
      provider: 'telegram',
      from_number: '555',
    });
    expect(m.meta.telegram).toMatchObject({
      chat_id: '555',
      message_id: '11',
      chat_type: 'private',
      username: 'asha',
      from_id: '555',
    });
    const contact = (
      await h.owner.query(`SELECT * FROM contacts WHERE org_id = $1 AND channel = 'telegram'`, [
        t.orgId,
      ])
    ).rows;
    expect(contact).toHaveLength(1);
    expect(contact[0]).toMatchObject({
      channel_uid: '555',
      name: 'asha',
      message: 'Source: Telegram DM',
    });
    expect(c.contact_id).toBe(contact[0].id);
    const bt = (
      await h.owner.query(`SELECT last_inbound_at, last_error FROM telegram_bots WHERE id = $1`, [
        b.rowId,
      ])
    ).rows[0];
    expect(bt.last_inbound_at).not.toBeNull();
    expect(bt.last_error).toBeNull();
  });

  it('a second message joins the same thread and contact; a resolved thread reopens; two at once make one thread', async () => {
    const t = await api.signup('ti4');
    const b = await bot(t);
    await push(b, message({ text: 'one' }));
    await h.owner.query(`UPDATE conversations SET inbox_status = 'resolved' WHERE org_id = $1`, [
      t.orgId,
    ]);
    await push(b, message({ text: 'two' }));
    expect(await convs(t)).toHaveLength(1);
    expect((await convs(t))[0]).toMatchObject({
      inbox_status: 'open',
      unread_count: 2,
      preview: 'two',
    });
    expect(
      (
        await h.owner.query(`SELECT 1 FROM contacts WHERE org_id = $1 AND channel = 'telegram'`, [
          t.orgId,
        ])
      ).rows,
    ).toHaveLength(1);

    const u = await api.signup('ti4b');
    const bu = await bot(u);
    await Promise.all(
      [1, 2, 3].map((i) =>
        push(bu, message({ text: `m${i}`, chat: { id: 900, type: 'private' }, from: { id: 900 } })),
      ),
    );
    expect(await convs(u)).toHaveLength(1);
    expect(await msgs(u)).toHaveLength(3);
  });

  it('a group message keeps the group as the thread and the sender as the contact; a channel post uses the chat', async () => {
    const t = await api.signup('ti5');
    const b = await bot(t);
    await push(
      b,
      message({
        text: 'hi all',
        chat: { id: -100123, type: 'supergroup', title: 'Team' },
        from: { id: 42, username: 'ravi' },
      }),
    );
    await push(b, {
      update_id: 2,
      channel_post: {
        message_id: 3,
        chat: { id: -100999, type: 'channel', title: 'News' },
        text: 'post',
      },
    });
    const all = await convs(t);
    expect(all.map((c: { title: string }) => c.title).sort()).toEqual(['News', 'Team']);
    expect((await msgs(t))[0].meta.telegram).toMatchObject({
      chat_type: 'supergroup',
      chat_title: 'Team',
    });
    const uids = (
      await h.owner.query(
        `SELECT channel_uid FROM contacts WHERE org_id = $1 AND channel = 'telegram' ORDER BY channel_uid`,
        [t.orgId],
      )
    ).rows;
    expect(uids.map((r: { channel_uid: string }) => r.channel_uid)).toEqual(['-100999', '42']);
  });

  it('a photo is stored with its caption and, with no file storage yet, no file', async () => {
    const t = await api.signup('ti6');
    const b = await bot(t);
    await push(
      b,
      message({ photo: [{ file_id: 'small' }, { file_id: 'LARGE' }], caption: 'Look' }),
    );
    const [m] = await msgs(t);
    expect(m).toMatchObject({ body: 'Look', media_path: null, media_type: null });
    expect(m.meta.telegram.file_id).toBe('LARGE');
  });

  it('automation runs after the message: the flow first, and only when it did not consume the message the rest', async () => {
    const t = await api.signup('ti7');
    const b = await bot(t);
    await push(b, message({ text: 'start' }));
    expect(handed.map((x) => x.kind)).toEqual(['flow', 'automate']);
    expect(handed[0]!.ctx).toMatchObject({
      orgId: t.orgId,
      botRowId: b.rowId,
      chatId: '555',
      text: 'start',
      newThread: true,
    });

    handed.length = 0;
    consume = true;
    await push(b, message({ text: 'again' }));
    expect(handed.map((x) => x.kind)).toEqual(['flow']);
    expect(await msgs(t)).toHaveLength(2);
  });
});

describe('TW-TG-005: button taps', () => {
  it('a tap is answered; a tqr: tap is also replayed as a typed message', async () => {
    const t = await api.signup('ti8');
    const b = await bot(t);
    const tap = (data: string) => ({
      update_id: 3,
      callback_query: {
        id: 'cq1',
        data,
        from: { id: 555, username: 'asha' },
        message: { message_id: 8, chat: { id: 555, type: 'private', first_name: 'Asha' } },
      },
    });
    expect((await push(b, tap('tqr:Yes please'))).body.note).toBe('callback_query');
    expect(asked).toEqual([{ method: 'answerCallbackQuery', args: ['cq1'] }]);
    expect((await msgs(t)).map((m: { body: string }) => m.body)).toEqual(['Yes please']);
    expect(handed.map((x) => x.kind)).toEqual(['flow', 'automate']);

    asked.length = 0;
    await push(b, tap('something-else'));
    expect(asked).toHaveLength(1);
    expect(await msgs(t)).toHaveLength(1);
  });
});

describe('TW-TG-006: payments', () => {
  it('the pre-checkout query is approved at once', async () => {
    const t = await api.signup('ti9');
    const b = await bot(t);
    const res = await push(b, {
      update_id: 4,
      pre_checkout_query: { id: 'pc1', currency: 'USD', total_amount: 4999 },
    });
    expect(res.body.note).toBe('pre_checkout_query');
    expect(asked).toEqual([{ method: 'answerPreCheckoutQuery', args: ['pc1', true] }]);
    expect(await msgs(t)).toHaveLength(0);
  });

  it('a successful payment is its own row with the facts, runs no automation, and resumes a parked flow', async () => {
    const t = await api.signup('ti10');
    const b = await bot(t);
    await push(
      b,
      message({
        successful_payment: {
          currency: 'USD',
          total_amount: 4999,
          invoice_payload: 'inv-1',
          telegram_payment_charge_id: 'tc1',
          provider_payment_charge_id: 'pc1',
        },
      }),
    );
    const [m] = await msgs(t);
    expect(m.body).toBe('Payment received: USD 49.99');
    expect(m.meta.telegram.event).toBe('successful_payment');
    expect(m.meta.payment).toMatchObject({
      currency: 'USD',
      total_amount: 4999,
      amount_display: '49.99',
      invoice_payload: 'inv-1',
      telegram_payment_charge_id: 'tc1',
    });
    expect(handed.map((x) => x.kind)).toEqual(['paid']);
    expect(handed[0]!.extra).toEqual({
      amountDisplay: '49.99',
      currency: 'USD',
      chargeId: 'tc1',
      payload: 'inv-1',
    });

    await push(b, message({ successful_payment: { currency: 'jpy', total_amount: 500 } }));
    expect((await msgs(t))[1].body).toBe('Payment received: JPY 500');
  });
});

describe('isolation', () => {
  it("a bot's messages land only in its own workspace, and another bot's secret does not open it", async () => {
    const a = await api.signup('ti11');
    const c = await api.signup('ti12');
    const ba = await bot(a);
    const bc = await bot(c);
    await push(ba, message({ text: 'for a' }));
    expect(await convs(a)).toHaveLength(1);
    expect(await convs(c)).toHaveLength(0);
    const cross = await api
      .http()
      .post(`/v2/telegram/inbound/${ba.token}`)
      .set('x-telegram-bot-api-secret-token', bc.secret)
      .send(message({ text: 'x' }));
    expect(cross.body.note).toBe('bad secret');
    expect(await msgs(a)).toHaveLength(1);
  });
});
