import { createHmac, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import {
  VIBER_API,
  type ViberAccountInfo,
  type ViberApiFactory,
  type ViberBotApi,
  type ViberBroadcastData,
  type ViberMessage,
  type ViberResult,
  type ViberSendData,
  type ViberSender,
} from '../../../src/infra/providers/channel-viber/viber.port';
import { Api, bearer, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/** What the fake Viber was asked. */
export interface Call {
  token: string;
  sender: ViberSender | undefined;
  method: 'getAccountInfo' | 'setWebhook' | 'removeWebhook' | 'sendMessage' | 'broadcast';
  /** The receiver (send) or the receivers (broadcast) or the webhook address. */
  to?: string | readonly string[];
  message?: ViberMessage;
}

/** How the fake Viber answers; every test resets it. */
export interface Fake {
  calls: Call[];
  account: ViberResult<ViberAccountInfo>;
  hook: ViberResult;
  send: (to: string, message: ViberMessage) => ViberResult<ViberSendData>;
  broadcast: (to: readonly string[], message: ViberMessage) => ViberResult<ViberBroadcastData>;
}

let tokenSeq = 7_000_000_000_000_000_000n;

export const fake: Fake = {
  calls: [],
  account: { ok: true, status: 0 },
  hook: { ok: true, status: 0 },
  send: () => ({ ok: true, status: 0, data: { message_token: String(tokenSeq++) } }),
  broadcast: () => ({
    ok: true,
    status: 0,
    data: { message_token: String(tokenSeq++), failed_list: [] },
  }),
};

export function resetFake(
  account: ViberAccountInfo = {
    id: 'acc-1',
    name: 'Shop',
    uri: 'shop',
    icon: 'https://cdn.viber.com/i.png',
  },
): void {
  fake.calls.length = 0;
  fake.account = { ok: true, status: 0, data: account };
  fake.hook = { ok: true, status: 0 };
  fake.send = () => ({ ok: true, status: 0, data: { message_token: String(tokenSeq++) } });
  fake.broadcast = () => ({
    ok: true,
    status: 0,
    data: { message_token: String(tokenSeq++), failed_list: [] },
  });
}

/** Binds the fake in place of Viber's REST API. */
export function installFake(h: Harness): void {
  h.app.get<ViberApiFactory>(VIBER_API).forToken = (token, sender): ViberBotApi => ({
    getAccountInfo: () => {
      fake.calls.push({ token, sender, method: 'getAccountInfo' });
      return Promise.resolve(fake.account);
    },
    setWebhook: (url) => {
      fake.calls.push({ token, sender, method: 'setWebhook', to: url });
      return Promise.resolve(fake.hook);
    },
    removeWebhook: () => {
      fake.calls.push({ token, sender, method: 'removeWebhook' });
      return Promise.resolve({ ok: true, status: 0 });
    },
    sendMessage: (to, message) => {
      fake.calls.push({ token, sender, method: 'sendMessage', to, message });
      return Promise.resolve(fake.send(to, message));
    },
    broadcast: (to, message) => {
      fake.calls.push({ token, sender, method: 'broadcast', to, message });
      return Promise.resolve(fake.broadcast(to, message));
    },
  });
}

let seq = 0;
/** An auth token a test pastes (at least 20 characters, unique). */
export const authToken = (): string => `tok-${seq++}-${'a1b2c3d4e5f6'.repeat(3)}`;

export interface Channel {
  rowId: number;
  /** The auth token that signs the webhook. */
  token: string;
  routing: string;
  uuid: string;
}

/** Connects a channel through the API. `viberId` makes it a different Viber account. */
export async function connect(
  api: Api,
  h: Harness,
  t: Tenant,
  viberId = `acc-${seq++}`,
  name = 'Shop',
): Promise<Channel> {
  const token = authToken();
  fake.account = {
    ok: true,
    status: 0,
    data: { id: viberId, name, uri: `u-${viberId}`, icon: 'https://cdn.viber.com/i.png' },
  };
  const res = await api
    .http()
    .post('/v2/viber/channels')
    .set(bearer(t.admin))
    .set('idempotency-key', randomUUID())
    .send({ authToken: token });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const row = (
    await h.owner.query(`SELECT id, webhook_token FROM viber_channels WHERE uuid = $1`, [
      res.body.id,
    ])
  ).rows[0];
  return {
    rowId: Number(row.id),
    token,
    routing: row.webhook_token as string,
    uuid: res.body.id as string,
  };
}

/** Viber's signature of a body. */
export const sign = (raw: string, key: string): string =>
  createHmac('sha256', key).update(raw).digest('hex');

/** Viber pushes an event: the body is signed with the channel's auth token unless told otherwise. */
export function push(
  api: Api,
  c: Pick<Channel, 'routing' | 'token'>,
  event: object,
  opts: { signWith?: string; signature?: string | null } = {},
) {
  // A message token travels as a bare 64 bit number, as Viber writes it.
  const raw = JSON.stringify(event).replace(/"@@(\d+)@@"/g, '$1');
  const signature =
    opts.signature === undefined ? sign(raw, opts.signWith ?? c.token) : opts.signature;
  const req = api
    .http()
    .post(`/v2/viber/inbound/${c.routing}`)
    .set('content-type', 'application/json');
  return (signature === null ? req : req.set('x-viber-content-signature', signature)).send(raw);
}

let tok = 100_000_000_000_000_000n;
/** A text message from a Viber user. Each call carries a new message token (a big one, as Viber's are). */
export const textEvent = (
  userId: string,
  text: string,
  name: string | null = 'Asha',
  token = String(tok++),
) => ({
  event: 'message',
  timestamp: 1_700_000_000_000,
  // The token is written as a bare number, as Viber does.
  message_token: `@@${token}@@`,
  sender: { id: userId, ...(name ? { name } : {}), avatar: 'https://cdn.viber.com/a.jpg' },
  message: { type: 'text', text },
});
