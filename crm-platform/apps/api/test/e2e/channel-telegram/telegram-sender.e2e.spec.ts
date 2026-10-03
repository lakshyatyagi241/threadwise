import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  TELEGRAM_API,
  type MediaKind,
  type MediaSource,
  type SendOptions,
  type TelegramApiFactory,
  type TelegramBotApi,
  type TelegramResult,
  type SentMessage,
} from '../../../src/infra/providers/channel-telegram/telegram.port';
import { TelegramSenderService } from '../../../src/modules/channel-telegram/telegram-sender.service';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/** A reply in a Telegram thread (WD-TG-008, 009): the bot named in the thread key sends it. Real Postgres, fake Telegram. */
let h: Harness;
let api: Api;
let sender: TelegramSenderService;

interface Call {
  token: string;
  method: string;
  chat: string;
  text?: string;
  kind?: MediaKind;
  source?: MediaSource;
  caption?: string | null;
  opts?: SendOptions;
}
const calls: Call[] = [];
let answer: TelegramResult<SentMessage> = { ok: true, result: { message_id: 41 } };

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  sender = h.app.get(TelegramSenderService);
  h.app.get<TelegramApiFactory>(TELEGRAM_API).forToken = (token) =>
    ({
      getMe: () =>
        Promise.resolve({
          ok: true,
          result: { id: Number(token.split(':')[0]), username: 'b_bot', first_name: 'B' },
        }),
      setWebhook: () => Promise.resolve({ ok: true }),
      deleteWebhook: () => Promise.resolve({ ok: true }),
      sendMessage: (chat: string, text: string, opts?: SendOptions) => {
        calls.push({ token, method: 'sendMessage', chat, text, opts });
        return Promise.resolve(answer);
      },
      sendMedia: (
        chat: string,
        kind: MediaKind,
        source: MediaSource,
        caption?: string | null,
        opts?: SendOptions,
      ) => {
        calls.push({ token, method: 'sendMedia', chat, kind, source, caption, opts });
        return Promise.resolve(answer);
      },
    }) as unknown as TelegramBotApi;
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  calls.length = 0;
  answer = { ok: true, result: { message_id: 41 } };
});

let n = 0;
async function bot(t: Tenant) {
  const id = 8000000 + n++;
  const token = `${id}:AAH${'y'.repeat(30)}_${n}`;
  const res = await api
    .http()
    .post('/v2/telegram/bots')
    .set(bearer(t.admin))
    .set('idempotency-key', randomUUID())
    .send({ botToken: token });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const row = (await h.owner.query(`SELECT id FROM telegram_bots WHERE uuid = $1`, [res.body.id]))
    .rows[0];
  return { rowId: Number(row.id), token, uuid: res.body.id as string };
}

describe('WD-TG-008: a reply leaves from the bot that carried the thread', () => {
  it('uses the bot in the thread key, with its own token, to the chat in the key', async () => {
    const t = await api.signup('ts1');
    const a = await bot(t);
    const b = await bot(t);
    const out = await sender.reply(t.orgId, { botRowId: b.rowId, chatId: '555', text: 'Hello' });
    expect(out).toEqual({ ok: true, providerMessageId: '41', fileId: null, error: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      token: b.token,
      method: 'sendMessage',
      chat: '555',
      text: 'Hello',
    });
    expect(calls[0]!.token).not.toBe(a.token);
    // A group's chat id is negative and still the last segment.
    await sender.reply(t.orgId, { botRowId: a.rowId, chatId: '-100123', text: 'to the group' });
    expect(calls[1]).toMatchObject({ token: a.token, chat: '-100123' });
  });

  it("a disconnected bot and another workspace's bot both fail without a Telegram call", async () => {
    const t = await api.signup('ts2');
    const u = await api.signup('ts2b');
    const gone = await bot(t);
    const other = await bot(u);
    await api
      .http()
      .delete(`/v2/telegram/bots/${gone.uuid}`)
      .set(bearer(t.admin))
      .set('idempotency-key', randomUUID());
    expect(
      await sender.reply(t.orgId, { botRowId: gone.rowId, chatId: '5', text: 'x' }),
    ).toMatchObject({
      ok: false,
      error: 'Telegram bot not connected',
    });
    expect(
      await sender.reply(t.orgId, { botRowId: other.rowId, chatId: '5', text: 'x' }),
    ).toMatchObject({ ok: false, error: 'Telegram bot not connected' });
    expect(calls).toHaveLength(0);
  });

  it('Telegram refusing the send comes back as the reason, not an exception', async () => {
    const t = await api.signup('ts4');
    const b = await bot(t);
    answer = { ok: false, error: 'Forbidden: bot was blocked by the user' };
    expect(await sender.reply(t.orgId, { botRowId: b.rowId, chatId: '5', text: 'x' })).toEqual({
      ok: false,
      providerMessageId: null,
      fileId: null,
      error: 'Forbidden: bot was blocked by the user',
    });
  });
});

describe('WD-TG-009: template buttons ride along', () => {
  it('buttons become the keyboard and a phone button is added under the text', async () => {
    const t = await api.signup('ts5');
    const b = await bot(t);
    await sender.reply(t.orgId, {
      botRowId: b.rowId,
      chatId: '5',
      text: 'Offer ends today',
      buttons: [
        { type: 'url', text: 'Shop', url: 'https://x.test' },
        { type: 'quick_reply', text: 'Yes' },
        { type: 'phone_number', text: 'Call', phone_number: '+91 98' },
      ],
    });
    expect(calls[0]!.text).toBe('Offer ends today\n📞 Call: +91 98');
    expect(calls[0]!.opts?.replyMarkup).toEqual({
      inline_keyboard: [
        [{ text: 'Shop', url: 'https://x.test' }],
        [{ text: 'Yes', callback_data: 'tqr:Yes' }],
      ],
    });
  });
});

describe('media in a reply', () => {
  it('a file read from the inbox store goes up as bytes, with no caption when the text is empty', async () => {
    const t = await api.signup('ts7');
    const b = await bot(t);
    await sender.reply(t.orgId, {
      botRowId: b.rowId,
      chatId: '5',
      text: '',
      media: {
        kind: 'document',
        source: { bytes: new Uint8Array([1, 2, 3]), filename: 'abc.pdf' },
      },
    });
    expect(calls[0]!.source).toEqual({ bytes: new Uint8Array([1, 2, 3]), filename: 'abc.pdf' });
    expect(calls[0]!.caption).toBeNull();
  });

  it('a file is sent from its address, or from its bytes, and the text is the caption', async () => {
    const t = await api.signup('ts6');
    const b = await bot(t);
    await sender.reply(t.orgId, {
      botRowId: b.rowId,
      chatId: '5',
      text: 'Look',
      media: { kind: 'image', source: { url: 'https://cdn.example.com/a.png' } },
    });
    expect(calls[0]).toMatchObject({
      method: 'sendMedia',
      kind: 'image',
      source: { url: 'https://cdn.example.com/a.png' },
      caption: 'Look',
    });
  });
});
