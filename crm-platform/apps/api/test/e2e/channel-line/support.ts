import { createHmac, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import {
  LINE_API,
  type LineApi,
  type LineApiFactory,
  type LineBotInfo,
  type LineIssuedToken,
  type LineMessage,
  type LineProfile,
  type LineResult,
  type LineSent,
} from '../../../src/infra/providers/channel-line/line.port';
import { Api, bearer, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/** One call the fake LINE was asked for. */
export interface Call {
  token: string;
  method: 'botInfo' | 'setWebhookEndpoint' | 'reply' | 'push' | 'getProfile' | 'getMessageContent';
  args: unknown[];
}

const ok = <T>(data?: T): LineResult<T> => ({ ok: true, status: 200, ...(data ? { data } : {}) });

/** A stand-in for LINE: records what it was asked and answers what a test says. Nothing here talks to the real LINE. */
export class FakeLine {
  calls: Call[] = [];
  issued: string[] = [];
  info!: LineResult<LineBotInfo>;
  hook!: LineResult;
  push!: (to: string, messages: readonly LineMessage[]) => LineResult<LineSent>;
  reply!: (token: string, messages: readonly LineMessage[]) => LineResult<LineSent>;
  profile!: (userId: string) => LineResult<LineProfile>;
  content!: (messageId: string) => { bytes: Uint8Array; mime: string } | null;
  issue!: (jwt: string) => LineResult<LineIssuedToken>;

  constructor() {
    this.reset();
  }

  /** Back to "LINE accepts everything": call between tests. */
  reset(): void {
    this.calls = [];
    this.issued = [];
    this.info = ok({
      userId: 'Ubotuser000000000000000000000001',
      basicId: '@shop',
      displayName: 'Shop OA',
      pictureUrl: 'https://profile.example.com/oa.png',
    });
    this.hook = ok();
    this.push = () => ok({ sentMessages: [{ id: '5001' }] });
    this.reply = () => ok({ sentMessages: [{ id: '6001' }] });
    this.profile = (userId) =>
      ok({
        displayName: `Name ${userId.slice(-3)}`,
        pictureUrl: `https://p.example.com/${userId}.png`,
      });
    this.content = () => null;
    this.issue = () =>
      ok({ accessToken: 'rotated-token-0001', keyId: 'key-id-1', expiresIn: 2_592_000 });
  }

  of(method: Call['method']): Call[] {
    return this.calls.filter((c) => c.method === method);
  }

  private api(token: string): LineApi {
    const rec = (method: Call['method'], ...args: unknown[]) =>
      this.calls.push({ token, method, args });
    return {
      botInfo: () => {
        rec('botInfo');
        return Promise.resolve(this.info);
      },
      setWebhookEndpoint: (url) => {
        rec('setWebhookEndpoint', url);
        return Promise.resolve(this.hook);
      },
      reply: (replyToken, messages) => {
        rec('reply', replyToken, messages);
        return Promise.resolve(this.reply(replyToken, messages));
      },
      push: (to, messages) => {
        rec('push', to, messages);
        return Promise.resolve(this.push(to, messages));
      },
      getProfile: (userId) => {
        rec('getProfile', userId);
        return Promise.resolve(this.profile(userId));
      },
      getMessageContent: (id) => {
        rec('getMessageContent', id);
        return Promise.resolve(this.content(id));
      },
    };
  }

  /** Swaps the real LINE client of the running app for this fake. */
  install(h: Harness): void {
    const factory = h.app.get<LineApiFactory>(LINE_API);
    factory.forToken = (token) => this.api(token);
    factory.issueRotatingToken = (jwt) => {
      this.issued.push(jwt);
      return Promise.resolve(this.issue(jwt));
    };
  }
}

export const secretOf = (n: number) => `channel-secret-${String(n).padStart(8, '0')}`;
export const tokenOf = (n: number) => `access-token-${String(n).padStart(10, '0')}-abcdefghij`;

/** `X-Line-Signature` for a raw body. */
export const sign = (secret: string, raw: string) =>
  createHmac('sha256', secret).update(raw).digest('base64');

export interface Connected {
  rowId: number;
  uuid: string;
  webhookToken: string;
  secret: string;
  accessToken: string;
  basicId: string;
}

let counter = 0;

/** Connects a channel through the API (the fake LINE answers as `basicId`); returns what a test needs to push events to it. */
export async function connectChannel(
  h: Harness,
  api: Api,
  fake: FakeLine,
  t: Tenant,
  basicId = `@oa${counter}`,
): Promise<Connected> {
  const n = counter++;
  fake.info = ok({
    userId: `Ubot${String(n).padStart(28, '0')}`,
    basicId,
    displayName: `Shop ${n}`,
    pictureUrl: 'https://profile.example.com/oa.png',
  });
  const accessToken = tokenOf(n);
  const secret = secretOf(n);
  const res = await api
    .http()
    .post('/v2/line/channels')
    .set(bearer(t.admin))
    .set('idempotency-key', randomUUID())
    .send({ channelAccessToken: accessToken, channelSecret: secret });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const row = (
    await h.owner.query(`SELECT id, webhook_token FROM line_channels WHERE uuid = $1`, [
      res.body.id,
    ])
  ).rows[0];
  return {
    rowId: Number(row.id),
    uuid: res.body.id as string,
    webhookToken: row.webhook_token as string,
    secret,
    accessToken,
    basicId,
  };
}

/** Pushes a LINE delivery to a channel's webhook, signed (or not) over the exact bytes sent. */
export function deliver(
  api: Api,
  c: Pick<Connected, 'webhookToken' | 'secret'>,
  body: object,
  opts: { secret?: string | null } = {},
) {
  const raw = JSON.stringify(body);
  const req = api
    .http()
    .post(`/v2/line/inbound/${c.webhookToken}`)
    .set('content-type', 'application/json');
  const secret = opts.secret === undefined ? c.secret : opts.secret;
  if (secret !== null) req.set('x-line-signature', sign(secret, raw));
  return req.send(raw);
}

let eventNo = 0;
/** A text message event from a LINE user. */
export const textEvent = (userId: string, text: string, extra: Record<string, unknown> = {}) => {
  const n = ++eventNo;
  return {
    type: 'message',
    mode: 'active',
    timestamp: 1_700_000_000_000 + n,
    source: { type: 'user', userId },
    webhookEventId: `WE${n}`,
    replyToken: `reply-token-${n}`,
    message: { type: 'text', id: `msg${1000 + n}`, text },
    ...extra,
  };
};
export const delivery = (...events: object[]) => ({
  destination: 'Ubot00000000000000000000000000000',
  events,
});

/** A LINE user id (U + 32 hex), distinct for each n. */
export const userId = (n: number) => `U${String(n).padStart(32, '0')}`;
