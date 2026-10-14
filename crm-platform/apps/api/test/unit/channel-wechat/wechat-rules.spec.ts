import { describe, expect, it } from 'vitest';
import {
  STALE_SENDING_MINUTES,
  WINDOW_HOURS,
  classify,
  clipError,
  clipText,
  decryptSafeMode,
  inboundKey,
  msgSignatureMatches,
  parseXml,
  randomToken,
  signatureMatches,
  tagIdOf,
  tokenIsFresh,
  tokenLifetimeSeconds,
  webhookUrl,
  windowOpen,
} from '../../../src/modules/channel-wechat/wechat-rules';
import {
  AES_KEY,
  encryptSafeMode,
  eventXml,
  sha1Sorted,
  textXml,
} from '../../support/wechat-crypto';

describe('connecting', () => {
  it('a routing token is 48 URL-safe characters and never repeats', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9]{48}$/);
    expect(randomToken()).not.toBe(a);
  });

  it('the webhook address is always https, on the versioned route, with no double slash', () => {
    expect(webhookUrl('http://localhost:3000/', 'abc')).toBe(
      'https://localhost:3000/v2/wechat/inbound/abc',
    );
    expect(webhookUrl('https://crm.example.com', 'abc')).toBe(
      'https://crm.example.com/v2/wechat/inbound/abc',
    );
  });

  it('errors are cut to the 255 characters the row keeps', () => {
    expect(clipError('x'.repeat(300))).toHaveLength(255);
    expect(clipError('')).toBeNull();
    expect(clipError(null)).toBeNull();
  });

  it('a token lives at least a minute and defaults to WeChat 7200 seconds', () => {
    expect(tokenLifetimeSeconds(7200)).toBe(7200);
    expect(tokenLifetimeSeconds(5)).toBe(60);
    expect(tokenLifetimeSeconds(undefined)).toBe(7200);
    expect(tokenLifetimeSeconds(Number.NaN)).toBe(7200);
  });

  it('a cached token is used until five minutes before it expires', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const at = (min: number) => new Date(now.getTime() + min * 60_000);
    expect(tokenIsFresh('t', at(6), now)).toBe(true);
    expect(tokenIsFresh('t', at(5), now)).toBe(false);
    expect(tokenIsFresh('t', at(-1), now)).toBe(false);
    expect(tokenIsFresh('', at(60), now)).toBe(false);
    expect(tokenIsFresh(null, at(60), now)).toBe(false);
    expect(tokenIsFresh('t', null, now)).toBe(false);
  });
});

describe('the webhook signature', () => {
  it('is the sha1 of the sorted token, timestamp and nonce (a known value)', () => {
    // sort(['tok','1','2']) = '12tok'
    const known = '865ab4720dd2cb687cfeb7cca144897b03682d7a';
    expect(signatureMatches('tok', known, '1', '2')).toBe(true);
    expect(sha1Sorted('tok', '1', '2')).toBe(known);
  });

  it('refuses a wrong signature, a wrong token, an empty one and another timestamp', () => {
    const good = sha1Sorted('tok', '1', '2');
    expect(signatureMatches('tok', good.replace(/.$/, '0'), '1', '2')).toBe(false);
    expect(signatureMatches('other', good, '1', '2')).toBe(false);
    expect(signatureMatches('tok', '', '1', '2')).toBe(false);
    expect(signatureMatches('', good, '1', '2')).toBe(false);
    expect(signatureMatches('tok', good, '9', '2')).toBe(false);
    expect(signatureMatches('tok', good.slice(0, 20), '1', '2')).toBe(false);
  });

  it('accepts an upper-case hex signature', () => {
    expect(signatureMatches('tok', sha1Sorted('tok', '1', '2').toUpperCase(), '1', '2')).toBe(true);
  });

  it('the message signature also covers the encrypted payload', () => {
    const sig = sha1Sorted('tok', '1', '2', 'ENC');
    expect(sig).toBe('5e87dcf2fb968b308203b1fe394853071f61e834');
    expect(msgSignatureMatches('tok', sig, '1', '2', 'ENC')).toBe(true);
    expect(msgSignatureMatches('tok', sig, '1', '2', 'OTHER')).toBe(false);
    expect(msgSignatureMatches('tok', '', '1', '2', 'ENC')).toBe(false);
    expect(msgSignatureMatches('', sig, '1', '2', 'ENC')).toBe(false);
  });
});

