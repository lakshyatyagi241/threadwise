import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';
import {
  AES_KEY,
  encryptSafeMode,
  eventXml,
  sha1Sorted,
  textXml,
} from '../../support/wechat-crypto';
import {
  connect,
  installFakeWechat,
  push,
  refused,
  signed,
  type Account,
  type Fake,
} from './support';

/** The WeChat webhook (WECH): the GET handshake, the signature, XML messages and events into the inbox. Real Postgres, fake WeChat. */
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

let mid = 1000;
const nextId = () => ++mid;
const convs = async (t: Tenant) =>
  (
    await h.owner.query(
      `SELECT c.* FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
       WHERE c.org_id = $1 AND ch.kind = 'wechat' ORDER BY c.id`,
      [t.orgId],
    )
  ).rows;
const msgs = async (t: Tenant) =>
  (await h.owner.query(`SELECT * FROM messages WHERE org_id = $1 ORDER BY id`, [t.orgId])).rows;
const contacts = async (t: Tenant) =>
  (
    await h.owner.query(
      `SELECT * FROM contacts WHERE org_id = $1 AND channel = 'wechat' ORDER BY id`,
      [t.orgId],
    )
  ).rows;
const channelRow = async (a: Account) =>
  (await h.owner.query(`SELECT * FROM wechat_channels WHERE id = $1`, [a.rowId])).rows[0];
