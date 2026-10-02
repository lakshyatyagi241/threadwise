import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  TELEGRAM_API,
  type TelegramApiFactory,
  type TelegramBotApi,
  type TelegramResult,
} from '../../../src/infra/providers/channel-telegram/telegram.port';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/** Connecting and managing Telegram bots (TW-TG-001, 002, 007), against a real Postgres and a fake Telegram. */
let h: Harness;
let api: Api;

/** What the fake Telegram was asked, and how it answers. */
const calls: Array<{ token: string; method: string; args: unknown[] }> = [];
let me: TelegramResult<{ id: number; username?: string; first_name?: string }> = { ok: true };
let hook: TelegramResult = { ok: true };

const fakeFactory: TelegramApiFactory = {
  forToken(token: string): TelegramBotApi {
    return {
      getMe: () => {
        calls.push({ token, method: 'getMe', args: [] });
        return Promise.resolve(me);
      },
      setWebhook: (url, secret) => {
        calls.push({ token, method: 'setWebhook', args: [url, secret] });
        return Promise.resolve(hook);
      },
      deleteWebhook: () => {
        calls.push({ token, method: 'deleteWebhook', args: [] });
        return Promise.resolve({ ok: true });
      },
    };
  },
};

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  h.app.get<TelegramApiFactory>(TELEGRAM_API).forToken = fakeFactory.forToken;
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

let n = 0;
const token = (id: number) => `${id}:AAH${'x'.repeat(30)}_${String(n++).padStart(4, '0')}`;
const asBot = (id: number, username = `shop${id}_bot`) => ({
  ok: true as const,
  result: { id, username, first_name: `Shop ${id}` },
});

beforeEach(() => {
  calls.length = 0;
  me = asBot(1001001);
  hook = { ok: true };
});

const post = (t: Tenant, path: string, body?: unknown) =>
  api.http().post(path).set(bearer(t.admin)).set('idempotency-key', randomUUID()).send(body);
const connect = (t: Tenant, botToken: string) => post(t, '/v2/telegram/bots', { botToken });
const list = (t: Tenant) => api.http().get('/v2/telegram/bots').set(bearer(t.admin));
const rows = async (t: Tenant) =>
  (await h.owner.query(`SELECT * FROM telegram_bots WHERE org_id = $1 ORDER BY id`, [t.orgId]))
    .rows;