describe('AES safe mode', () => {
  const xml = textXml({ openid: 'oAbC', content: 'hello 你好', msgId: 1 });

  it('decrypts what WeChat encrypts, Unicode included, and checks the AppID', () => {
    const enc = encryptSafeMode(AES_KEY, xml, 'wx123');
    expect(decryptSafeMode(AES_KEY, enc, 'wx123')).toBe(xml);
    expect(decryptSafeMode(AES_KEY, enc)).toBe(xml);
  });

  it('refuses another account, another key, a short key and damaged or empty payloads', () => {
    const enc = encryptSafeMode(AES_KEY, xml, 'wx123');
    expect(decryptSafeMode(AES_KEY, enc, 'wx999')).toBeNull();
    expect(decryptSafeMode(AES_KEY.replace(/^./, 'Z'), enc, 'wx123')).toBeNull();
    expect(decryptSafeMode('short', enc)).toBeNull();
    expect(decryptSafeMode(AES_KEY, '')).toBeNull();
    expect(decryptSafeMode(AES_KEY, 'not base64 !!')).toBeNull();
    expect(decryptSafeMode(AES_KEY, Buffer.from('1234567').toString('base64'))).toBeNull();
    const damaged = Buffer.from(enc, 'base64');
    damaged[damaged.length - 1] = (damaged[damaged.length - 1]! + 1) % 256;
    expect(decryptSafeMode(AES_KEY, damaged.toString('base64'), 'wx123')).toBeNull();
  });

  it('an empty message is no message', () => {
    expect(decryptSafeMode(AES_KEY, encryptSafeMode(AES_KEY, '', 'wx123'))).toBeNull();
  });
});

describe('the XML', () => {
  it('reads CDATA and plain values', () => {
    expect(parseXml(textXml({ openid: 'oAbC', content: 'hi', msgId: 42 }))).toMatchObject({
      FromUserName: 'oAbC',
      ToUserName: 'gh_account',
      MsgType: 'text',
      Content: 'hi',
      MsgId: '42',
      CreateTime: '1700000000',
    });
  });

  it('decodes the five XML entities in a plain value, and nothing else', () => {
    expect(
      parseXml('<xml><Content>a &lt;b&gt; &amp; &quot;c&quot; &apos;d&apos; &#65;</Content></xml>'),
    ).toEqual({
      Content: 'a <b> & "c" \'d\' &#65;',
    });
  });

  it('refuses a document type declaration or an entity (no expansion, no external lookup)', () => {
    expect(parseXml('<!DOCTYPE x [<!ENTITY a "b">]><xml><Content>&a;</Content></xml>')).toEqual({});
    expect(parseXml('<xml><!ENTITY a "b"><Content>x</Content></xml>')).toEqual({});
  });

  it('the first value of a tag wins, so a nested element cannot overwrite a top-level one', () => {
    const x =
      '<xml><Event>click</Event><ScanCodeInfo><Event>scan</Event></ScanCodeInfo><Event>last</Event></xml>';
    expect(parseXml(x).Event).toBe('click');
  });

  it('an empty or broken packet is an empty object', () => {
    expect(parseXml('')).toEqual({});
    expect(parseXml('   ')).toEqual({});
    expect(parseXml('not xml at all')).toEqual({});
  });
});

