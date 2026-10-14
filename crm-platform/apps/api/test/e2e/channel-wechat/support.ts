import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import {
  WECHAT_API,
  type WechatApi,
  type WechatResult,
} from '../../../src/infra/providers/channel-wechat/wechat.port';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { ChannelRegistryService } from '../../../src/modules/chat-conversations';
import { sha1Sorted } from '../../support/wechat-crypto';
import { bearer, type Api, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/** One call the fake WeChat was asked to make. */
export interface Call {
  method: keyof WechatApi;
  args: unknown[];
}

const ok = <T>(data: T): WechatResult<T> => ({ ok: true, data, errcode: null, error: null });
export const refused = <T>(errcode: number, errmsg: string, data = {} as T): WechatResult<T> => ({
  ok: false,
  data,
  errcode,
  error: `${errcode} ${errmsg}`,
});

/** What the fake answers; a test replaces a member for the length of one case, `reset()` puts them all back. */
export interface Fake {
  calls: Call[];
  answers: {
    [K in keyof WechatApi]: (...args: Parameters<WechatApi[K]>) => ReturnType<WechatApi[K]>;
  };
  reset(): void;
}

let tokenSeq = 0;
const defaults = (): Fake['answers'] => ({
  fetchAccessToken: () =>
    Promise.resolve(ok({ accessToken: `access-${++tokenSeq}`, expiresIn: 7200 })),
  sendCustomMessage: () => Promise.resolve(ok({})),
  sendTemplate: () => Promise.resolve(ok({ msgid: 1 })),
  massSend: () => Promise.resolve(ok({ msg_id: 4001 })),
  massSendAll: () => Promise.resolve(ok({ msg_id: 4002 })),
  getUserInfo: () =>
    Promise.resolve(ok({ nickname: 'Mei', headimgurl: 'https://thirdwx.qlogo.cn/mei.png' })),
  uploadMedia: () => Promise.resolve(ok({ media_id: 'media-1' })),
  getMedia: () =>
    Promise.resolve({
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      mime: 'image/png',
    }),
});

/** Replaces the real HTTP client (the bound `WECHAT_API`) with a recorder. Nothing in these tests reaches WeChat. */
export function installFakeWechat(h: Harness): Fake {
  const fake: Fake = { calls: [], answers: defaults(), reset: () => undefined };
  fake.reset = () => {
    fake.calls.length = 0;
    fake.answers = defaults();
  };
  const real = h.app.get<WechatApi>(WECHAT_API);
  for (const method of Object.keys(fake.answers) as Array<keyof WechatApi>) {
    (real as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
      fake.calls.push({ method, args });
      return (fake.answers[method] as (...a: unknown[]) => unknown)(...args);
    };
  }
  return fake;
}

export interface Account {
  uuid: string;
  rowId: number;
  webhookToken: string;
  /** The Token the person chose in the WeChat console. */
  verifyToken: string;
  appId: string;
  encodingAesKey?: string;
}

let n = 0;
export const connectBody = (
  over: Record<string, unknown> = {},
): { appId: string; appSecret: string; verifyToken: string; accountName: string } & Record<
  string,
  unknown
> => {
  n += 1;
  return {
    appId: `wx${String(n).padStart(6, '0')}abcdef`,
    appSecret: `secret-${n}-0123456789abcdef`,
    verifyToken: `token${n}`,
    accountName: `Shop ${n}`,
    ...over,
  };
};

export const post = (api: Api, t: Tenant, path: string, body?: object) =>
  api
    .http()
    .post(path)
    .set(bearer(t.admin))
    .set('idempotency-key', randomUUID())
    .send(body ?? {});

/** Connects an account through the API and reads back what the tests need from the row. */
export async function connect(
  api: Api,
  h: Harness,
  t: Tenant,
  over: Record<string, unknown> = {},
): Promise<Account> {
  const body = connectBody(over);
  const res = await post(api, t, '/v2/wechat/channels', body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const row = (
    await h.owner.query(`SELECT id, webhook_token FROM wechat_channels WHERE uuid = $1`, [
      res.body.id,
    ])
  ).rows[0];
  return {
    uuid: res.body.id as string,
    rowId: Number(row.id),
    webhookToken: row.webhook_token as string,
    verifyToken: body.verifyToken,
    appId: body.appId,
    encodingAesKey: body.encodingAesKey as string | undefined,
  };
}

export const signed = (verifyToken: string, timestamp = '1700000000', nonce = 'nonce1') => ({
  timestamp,
  nonce,
  signature: sha1Sorted(verifyToken, timestamp, nonce),
});

/** WeChat posts a message: signed on the query string, XML in the body. */
export function push(
  api: Api,
  a: Pick<Account, 'webhookToken' | 'verifyToken'>,
  xml: string,
  query: Record<string, string> = signed(a.verifyToken),
) {
  return api
    .http()
    .post(`/v2/wechat/inbound/${a.webhookToken}`)
    .query(query)
    .set('content-type', 'text/xml')
    .send(xml);
}

/** The ChannelRuntime of the account's inbox channel, as the dispatcher sees it. */
export async function runtimeOf(h: Harness, t: Tenant, a: Account) {
  const svc = h.app.get(ChannelRegistryService);
  const uuid = (
    await h.owner.query(
      `SELECT uuid FROM channels WHERE org_id = $1 AND kind = 'wechat' AND external_id = $2`,
      [t.orgId, String(a.rowId)],
    )
  ).rows[0].uuid as string;
  return RequestContextStore.run(
    {
      requestId: 'wechat-test',
      orgId: t.orgId,
      actorType: 'user',
      actorId: t.adminUserId,
      userId: t.adminUserId,
    },
    () =>
      h.app
        .get(DatabaseService)
        .tx(async (tx) => svc.runtime(tx, t.orgId, await svc.row(tx, t.orgId, uuid))),
  );
}

export const decrypt = (h: Harness, v: string): string => h.app.get(CryptoService).decrypt(v);