const until = async <T>(read: () => Promise<T>, ok: (v: T) => boolean): Promise<T> => {
  for (let i = 0; i < 40; i++) {
    const v = await read();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  return read();
};
const say = (a: Account, openid: string, content: string) =>
  push(api, a, textXml({ openid, content, msgId: nextId() }));

describe('WECH handshake: GET answers the URL check in the WeChat console', () => {
  it('echoes echostr for a valid signature, as plain text', async () => {
    const t = await api.signup('wi1');
    const a = await connect(api, h, t);
    const res = await api
      .http()
      .get(`/v2/wechat/inbound/${a.webhookToken}`)
      .query({ ...signed(a.verifyToken), echostr: '1234567890' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('1234567890');
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it("refuses a wrong or missing signature, a wrong timestamp and another account's Token, without echoing", async () => {
    const t = await api.signup('wi2');
    const a = await connect(api, h, t);
    const other = await connect(api, h, t);
    const probe = (q: Record<string, string>) =>
      api
        .http()
        .get(`/v2/wechat/inbound/${a.webhookToken}`)
        .query({ echostr: 'ECHO', ...q });
    const good = signed(a.verifyToken);
    for (const q of [
      {},
      { ...good, signature: 'deadbeef' },
      { ...good, timestamp: '1' },
      { ...good, nonce: 'other' },
      signed(other.verifyToken),
    ]) {
      const res = await probe(q);
      expect(res.status, JSON.stringify(q)).toBe(403);
      expect(res.text).toBe('');
    }
  });

  it('an unknown address answers success and does nothing', async () => {
    const res = await api
      .http()
      .get('/v2/wechat/inbound/nope')
      .query({ ...signed('x'), echostr: 'ECHO' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('success');
  });

  it('a paused channel still passes the URL check', async () => {
    const t = await api.signup('wi3');
    const a = await connect(api, h, t);
    await h.owner.query(`UPDATE wechat_channels SET active = false WHERE id = $1`, [a.rowId]);
    const res = await api
      .http()
      .get(`/v2/wechat/inbound/${a.webhookToken}`)
      .query({ ...signed(a.verifyToken), echostr: 'ECHO' });
    expect(res.text).toBe('ECHO');
  });

  it('safe mode: the encrypted echostr is checked with msg_signature and answered decrypted', async () => {
    const t = await api.signup('wi4');
    const a = await connect(api, h, t, { encMode: 'safe', encodingAesKey: AES_KEY });
    const echostr = encryptSafeMode(AES_KEY, '5678901234', a.appId);
    const ts = '1700000001';
    const res = await api
      .http()
      .get(`/v2/wechat/inbound/${a.webhookToken}`)
      .query({
        msg_signature: sha1Sorted(a.verifyToken, ts, 'n2', echostr),
        timestamp: ts,
        nonce: 'n2',
        echostr,
      });
    expect(res.status).toBe(200);
    expect(res.text).toBe('5678901234');

    const forged = await api
      .http()
      .get(`/v2/wechat/inbound/${a.webhookToken}`)
      .query({
        msg_signature: sha1Sorted('wrong', ts, 'n2', echostr),
        timestamp: ts,
        nonce: 'n2',
        echostr,
      });
    expect(forged.status).toBe(403);
    const otherAccount = encryptSafeMode(AES_KEY, '5678901234', 'wxOTHER');
    const wrongApp = await api
      .http()
      .get(`/v2/wechat/inbound/${a.webhookToken}`)
      .query({
        msg_signature: sha1Sorted(a.verifyToken, ts, 'n2', otherAccount),
        timestamp: ts,
        nonce: 'n2',
        echostr: otherAccount,
      });
    expect(wrongApp.status).toBe(403);
  });
});

describe('WECH inbound: the signature is checked on every POST', () => {
  it('a wrong signature is refused and nothing is written; an unknown address and a paused channel answer success and write nothing', async () => {
    const t = await api.signup('wi5');
    const a = await connect(api, h, t);
    const xml = textXml({ openid: 'oFollower1', content: 'hi', msgId: nextId() });

    const bad = await push(api, a, xml, { ...signed(a.verifyToken), signature: 'deadbeef' });
    expect(bad.status).toBe(403);
    const none = await push(api, a, xml, {});
    expect(none.status).toBe(403);
    const unknown = await api
      .http()
      .post('/v2/wechat/inbound/nope')
      .query(signed('x'))
      .set('content-type', 'text/xml')
      .send(xml);
    expect(unknown.status).toBe(200);
    expect(unknown.text).toBe('success');

    await h.owner.query(`UPDATE wechat_channels SET active = false WHERE id = $1`, [a.rowId]);
    const paused = await push(api, a, xml);
    expect(paused.text).toBe('success');
    expect(await convs(t)).toHaveLength(0);
    expect(await msgs(t)).toHaveLength(0);
  });

  it('too many requests for one address in a minute are refused with 429', async () => {
    const t = await api.signup('wi6');
    const a = await connect(api, h, t);
    const key = `wechat_hits:${a.webhookToken}:${Math.floor(Date.now() / 60_000)}`;
    await h.redis.set(key, '240', 'EX', 120);
    const res = await push(api, a, textXml({ openid: 'oX', content: 'hi', msgId: nextId() }));
    expect(res.status).toBe(429);
  });
});

describe('WECH inbound: a message becomes a thread, a contact and a message', () => {
  it('first message: thread keyed by the OpenID (case kept), contact keyed by it, unread 1, account marked alive', async () => {
    const t = await api.signup('wi7');
    const a = await connect(api, h, t);
    await h.owner.query(`UPDATE wechat_channels SET last_error = 'old' WHERE id = $1`, [a.rowId]);
    const res = await say(a, 'oAbC_dEf-123', 'Hello there');
    expect(res.status).toBe(200);
    expect(res.text).toBe('success');
    expect(res.headers['content-type']).toContain('text/plain');

    const [c] = await convs(t);
    expect(c).toMatchObject({
      peer_key: 'oAbC_dEf-123',
      status: 'open',
      unread_count: 1,
      preview: 'Hello there',
    });
    const [m] = await msgs(t);
    expect(m).toMatchObject({ direction: 'in', kind: 'text', body: 'Hello there' });
    expect(m.meta.wechat).toMatchObject({ openid: 'oAbC_dEf-123', msg_type: 'text' });

    const [contact] = await contacts(t);
    expect(contact).toMatchObject({ channel: 'wechat', channel_uid: 'oAbC_dEf-123' });
    expect(Number(c.contact_id)).toBe(Number(contact.id));

    const row = await channelRow(a);
    expect(row.last_inbound_at).not.toBeNull();
    expect(row.last_error).toBeNull();
    // The account's own id is learnt from the first message (ToUserName).
    expect(row.wx_id).toBe('gh_account');
  });

  it('WeChat redelivering a message (the same MsgId) stores it once; a different one is a second message and one more unread', async () => {
    const t = await api.signup('wi8');
    const a = await connect(api, h, t);
    const xml = textXml({ openid: 'oR', content: 'same', msgId: 55 });
    await push(api, a, xml);
    await push(api, a, xml);
    await push(api, a, xml);
    expect(await msgs(t)).toHaveLength(1);
    await say(a, 'oR', 'next');
    expect(await msgs(t)).toHaveLength(2);
    const [c] = await convs(t);
    expect(c.unread_count).toBe(2);
    expect(await convs(t)).toHaveLength(1);
  });

  it('two followers are two threads and two contacts; OpenIDs that differ only by case are different people', async () => {
    const t = await api.signup('wi9');
    const a = await connect(api, h, t);
    await say(a, 'oAAA', 'one');
    await say(a, 'oaaa', 'two');
    expect((await convs(t)).map((c) => c.peer_key).sort()).toEqual(['oAAA', 'oaaa']);
    expect(await contacts(t)).toHaveLength(2);
  });

  it('the same OpenID on two accounts is two threads (each account is its own channel)', async () => {
    const t = await api.signup('wi10');
    const a = await connect(api, h, t);
    const b = await connect(api, h, t);
    await say(a, 'oSame', 'to a');
    await say(b, 'oSame', 'to b');
    expect(await convs(t)).toHaveLength(2);
    expect(await contacts(t)).toHaveLength(1);
  });

  it("the follower's nickname and photo are learnt after the answer and fill the thread title, the contact name and photo", async () => {
    const t = await api.signup('wi11');
    const a = await connect(api, h, t);
    await say(a, 'oMei', 'hi');
    const [c] = await until(
      () => convs(t),
      (r) => r[0]?.title === 'Mei',
    );
    expect(c.title).toBe('Mei');
    const [contact] = await contacts(t);
    expect(contact).toMatchObject({ name: 'Mei', image_url: 'https://thirdwx.qlogo.cn/mei.png' });
    // (A profile still being asked for by an earlier case must not be counted: count this follower's.)
    const asked = () =>
      wechat.calls.filter((x) => x.method === 'getUserInfo' && x.args[1] === 'oMei');
    expect(asked()).toHaveLength(1);

    // Only the first message of a thread asks WeChat for the profile.
    await say(a, 'oMei', 'again');
    await new Promise((r) => setTimeout(r, 200));
    expect(asked()).toHaveLength(1);
  });

  it('a follower WeChat will not name keeps the placeholder names; a failed profile call never loses the message', async () => {
    const t = await api.signup('wi12');
    const a = await connect(api, h, t);
    wechat.answers.getUserInfo = () => Promise.resolve(refused(48001, 'api unauthorized'));
    expect((await say(a, 'oNoName', 'hi')).text).toBe('success');
    await new Promise((r) => setTimeout(r, 300));
    expect((await convs(t))[0]).toMatchObject({ title: 'WeChat' });
    expect((await contacts(t))[0]).toMatchObject({ name: 'WeChat user' });
    expect(await msgs(t)).toHaveLength(1);
  });
});

describe('WECH inbound: every kind of packet', () => {
  it('follow creates the thread with no text; unfollow and the events nobody reads write nothing', async () => {
    const t = await api.signup('wi13');
    const a = await connect(api, h, t);
    await push(api, a, eventXml({ openid: 'oNew', event: 'subscribe' }));
    expect(await convs(t)).toHaveLength(1);
    const [m] = await msgs(t);
    expect(m.body).toBeNull();
    expect(m.meta.wechat).toMatchObject({ event: 'subscribe' });
    // A redelivered follow (same user, event and time) is stored once.
    await push(api, a, eventXml({ openid: 'oNew', event: 'subscribe' }));
    expect(await msgs(t)).toHaveLength(1);

    for (const event of ['unsubscribe', 'SCAN', 'VIEW', 'LOCATION']) {
      const res = await push(api, a, eventXml({ openid: 'oNew', event, createTime: nextId() }));
      expect(res.text).toBe('success');
    }
    expect(await msgs(t)).toHaveLength(1);
    expect(await convs(t)).toHaveLength(1);
  });

  it('a custom-menu tap is its key, written as a message so keyword rules and flows answer it', async () => {
    const t = await api.signup('wi14');
    const a = await connect(api, h, t);
    await push(api, a, eventXml({ openid: 'oTap', event: 'CLICK', key: 'PRICING' }));
    const [m] = await msgs(t);
    expect(m).toMatchObject({ kind: 'text', body: 'PRICING' });
    expect(m.meta.wechat).toMatchObject({ event: 'click', event_key: 'PRICING' });
    await push(api, a, eventXml({ openid: 'oTap', event: 'CLICK', createTime: nextId() }));
    expect(await msgs(t)).toHaveLength(1);
  });

  it("an image is downloaded with the account's token and stored with the message", async () => {
    const t = await api.signup('wi15');
    const a = await connect(api, h, t);
    const xml =
      '<xml><ToUserName><![CDATA[gh_account]]></ToUserName><FromUserName><![CDATA[oPic]]></FromUserName>' +
      `<CreateTime>1700000000</CreateTime><MsgType><![CDATA[image]]></MsgType><PicUrl><![CDATA[http://mmbiz/x]]></PicUrl><MediaId><![CDATA[MEDIA42]]></MediaId><MsgId>${nextId()}</MsgId></xml>`;
    expect((await push(api, a, xml)).text).toBe('success');
    const get = wechat.calls.find((x) => x.method === 'getMedia')!;
    expect(get.args[1]).toBe('MEDIA42');
    expect(String(get.args[0])).toMatch(/^access-/);
    const [m] = await msgs(t);
    expect(m).toMatchObject({ kind: 'image', media_mime: 'image/png' });
    expect(m.media_key).toBeTruthy();
  });

  it('a voice note keeps its recognised text; a location keeps its coordinates; a link and an unknown type are text', async () => {
    const t = await api.signup('wi16');
    const a = await connect(api, h, t);
    const wrap = (body: string) =>
      `<xml><ToUserName>gh_account</ToUserName><FromUserName>oMix</FromUserName><CreateTime>1700000000</CreateTime>${body}<MsgId>${nextId()}</MsgId></xml>`;
    await push(
      api,
      a,
      wrap(
        '<MsgType>voice</MsgType><MediaId>V1</MediaId><Format>amr</Format><Recognition>hello world</Recognition>',
      ),
    );
    await push(
      api,
      a,
      wrap(
        '<MsgType>location</MsgType><Location_X>23.134521</Location_X><Location_Y>113.358803</Location_Y><Label>Canton Tower</Label>',
      ),
    );
    await push(
      api,
      a,
      wrap('<MsgType>link</MsgType><Title>News</Title><Url>https://a.test/n</Url>'),
    );
    await push(api, a, wrap('<MsgType>miniprogrampage</MsgType>'));
    const all = await msgs(t);
    expect(all).toHaveLength(4);
    expect(all[0]).toMatchObject({ body: 'hello world' });
    expect(all[1]).toMatchObject({ kind: 'location' });
    expect(Number(all[1].latitude)).toBeCloseTo(23.134521, 5);
    expect(Number(all[1].longitude)).toBeCloseTo(113.358803, 5);
    expect(all[2]).toMatchObject({ kind: 'text', body: 'News https://a.test/n' });
    expect(all[3]).toMatchObject({ body: '[miniprogrampage]' });
    expect(all[3].meta.unsupported).toBe(true);
  });

  it('an image WeChat will not hand over still stores the message (without the file)', async () => {
    const t = await api.signup('wi17');
    const a = await connect(api, h, t);
    wechat.answers.getMedia = () => Promise.resolve(null);
    const xml = `<xml><FromUserName>oPic2</FromUserName><MsgType>image</MsgType><MediaId>GONE</MediaId><MsgId>${nextId()}</MsgId></xml>`;
    expect((await push(api, a, xml)).text).toBe('success');
    expect(await msgs(t)).toHaveLength(1);
  });

  it('a body that is not XML, or is oversized or declares entities, is acknowledged and writes nothing', async () => {
    const t = await api.signup('wi18');
    const a = await connect(api, h, t);
    for (const body of [
      'plain text',
      '<!DOCTYPE x [<!ENTITY a "b">]><xml><FromUserName>o</FromUserName><MsgType>text</MsgType><Content>&a;</Content></xml>',
      '',
    ]) {
      const res = await push(api, a, body);
      expect(res.text, body).toBe('success');
    }
    expect(await msgs(t)).toHaveLength(0);
    const huge = await push(api, a, `<xml>${'a'.repeat(300 * 1024)}</xml>`);
    expect(huge.status).toBe(413);
  });
});

describe('WECH inbound: AES safe mode', () => {
  it('decrypts the message after checking msg_signature; anything else is refused or ignored', async () => {
    const t = await api.signup('wi19');
    const a = await connect(api, h, t, { encMode: 'safe', encodingAesKey: AES_KEY });
    const inner = textXml({ openid: 'oSafe', content: 'secret hello', msgId: nextId() });
    const encrypt = encryptSafeMode(AES_KEY, inner, a.appId);
    const wrapper = `<xml><ToUserName><![CDATA[gh_account]]></ToUserName><Encrypt><![CDATA[${encrypt}]]></Encrypt></xml>`;
    const q = (e: string, token = a.verifyToken) => ({
      ...signed(token),
      msg_signature: sha1Sorted(token, '1700000000', 'nonce1', e),
      encrypt_type: 'aes',
    });

    expect((await push(api, a, wrapper, q(encrypt))).text).toBe('success');
    expect((await msgs(t)).map((m) => m.body)).toEqual(['secret hello']);

    // A forged msg_signature is refused; a payload for another account's AppID is dropped quietly.
    expect((await push(api, a, wrapper, q(encrypt, 'wrong-token'))).status).toBe(403);
    const foreign = encryptSafeMode(AES_KEY, inner, 'wxOTHER');
    const foreignXml = `<xml><Encrypt><![CDATA[${foreign}]]></Encrypt></xml>`;
    expect((await push(api, a, foreignXml, q(foreign))).text).toBe('success');
    expect(await msgs(t)).toHaveLength(1);
  });
});
