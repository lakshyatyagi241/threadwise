import { Readable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChannelDispatcher, ChannelAdapterRegistry } from '../../../src/modules/chat-conversations';
import { AppError } from '../../../src/common/errors/app-error';
import { ChannelError, type ChannelRuntime } from '../../../src/infra/providers/chat-conversations';
import { WechatChannelAdapter } from '../../../src/modules/channel-wechat/wechat-channel.adapter';
import { Api, startHarness, type Harness } from '../contacts-attributes-tags/support';
import { textXml } from '../../support/wechat-crypto';
import {
  connect,
  decrypt,
  installFakeWechat,
  push,
  refused,
  runtimeOf,
  type Fake,
} from './support';

/** A reply typed in the inbox leaves through the Official Account that carried the thread (WECH): the 48 hour window, the token, the templates. */
let h: Harness;
let api: Api;
let wechat: Fake;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  wechat = installFakeWechat(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => wechat.reset());

/** The follower's first message asks WeChat for a profile in the background; it can land during a case. */
const BACKGROUND = ['fetchAccessToken', 'getUserInfo'];
const dispatcher = () => h.app.get(ChannelDispatcher);
const SERVICE = { purpose: 'service_messaging' as const };
const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);
let ref = 0;
const text = (to: string, body = 'hello') => ({
  kind: 'text',
  to,
  clientReference: `wx-ref-${++ref}-${Date.now()}`,
  body,
});

