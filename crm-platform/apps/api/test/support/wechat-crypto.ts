import { createCipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * What WeChat does on its side, for the tests: the signature, and the AES "safe mode" envelope (`[16 random bytes][4 byte big-endian
 * length][message][AppID]`, padded to 32 bytes, AES-256-CBC with the EncodingAESKey). Written from WeChat's published algorithm, not
 * from the code under test, so a mistake in one does not hide in the other.
 */
export const AES_KEY = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';

export const sha1Sorted = (...parts: string[]): string =>
  createHash('sha1').update(parts.sort().join('')).digest('hex');

export function encryptSafeMode(encodingAesKey: string, message: string, appId: string): string {
  const key = Buffer.from(`${encodingAesKey}=`, 'base64');
  const body = Buffer.from(message, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const plain = Buffer.concat([randomBytes(16), len, body, Buffer.from(appId, 'utf8')]);
  const pad = 32 - (plain.length % 32);
  const padded = Buffer.concat([plain, Buffer.alloc(pad, pad)]);
  const c = createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
  c.setAutoPadding(false);
  return Buffer.concat([c.update(padded), c.final()]).toString('base64');
}

/** A text message the way WeChat posts it. */
export const textXml = (o: {
  openid: string;
  to?: string;
  content: string;
  msgId: string | number;
  createTime?: number;
}): string =>
  `<xml><ToUserName><![CDATA[${o.to ?? 'gh_account'}]]></ToUserName><FromUserName><![CDATA[${o.openid}]]></FromUserName>` +
  `<CreateTime>${o.createTime ?? 1700000000}</CreateTime><MsgType><![CDATA[text]]></MsgType>` +
  `<Content><![CDATA[${o.content}]]></Content><MsgId>${o.msgId}</MsgId></xml>`;

export const eventXml = (o: {
  openid: string;
  event: string;
  key?: string;
  createTime?: number;
}): string =>
  `<xml><ToUserName><![CDATA[gh_account]]></ToUserName><FromUserName><![CDATA[${o.openid}]]></FromUserName>` +
  `<CreateTime>${o.createTime ?? 1700000000}</CreateTime><MsgType><![CDATA[event]]></MsgType>` +
  `<Event><![CDATA[${o.event}]]></Event>${o.key !== undefined ? `<EventKey><![CDATA[${o.key}]]></EventKey>` : ''}</xml>`;
