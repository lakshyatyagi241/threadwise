import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  TELEGRAM_API,
  type TelegramApiFactory,
  type TelegramBotApi,
} from '../../../src/infra/providers/channel-telegram/telegram.port';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { textXml } from '../../support/wechat-crypto';
import {
  connectChannel,
  deliver,
  delivery,
  FakeLine,
  textEvent,
  userId,
} from '../channel-line/support';
import {
  connect as connectViber,
  installFake as installViber,
  push as pushViber,
  resetFake as resetViber,
  textEvent as viberEvent,
} from '../channel-viber/support';
import {
  connect as connectWechat,
  installFakeWechat,
  push as pushWechat,
} from '../channel-wechat/support';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';
import { ROUNDS, race, statuses } from './support';

/**
 * QA Sheet3 #15, CC-WHK-02: the inbound webhooks of the channels the first suite did not touch (LINE, WeChat, Viber, Telegram). The
 * provider delivers the same message several times at once, as providers do when they do not see our answer in time. One effect per
 * message id: one stored message, one thread, one contact. A forged delivery repeated at once writes nothing.
 */
let h: Harness;
let api: Api;
const line = new FakeLine();
beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  line.install(h);
  installFakeWechat(h);
  installViber(h);
  const fake: TelegramBotApi = {
    getMe: () =>
      Promise.resolve({
        ok: true,
        result: { id: 7000001, username: 'shop_bot', first_name: 'Shop' },
      }),
    setWebhook: () => Promise.resolve({ ok: true }),
    deleteWebhook: () => Promise.resolve({ ok: true }),
    answerCallbackQuery: () => Promise.resolve({ ok: true }),
    answerPreCheckoutQuery: () => Promise.resolve({ ok: true }),
    downloadFile: () => Promise.resolve(null),
    getUserProfilePhoto: () => Promise.resolve(null),
    sendMessage: () => Promise.resolve({ ok: true, result: { message_id: 1 } }),
    sendMedia: () => Promise.resolve({ ok: true, result: { message_id: 2 } }),
  };
  h.app.get<TelegramApiFactory>(TELEGRAM_API).forToken = () => fake;
}, 240_000);
afterAll(async () => {
  await h?.stop();
});

const count = async (t: Tenant, table: 'messages' | 'conversations' | 'contacts') =>
  Number(
    (await h.owner.query(`SELECT count(*)::int AS n FROM ${table} WHERE org_id = $1`, [t.orgId]))
      .rows[0].n,
  );
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

describe('CC-WHK-02 the same delivery, many times at once', () => {
  it('LINE: one event delivered 8 times (and a forged one 8 times) stores one message', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const t = await api.signup('wl');
      const c = await connectChannel(h, api, line, t);
      const body = delivery(textEvent(userId(round + 1), 'hello'));
      const res = await race(8, () => deliver(api, c, body));
      for (const r of res) expect(r.status, JSON.stringify(r.body)).toBeLessThan(500);
      await settle();
      expect(await count(t, 'messages'), JSON.stringify(statuses(res))).toBe(1);
      expect(await count(t, 'conversations')).toBe(1);
      const forged = await race(8, () =>
        deliver(api, c, delivery(textEvent(userId(99), 'forged')), { secret: 'not-the-secret' }),
      );
      for (const r of forged) expect(r.status).toBe(401);
      await settle(150);
      expect(await count(t, 'messages')).toBe(1);
    }
  });

  it('WeChat: one message id delivered 8 times stores one message', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const t = await api.signup('ww');
      const a = await connectWechat(api, h, t);
      const xml = textXml({ openid: `openid-${round}`, content: 'hello', msgId: 5000 + round });
      const res = await race(8, () => pushWechat(api, a, xml));
      for (const r of res) expect(r.status, JSON.stringify(r.body)).toBeLessThan(500);
      await settle(600);
      expect(await count(t, 'messages'), JSON.stringify(statuses(res))).toBe(1);
      expect(await count(t, 'conversations')).toBe(1);
    }
  });

  it('Viber: one event delivered 8 times stores one message', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      resetViber();
      const t = await api.signup('wv');
      const c = await connectViber(api, h, t);
      const event = viberEvent(`viber-user-${round}`, 'hello');
      const res = await race(8, () => pushViber(api, c, event));
      for (const r of res) expect(r.status, JSON.stringify(r.body)).toBeLessThan(500);
      await settle();
      expect(await count(t, 'messages'), JSON.stringify(statuses(res))).toBe(1);
      expect(await count(t, 'conversations')).toBe(1);
    }
  });

  it('Telegram: one update delivered 8 times stores one message; a wrong secret 8 times writes nothing', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const t = await api.signup('wt');
      const id = 7100000 + round * 10 + Math.floor(Math.random() * 9);
      const created = await api
        .http()
        .post('/v2/telegram/bots')
        .set(bearer(t.admin))
        .set('idempotency-key', randomUUID())
        .send({ botToken: `${id}:AAH${'x'.repeat(30)}_${round}` });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const row = (
        await h.owner.query(`SELECT id, webhook_token FROM telegram_bots WHERE uuid = $1`, [
          created.body.id,
        ])
      ).rows[0];
      const secret = `S${round}`.padEnd(48, 'S');
      await h.owner.query(`UPDATE telegram_bots SET secret_token = $2 WHERE id = $1`, [
        row.id,
        h.app.get(CryptoService).encrypt(secret),
      ]);
      const update = {
        update_id: 1,
        message: {
          message_id: 4242,
          chat: { id: 555, type: 'private', first_name: 'Asha' },
          from: { id: 555, username: 'asha', first_name: 'Asha' },
          date: 1,
          text: 'hello',
        },
      };
      const send = (s: string) =>
        api
          .http()
          .post(`/v2/telegram/inbound/${row.webhook_token}`)
          .set('x-telegram-bot-api-secret-token', s)
          .send(update);
      const res = await race(8, () => send(secret));
      for (const r of res) expect(r.status, JSON.stringify(r.body)).toBeLessThan(500);
      expect(await count(t, 'messages'), JSON.stringify(statuses(res))).toBe(1);
      expect(await count(t, 'conversations')).toBe(1);
      const forged = await race(8, () => send('wrong'));
      for (const r of forged) expect(r.body.note).toBe('bad secret');
      expect(await count(t, 'messages')).toBe(1);
    }
  });
});