describe('what an inbound packet means', () => {
  const x = (body: string) => parseXml(`<xml><FromUserName>oU</FromUserName>${body}</xml>`);

  it('a text message keeps its text and its MsgId', () => {
    expect(classify(parseXml(textXml({ openid: 'oU', content: 'hi', msgId: 7 })))).toMatchObject({
      openid: 'oU',
      kind: 'message',
      text: 'hi',
      msgId: '7',
      media: null,
    });
  });

  it('an image, a voice note and a video carry their media id; a voice note keeps its recognised text', () => {
    expect(classify(x('<MsgType>image</MsgType><MediaId>m1</MediaId>'))).toMatchObject({
      kind: 'message',
      text: '',
      media: { id: 'm1', type: 'image' },
    });
    expect(
      classify(
        x('<MsgType>voice</MsgType><MediaId>m2</MediaId><Recognition> hello </Recognition>'),
      ),
    ).toMatchObject({ text: 'hello', media: { id: 'm2', type: 'audio' } });
    expect(classify(x('<MsgType>voice</MsgType><MediaId>m2</MediaId>'))).toMatchObject({
      text: '',
    });
    expect(classify(x('<MsgType>shortvideo</MsgType><MediaId>m3</MediaId>'))).toMatchObject({
      media: { id: 'm3', type: 'video' },
    });
    expect(classify(x('<MsgType>image</MsgType>'))).toMatchObject({ media: null });
  });

  it('a location carries its coordinates and label; one without coordinates is only text', () => {
    expect(
      classify(
        x(
          '<MsgType>location</MsgType><Location_X>23.1</Location_X><Location_Y>113.3</Location_Y><Label>Tower</Label>',
        ),
      ),
    ).toMatchObject({
      text: '[location] Tower',
      location: { latitude: 23.1, longitude: 113.3, label: 'Tower' },
    });
    expect(classify(x('<MsgType>location</MsgType><Location_X>x</Location_X>'))).toMatchObject({
      text: '[location]',
      location: null,
    });
  });

  it('a link is its title and address; any other type is its name in brackets', () => {
    expect(
      classify(x('<MsgType>link</MsgType><Title>News</Title><Url>https://a.test</Url>')),
    ).toMatchObject({ text: 'News https://a.test' });
    expect(classify(x('<MsgType>miniprogrampage</MsgType>'))).toMatchObject({
      text: '[miniprogrampage]',
    });
    expect(classify(x(''))).toMatchObject({ text: '[message]' });
  });

  it('follow and unfollow are their own kinds; a menu tap is its key typed as a message', () => {
    expect(classify(parseXml(eventXml({ openid: 'oU', event: 'subscribe' })))?.kind).toBe(
      'subscribe',
    );
    expect(classify(parseXml(eventXml({ openid: 'oU', event: 'unsubscribe' })))?.kind).toBe(
      'unsubscribe',
    );
    expect(
      classify(parseXml(eventXml({ openid: 'oU', event: 'CLICK', key: 'MENU_1' }))),
    ).toMatchObject({
      kind: 'click',
      text: 'MENU_1',
    });
    expect(classify(parseXml(eventXml({ openid: 'oU', event: 'CLICK' })))?.kind).toBe('ignored');
  });

  it('scans, views and the other events are acknowledged and nothing more', () => {
    for (const event of ['SCAN', 'VIEW', 'LOCATION', 'scancode_push']) {
      expect(classify(parseXml(eventXml({ openid: 'oU', event })))?.kind).toBe('ignored');
    }
  });

  it('a packet with no sender is nothing', () => {
    expect(classify(parseXml('<xml><MsgType>text</MsgType></xml>'))).toBeNull();
  });
});

describe('the ledger key of an inbound', () => {
  const i = (xml: string) => classify(parseXml(xml))!;

  it('a message is its MsgId, so a redelivery is the same message', () => {
    expect(inboundKey(i(textXml({ openid: 'oU', content: 'a', msgId: 77 })))).toBe('msg:77');
  });

  it('an event is the event, the person and the time; without a time there is no key', () => {
    expect(inboundKey(i(eventXml({ openid: 'oU', event: 'subscribe', createTime: 5 })))).toBe(
      'evt:subscribe:oU:5',
    );
    expect(
      inboundKey(i('<xml><FromUserName>oU</FromUserName><MsgType>text</MsgType></xml>')),
    ).toBeNull();
  });
});

describe('the 48 hour window', () => {
  const now = new Date('2026-03-10T12:00:00Z');
  const ago = (h: number) => new Date(now.getTime() - h * 3_600_000);

  it("is 48 hours from the follower's last message, inclusive", () => {
    expect(WINDOW_HOURS).toBe(48);
    expect(windowOpen(ago(1), now)).toBe(true);
    expect(windowOpen(ago(48), now)).toBe(true);
    expect(windowOpen(ago(48.01), now)).toBe(false);
  });

  it('is closed before the follower has written', () => {
    expect(windowOpen(null, now)).toBe(false);
  });
});

describe('broadcast helpers', () => {
  it('text is cut to the limit in characters, never in the middle of an emoji', () => {
    expect(clipText('abc', 2)).toBe('ab');
    expect(clipText('abc', 3)).toBe('abc');
    expect(clipText('a😀b', 2)).toBe('a😀');
  });

  it('a tag id is the number the digits say, and 0 when they say nothing usable', () => {
    expect(tagIdOf('107')).toBe(107);
    expect(tagIdOf('0')).toBe(0);
    expect(tagIdOf(null)).toBe(0);
    expect(tagIdOf('abc')).toBe(0);
    expect(tagIdOf('-3')).toBe(0);
    expect(tagIdOf('1.5')).toBe(0);
  });

  it('a send stuck in sending is given up on after fifteen minutes', () => {
    expect(STALE_SENDING_MINUTES).toBe(15);
  });
});