describe('TW-TG-002: connect a bot', () => {
  it('validates the token, stores it encrypted, registers the webhook and never returns a secret', async () => {
    const t = await api.signup('tg1');
    const tok = token(1001001);
    const res = await connect(t, tok);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      botId: '1001001',
      username: 'shop1001001_bot',
      name: 'Shop 1001001',
      active: true,
      lastError: null,
      webhookError: null,
      hasPaymentToken: false,
    });
    expect(res.body.webhookUrl).toMatch(/^https:\/\/.+\/v2\/telegram\/inbound\/[A-Za-z0-9]{48}$/);
    expect(JSON.stringify(res.body)).not.toContain(tok);

    const [row] = await rows(t);
    expect(row.bot_token).not.toContain(tok);
    expect(row.bot_token).toMatch(/^v1:/);
    expect(row.webhook_token).toMatch(/^[A-Za-z0-9]{48}$/);
    expect(row.webhook_token).toBe(res.body.webhookUrl.split('/').pop());

    const set = calls.find((c) => c.method === 'setWebhook')!;
    expect(set.token).toBe(tok);
    expect(set.args[0]).toBe(res.body.webhookUrl);
    expect(String(set.args[1])).toMatch(/^[A-Za-z0-9]{48}$/);
    expect(row.secret_token).not.toContain(String(set.args[1]));

    expect(await api.auditCount(t.orgId, 'telegram_bots', 'insert')).toBe(1);
    expect((await api.events(t.orgId, 'telegram.bot.connected'))[0]).toMatchObject({
      username: 'shop1001001_bot',
      reconnected: false,
    });
  });

  it('the same bot pasted again updates its row: same routing token, fresh secret, active again', async () => {
    const t = await api.signup('tg2');
    const first = await connect(t, token(1001001));
    const secret1 = (await rows(t))[0].secret_token;
    await h.owner.query(
      `UPDATE telegram_bots SET active = false, last_error = 'old' WHERE org_id = $1`,
      [t.orgId],
    );
    const again = await connect(t, token(1001001));
    expect(again.status).toBe(201);
    const all = await rows(t);
    expect(all).toHaveLength(1);
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.webhookUrl).toBe(first.body.webhookUrl);
    expect(all[0].secret_token).not.toBe(secret1);
    expect(all[0]).toMatchObject({ active: true, last_error: null });
    expect((await api.events(t.orgId, 'telegram.bot.connected')).at(-1)).toMatchObject({
      reconnected: true,
    });
  });

  it('another Telegram bot is a second row, newest last', async () => {
    const t = await api.signup('tg3');
    await connect(t, token(1001001));
    me = asBot(1001002);
    await connect(t, token(1001002));
    const res = await list(t);
    expect(res.body.data.map((b: { username: string }) => b.username)).toEqual([
      'shop1001001_bot',
      'shop1001002_bot',
    ]);
  });

  it('a malformed token is refused before Telegram is asked; a rejected token saves nothing', async () => {
    const t = await api.signup('tg4');
    const bad = await connect(t, 'not-a-token');
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    expect(calls).toHaveLength(0);

    me = { ok: false, error: 'Unauthorized' };
    const rejected = await connect(t, token(1001001));
    expect(rejected.status).toBe(422);
    expect(rejected.body.code).toBe('TG_TOKEN_REJECTED');
    expect(rejected.body.detail).toContain('Unauthorized');
    expect(await rows(t)).toHaveLength(0);
  });

  it('when Telegram refuses the webhook the bot is kept, needs attention and says how to fix it', async () => {
    const t = await api.signup('tg5');
    hook = { ok: false, error: 'bad webhook: HTTPS url must be provided' };
    const res = await connect(t, token(1001001));
    expect(res.status).toBe(201);
    expect(res.body.lastError).toContain('HTTPS url must be provided');
    expect(res.body.webhookError).toContain('Saved the bot');
    expect(res.body.webhookError).toContain('tunnel');
    expect((await rows(t))[0].last_error).toContain('HTTPS url');
  });
});