/** An account with one follower who has written, and the runtime the dispatcher sends through. */
async function setup(label: string) {
  const t = await api.signup(label);
  const a = await connect(api, h, t);
  const openid = `oFollower_${label}`;
  await push(api, a, textXml({ openid, content: 'hi', msgId: ref + 100000 }));
  const runtime = await runtimeOf(h, t, a);
  const contactId = Number(
    (
      await h.owner.query(
        `SELECT id FROM contacts WHERE org_id = $1 AND channel = 'wechat' AND channel_uid = $2`,
        [t.orgId, openid],
      )
    ).rows[0].id,
  );
  return { t, a, openid, runtime, contactId };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const send = (c: Ctx, envelope: object, lastInboundAt: Date | null = hoursAgo(1)) =>
  dispatcher().send({
    channel: c.runtime,
    envelope,
    lastInboundAt,
    consent: { ...SERVICE, contactId: c.contactId },
  });
const sendCalls = () => wechat.calls.filter((x) => x.method === 'sendCustomMessage');

describe('WECH send: a customer-service message inside the 48 hour window', () => {
  it('the adapter is registered for the kind, reports a 48 hour window and templates', async () => {
    const adapter = h.app.get(ChannelAdapterRegistry).for('wechat');
    expect(adapter).toBe(h.app.get(WechatChannelAdapter));
    expect(adapter.live).toBe(true);
    const c = await setup('ws0');
    expect(adapter.capabilities(c.runtime)).toMatchObject({
      windowHours: 48,
      templates: true,
      media: ['image', 'audio', 'video'],
    });
    const last = new Date('2026-03-10T12:00:00Z');
    expect(adapter.windowInfo(c.runtime, last, new Date('2026-03-12T11:59:00Z')).open).toBe(true);
    expect(adapter.windowInfo(c.runtime, last, new Date('2026-03-12T12:01:00Z')).open).toBe(false);
    expect(adapter.windowInfo(c.runtime, null, last)).toEqual({ open: false, expiresAt: null });
  });

  it("sends the text to the follower in the thread key with the account's own token", async () => {
    const c = await setup('ws1');
    const out = await send(c, text(c.openid, 'Hello 你好'));
    expect(out.providerMessageId).toMatch(/^wx:wx-ref-/);
    expect(sendCalls()).toHaveLength(1);
    const [token, to, message] = sendCalls()[0]!.args as [string, string, unknown];
    expect(token).toMatch(/^access-/);
    expect(to).toBe(c.openid);
    expect(message).toEqual({ msgtype: 'text', text: { content: 'Hello 你好' } });
  });

  it('one client reference is one send (a retry is not sent twice)', async () => {
    const c = await setup('ws2');
    const env = text(c.openid);
    const first = await send(c, env);
    const again = await send(c, env);
    expect(again).toMatchObject({ providerMessageId: first.providerMessageId, replayed: true });
    expect(sendCalls()).toHaveLength(1);
  });

  it('a text longer than WeChat takes is cut to its 2048 characters, as Reference does', async () => {
    const c = await setup('ws3');
    await send(c, text(c.openid, '你'.repeat(2100)));
    const message = sendCalls()[0]!.args[2] as { text: { content: string } };
    expect(message.text.content).toBe('你'.repeat(2048));
  });
});

describe('WECH send: outside the window only a template message is allowed', () => {
  it('a free-form message after 48 hours, or before the follower ever wrote, is refused before WeChat is called', async () => {
    const c = await setup('ws4');
    for (const last of [hoursAgo(49), null]) {
      const err = await send(c, text(c.openid), last).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('SERVICE_WINDOW_CLOSED');
    }
    expect(wechat.calls.filter((x) => !BACKGROUND.includes(x.method))).toHaveLength(0);
  });

  it("a template message goes out through WeChat's template API with the keywords as data", async () => {
    const c = await setup('ws5');
    await h.owner.query(
      `INSERT INTO wa_templates (org_id, template_name, template_body, channel, category) VALUES ($1, 'TPL_ID_42', 'x', 'wechat', 'utility')`,
      [c.t.orgId],
    );
    await send(
      c,
      {
        kind: 'template',
        to: c.openid,
        clientReference: `tpl-${Date.now()}`,
        template: {
          name: 'TPL_ID_42',
          language: 'en',
          variables: { keyword1: 'Order 77', keyword2: 'Shipped', url: 'https://shop.test/o/77' },
        },
      },
      hoursAgo(100),
    );
    const call = wechat.calls.find((x) => x.method === 'sendTemplate')!;
    const [token, to, templateId, data, url] = call.args as [
      string,
      string,
      string,
      object,
      string,
    ];
    expect(token).toMatch(/^access-/);
    expect(to).toBe(c.openid);
    expect(templateId).toBe('TPL_ID_42');
    expect(data).toEqual({ keyword1: { value: 'Order 77' }, keyword2: { value: 'Shipped' } });
    expect(url).toBe('https://shop.test/o/77');
    expect(sendCalls()).toHaveLength(0);
  });
});

describe("WECH send: the account must be connected, and WeChat's refusals are told apart", () => {
  it('a paused or removed account sends nothing', async () => {
    const c = await setup('ws6');
    await h.owner.query(`UPDATE wechat_channels SET active = false WHERE id = $1`, [c.a.rowId]);
    const paused = await send(c, text(c.openid)).catch((e: unknown) => e);
    expect(paused).toBeInstanceOf(ChannelError);
    expect((paused as ChannelError).code).toBe('CHANNEL_DISCONNECTED');
    await h.owner.query(`DELETE FROM wechat_channels WHERE id = $1`, [c.a.rowId]);
    const gone = await send(c, text(c.openid)).catch((e: unknown) => e);
    expect((gone as ChannelError).code).toBe('CHANNEL_DISCONNECTED');
    expect(sendCalls()).toHaveLength(0);
  });

  it.each([
    [45015, 'WECHAT_WINDOW_CLOSED', false],
    [43004, 'WECHAT_NOT_FOLLOWING', false],
    [40003, 'WECHAT_NOT_FOLLOWING', false],
    [48001, 'WECHAT_SEND_REJECTED', false],
    [-1, 'WECHAT_SEND_REJECTED', true],
  ])('errcode %i becomes %s (retryable: %s)', async (errcode, code, retryable) => {
    const c = await setup(`ws7${Math.abs(errcode)}`);
    wechat.answers.sendCustomMessage = () => Promise.resolve(refused(errcode, 'reason'));
    const err = (await send(c, text(c.openid)).catch((e: unknown) => e)) as ChannelError;
    expect(err).toBeInstanceOf(ChannelError);
    expect(err.code).toBe(code);
    expect(err.retryable).toBe(retryable);
    expect(err.message).toContain(String(errcode));
    expect(err.providerCode).toBe(String(errcode));
  });

  it('a WeChat that cannot be reached is a refusal with the transport reason, not an exception', async () => {
    const c = await setup('ws8');
    wechat.answers.sendCustomMessage = () =>
      Promise.resolve({ ok: false, data: {}, errcode: null, error: 'fetch failed' });
    const err = (await send(c, text(c.openid)).catch((e: unknown) => e)) as ChannelError;
    expect(err.code).toBe('WECHAT_SEND_REJECTED');
    expect(err.message).toBe('fetch failed');
    expect(err.retryable).toBe(false);
  });
});

describe('WECH access token: shared per account, cached, refreshed under a lock', () => {
  const fetches = () => wechat.calls.filter((x) => x.method === 'fetchAccessToken').length;

  it('is fetched once and reused for every send until it nears its expiry', async () => {
    const c = await setup('wt1');
    wechat.calls.length = 0;
    await send(c, text(c.openid));
    await send(c, text(c.openid));
    expect(fetches()).toBe(0);
    const tokens = sendCalls().map((x) => x.args[0]);
    expect(new Set(tokens).size).toBe(1);
  });

  it('a token five minutes from expiry is replaced before the send, and the new one is stored encrypted', async () => {
    const c = await setup('wt2');
    await h.owner.query(
      `UPDATE wechat_channels SET token_expires_at = now() + interval '4 minutes' WHERE id = $1`,
      [c.a.rowId],
    );
    wechat.calls.length = 0;
    await send(c, text(c.openid));
    expect(fetches()).toBe(1);
    const row = (await h.owner.query(`SELECT * FROM wechat_channels WHERE id = $1`, [c.a.rowId]))
      .rows[0];
    const fresh = decrypt(h, row.cached_access_token);
    expect(sendCalls()[0]!.args[0]).toBe(fresh);
    expect(new Date(row.token_expires_at).getTime()).toBeGreaterThan(Date.now() + 3600_000);
  });

  it('several sends racing on an expired token fetch ONE new token (a second fetch would invalidate the first)', async () => {
    const c = await setup('wt3');
    await h.owner.query(
      `UPDATE wechat_channels SET token_expires_at = now() - interval '1 hour' WHERE id = $1`,
      [c.a.rowId],
    );
    wechat.calls.length = 0;
    wechat.answers.fetchAccessToken = async () => {
      await new Promise((r) => setTimeout(r, 150));
      return {
        ok: true,
        data: { accessToken: `shared-${Date.now()}`, expiresIn: 7200 },
        errcode: null,
        error: null,
      };
    };
    await Promise.all([1, 2, 3, 4].map(() => send(c, text(c.openid))));
    expect(fetches()).toBe(1);
    expect(new Set(sendCalls().map((x) => x.args[0])).size).toBe(1);
  });

  it('WeChat saying the token is invalid (40001) refreshes it once and tries the send again', async () => {
    const c = await setup('wt4');
    let first = true;
    wechat.answers.sendCustomMessage = () => {
      if (first) {
        first = false;
        return Promise.resolve(refused(40001, 'invalid credential'));
      }
      return Promise.resolve({ ok: true, data: {}, errcode: null, error: null });
    };
    wechat.calls.length = 0;
    const out = await send(c, text(c.openid));
    expect(out.providerMessageId).toBeTruthy();
    expect(fetches()).toBe(1);
    const [a, b] = sendCalls().map((x) => x.args[0]);
    expect(a).not.toBe(b);
  });

  it('a token that stays invalid is tried twice, not forever', async () => {
    const c = await setup('wt5');
    wechat.answers.sendCustomMessage = () => Promise.resolve(refused(40001, 'invalid credential'));
    wechat.calls.length = 0;
    const err = (await send(c, text(c.openid)).catch((e: unknown) => e)) as ChannelError;
    expect(err.code).toBe('WECHAT_SEND_REJECTED');
    expect(sendCalls()).toHaveLength(2);
    expect(fetches()).toBe(1);
  });

  it('when WeChat refuses to issue a token the send fails with the reason and the channel shows it', async () => {
    const c = await setup('wt6');
    await h.owner.query(
      `UPDATE wechat_channels SET token_expires_at = now() - interval '1 hour', cached_access_token = NULL WHERE id = $1`,
      [c.a.rowId],
    );
    wechat.answers.fetchAccessToken = () =>
      Promise.resolve({
        ok: false,
        data: { accessToken: '', expiresIn: 0 },
        errcode: 40164,
        error: '40164 invalid ip, not in whitelist',
      });
    const err = (await send(c, text(c.openid)).catch((e: unknown) => e)) as ChannelError;
    expect(err.message).toBe('no access_token');
    const row = (
      await h.owner.query(`SELECT last_error FROM wechat_channels WHERE id = $1`, [c.a.rowId])
    ).rows[0];
    expect(row.last_error).toContain('40164');
    expect(sendCalls()).toHaveLength(0);
  });
});

describe('WECH send: files', () => {
  const stream = (b: Buffer) => ({ stream: Readable.from([b]) });
  const withMedia = (open: () => Promise<unknown>) => {
    (h.app.get(WechatChannelAdapter) as unknown as { media: unknown }).media = { open };
  };
  const media = (c: Ctx, over: object = {}) => ({
    kind: 'media',
    to: c.openid,
    clientReference: `m-${++ref}-${Date.now()}`,
    media: {
      key: 'k/photo.png',
      mediaKind: 'image',
      mime: 'image/png',
      name: 'photo.png',
      ...over,
    },
  });

  it('uploads the file, sends its caption first as text (a media message carries none), then the media', async () => {
    const c = await setup('wm1');
    withMedia(() => Promise.resolve(stream(Buffer.from('PNG'))));
    await send(c, media(c, { caption: 'Look at this' }));
    const methods = wechat.calls.map((x) => x.method).filter((m) => !BACKGROUND.includes(m));
    expect(methods).toEqual(['uploadMedia', 'sendCustomMessage', 'sendCustomMessage']);
    const up = wechat.calls.find((x) => x.method === 'uploadMedia')!;
    expect(up.args[1]).toBe('image');
    expect(Buffer.from(up.args[2] as Uint8Array).toString()).toBe('PNG');
    expect(up.args[3]).toBe('photo.png');
    const [caption, image] = sendCalls().map((x) => x.args[2]);
    expect(caption).toEqual({ msgtype: 'text', text: { content: 'Look at this' } });
    expect(image).toEqual({ msgtype: 'image', image: { media_id: 'media-1' } });
  });

  it('audio goes as a voice message and video with its media id as thumbnail (Reference)', async () => {
    const c = await setup('wm2');
    withMedia(() => Promise.resolve(stream(Buffer.from('x'))));
    await send(c, media(c, { mediaKind: 'audio', mime: 'audio/amr', name: 'a.amr' }));
    await send(c, media(c, { mediaKind: 'video', mime: 'video/mp4', name: 'v.mp4' }));
    expect(wechat.calls.filter((x) => x.method === 'uploadMedia').map((x) => x.args[1])).toEqual([
      'voice',
      'video',
    ]);
    expect(sendCalls().map((x) => x.args[2])).toEqual([
      { msgtype: 'voice', voice: { media_id: 'media-1' } },
      { msgtype: 'video', video: { media_id: 'media-1', thumb_media_id: 'media-1' } },
    ]);
  });

  it('a document, a file that cannot be read, a file over 10 MB and a refused upload are refused with a reason', async () => {
    const c = await setup('wm3');
    const code = async (env: object) =>
      ((await send(c, env).catch((e: unknown) => e)) as ChannelError).code;

    withMedia(() => Promise.resolve(stream(Buffer.from('x'))));
    expect(await code(media(c, { mediaKind: 'document', mime: 'application/pdf' }))).toBe(
      'CHANNEL_CAPABILITY_UNSUPPORTED',
    );
    withMedia(() => Promise.resolve(null));
    expect(await code(media(c))).toBe('MEDIA_NOT_REACHABLE');
    withMedia(() => Promise.resolve(stream(Buffer.alloc(10 * 1024 * 1024 + 1))));
    expect(await code(media(c))).toBe('MEDIA_NOT_REACHABLE');
    withMedia(() => Promise.resolve(stream(Buffer.from('x'))));
    wechat.answers.uploadMedia = () => Promise.resolve(refused(40004, 'invalid media type'));
    expect(await code(media(c))).toBe('WECHAT_SEND_REJECTED');
    expect(sendCalls()).toHaveLength(0);
  });

  it("a file a follower sent is downloaded with the account's token", async () => {
    const c = await setup('wm4');
    const adapter = h.app.get(WechatChannelAdapter);
    const file = await adapter.fetchMedia(c.runtime as ChannelRuntime, {
      providerMediaId: 'MID',
      mediaKind: 'image',
      mime: 'image/jpeg',
    });
    expect(file.mime).toBe('image/png');
    expect(file.bytes.length).toBeGreaterThan(0);
    const get = wechat.calls.find((x) => x.method === 'getMedia')!;
    expect(get.args[1]).toBe('MID');
    wechat.answers.getMedia = () => Promise.resolve(null);
    await expect(
      adapter.fetchMedia(c.runtime, {
        providerMediaId: 'X',
        mediaKind: 'image',
        mime: 'image/jpeg',
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_DOWNLOAD_FAILED' });
  });
});