describe('TW-TG-007: manage a bot', () => {
  it('"fix inbound" registers again: success clears the error and activates, failure records it', async () => {
    const t = await api.signup('tg6');
    hook = { ok: false, error: 'boom' };
    const bot = (await connect(t, token(1001001))).body;
    await h.owner.query(`UPDATE telegram_bots SET active = false WHERE org_id = $1`, [t.orgId]);

    hook = { ok: false, error: 'still down' };
    const failed = await post(t, `/v2/telegram/bots/${bot.id}/retry-webhook`);
    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({ active: false, lastError: 'still down' });
    expect(failed.body.webhookError).toContain('Re-register failed');

    hook = { ok: true };
    const ok = await post(t, `/v2/telegram/bots/${bot.id}/retry-webhook`);
    expect(ok.body).toMatchObject({ active: true, lastError: null, webhookError: null });
    // The stored token and secret are what is sent, not new ones.
    const last = calls.filter((c) => c.method === 'setWebhook').at(-1)!;
    expect(last.token).toMatch(/^1001001:AAH/);
    expect(String(last.args[1])).toMatch(/^[A-Za-z0-9]{48}$/);
  });

  it('toggle pauses and resumes, with an audit row', async () => {
    const t = await api.signup('tg7');
    const bot = (await connect(t, token(1001001))).body;
    expect((await post(t, `/v2/telegram/bots/${bot.id}/toggle`)).body.active).toBe(false);
    expect((await post(t, `/v2/telegram/bots/${bot.id}/toggle`)).body.active).toBe(true);
    expect(await api.auditCount(t.orgId, 'telegram_bots', 'update')).toBeGreaterThanOrEqual(2);
  });

  it('payment settings: a blank token keeps, a value replaces, clear removes; the token is never returned', async () => {
    const t = await api.signup('tg8');
    const bot = (await connect(t, token(1001001))).body;
    const put = (body: unknown) =>
      api.http().put(`/v2/telegram/bots/${bot.id}/payments`).set(bearer(t.admin)).send(body);

    const saved = await put({
      paymentProviderToken: '381764678:TEST:12345',
      paymentProvider: 'stripe',
    });
    expect(saved.body).toMatchObject({ hasPaymentToken: true, paymentProvider: 'stripe' });
    expect(JSON.stringify(saved.body)).not.toContain('381764678');
    const stored = (await rows(t))[0].payment_provider_token as string;
    expect(stored).toMatch(/^v1:/);

    const kept = await put({ paymentProvider: 'stripe' });
    expect(kept.body.hasPaymentToken).toBe(true);
    expect((await rows(t))[0].payment_provider_token).toBe(stored);

    const replaced = await put({ paymentProviderToken: 'another:TOKEN' });
    expect(replaced.body.hasPaymentToken).toBe(true);
    expect((await rows(t))[0].payment_provider_token).not.toBe(stored);
    expect(replaced.body.paymentProvider).toBeNull();

    const cleared = await put({ clearPaymentToken: true });
    expect(cleared.body.hasPaymentToken).toBe(false);
    expect((await rows(t))[0].payment_provider_token).toBeNull();
  });

  it('disconnect deletes the Telegram webhook and the bot, and leaves its threads', async () => {
    const t = await api.signup('tg9');
    const bot = (await connect(t, token(1001001))).body;
    const conv = await h.owner.query(
      `INSERT INTO conversations (org_id, title, channel, raw_jid) VALUES ($1,'Asha','telegram','tg:1:5') RETURNING id`,
      [t.orgId],
    );
    calls.length = 0;
    const res = await api
      .http()
      .delete(`/v2/telegram/bots/${bot.id}`)
      .set(bearer(t.admin))
      .set('idempotency-key', randomUUID());
    expect(res.status).toBe(204);
    expect(calls.map((c) => c.method)).toEqual(['deleteWebhook']);
    expect(await rows(t)).toHaveLength(0);
    expect(
      (await h.owner.query(`SELECT 1 FROM conversations WHERE id = $1`, [conv.rows[0].id])).rows,
    ).toHaveLength(1);
    expect(await api.auditCount(t.orgId, 'telegram_bots', 'delete')).toBe(1);
    expect(await api.events(t.orgId, 'telegram.bot.disconnected')).toHaveLength(1);
  });
});

describe('isolation and access', () => {
  it("another workspace's bot is not found, whatever the action", async () => {
    const a = await api.signup('tg10');
    const b = await api.signup('tg11');
    const bot = (await connect(a, token(1001001))).body;
    expect((await list(b)).body.data).toEqual([]);
    expect((await post(b, `/v2/telegram/bots/${bot.id}/toggle`)).status).toBe(404);
    expect((await post(b, `/v2/telegram/bots/${bot.id}/retry-webhook`)).status).toBe(404);
    expect(
      (await api.http().put(`/v2/telegram/bots/${bot.id}/payments`).set(bearer(b.admin)).send({}))
        .status,
    ).toBe(404);
    expect(
      (
        await api
          .http()
          .delete(`/v2/telegram/bots/${bot.id}`)
          .set(bearer(b.admin))
          .set('idempotency-key', randomUUID())
      ).status,
    ).toBe(404);
    expect(await rows(a)).toHaveLength(1);
  });

  it('listing needs tg.bots.read, managing needs tg.bots.manage, and a sign-in is required', async () => {
    const t = await api.signup('tg12');
    const viewer = await api.member(t, 'viewer', []);
    expect((await api.http().get('/v2/telegram/bots').set(bearer(viewer.token))).status).toBe(403);
    const reader = await api.member(t, 'reader', [['tg.bots.read']]);
    expect((await api.http().get('/v2/telegram/bots').set(bearer(reader.token))).status).toBe(200);
    const denied = await api
      .http()
      .post('/v2/telegram/bots')
      .set(bearer(reader.token))
      .set('idempotency-key', randomUUID())
      .send({ botToken: token(1001001) });
    expect(denied.status).toBe(403);
    expect((await api.http().get('/v2/telegram/bots')).status).toBe(401);
  });
});
