import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createVibBroadcastSchema,
  connectViberChannelSchema,
  mediaExtension,
} from '@crm/contracts';
import {
  clipError,
  randomToken,
  senderObject,
  signatureMatches,
  webhookRefusedMessage,
  webhookUrl,
} from '../../../src/modules/channel-viber/channel-rules';
import {
  parseViberJson,
  tryParseViberJson,
} from '../../../src/infra/providers/channel-viber/viber-json';

const TOKEN = '445da6az1s345z78-dazcczb2542zv51a-e0vc5fva17480im9';
const sign = (raw: string, key = TOKEN) => createHmac('sha256', key).update(raw).digest('hex');

describe('channel rules (TW-VIB-002)', () => {
  it('a routing token is 48 URL-safe characters and never repeats', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9]{48}$/);
    expect(randomToken()).not.toBe(a);
  });

  it('the webhook address is forced to https and tolerates a trailing slash', () => {
    expect(webhookUrl('http://localhost:3000', 'abc')).toBe(
      'https://localhost:3000/v2/viber/inbound/abc',
    );
    expect(webhookUrl('https://api.example.com/', 'abc')).toBe(
      'https://api.example.com/v2/viber/inbound/abc',
    );
  });

  it('an error is kept to 255 characters; nothing stays nothing', () => {
    expect(clipError('x'.repeat(300))).toHaveLength(255);
    expect(clipError('')).toBeNull();
    expect(clipError(undefined)).toBeNull();
  });

  it('the refusal says the address must be public HTTPS with a valid certificate', () => {
    expect(webhookRefusedMessage('bad url')).toContain('bad url');
    expect(webhookRefusedMessage('x')).toMatch(/public HTTPS with a valid CA certificate/);
  });

  it('the sender object is the bot name, with its picture when it has one, "Bot" when unnamed', () => {
    expect(senderObject('Shop', 'https://a/b.png')).toEqual({
      name: 'Shop',
      avatar: 'https://a/b.png',
    });
    expect(senderObject('Shop', '')).toEqual({ name: 'Shop' });
    expect(senderObject(null, null)).toEqual({ name: 'Bot' });
  });

  it('the auth token must be at least 20 characters', () => {
    expect(connectViberChannelSchema.safeParse({ authToken: 'short' }).success).toBe(false);
    expect(connectViberChannelSchema.parse({ authToken: ` ${TOKEN} ` }).authToken).toBe(TOKEN);
  });
});

describe('X-Viber-Content-Signature (TW-VIB-003)', () => {
  const raw = '{"event":"message","timestamp":1}';

  it('is the hex HMAC-SHA256 of the raw body with the auth token', () => {
    expect(signatureMatches(Buffer.from(raw), sign(raw), TOKEN)).toBe(true);
    expect(signatureMatches(Buffer.from(raw), sign(raw).toUpperCase(), TOKEN)).toBe(true);
  });

  it('refuses a changed body, another key, a blank signature and a blank key', () => {
    expect(signatureMatches(Buffer.from(`${raw} `), sign(raw), TOKEN)).toBe(false);
    expect(signatureMatches(Buffer.from(raw), sign(raw, 'other'), TOKEN)).toBe(false);
    expect(signatureMatches(Buffer.from(raw), '', TOKEN)).toBe(false);
    expect(signatureMatches(Buffer.from(raw), sign(raw, ''), '')).toBe(false);
    expect(signatureMatches(Buffer.from(raw), 'abc', TOKEN)).toBe(false);
  });
});

describe('message tokens are 64 bit numbers', () => {
  it('keeps the digits of a large token that a JavaScript number would round', () => {
    const text = '{"event":"delivered","message_token":5098034272017990123,"user_id":"u"}';
    expect((JSON.parse(text) as { message_token: number }).message_token.toString()).not.toBe(
      '5098034272017990123',
    );
    expect((parseViberJson(text) as { message_token: string }).message_token).toBe(
      '5098034272017990123',
    );
  });

  it('leaves a small token and other numbers alone, and tolerates garbage', () => {
    expect(parseViberJson('{"message_token":42,"timestamp":1700000000000}')).toEqual({
      message_token: 42,
      timestamp: 1700000000000,
    });
    expect(tryParseViberJson('not json')).toBeUndefined();
  });
});

describe('the broadcast attachment (TW-VIB-012)', () => {
  const base = { name: 'n', channelId: crypto.randomUUID(), userIds: ['u1'] };

  it('reads the extension of an address, ignoring its query and fragment', () => {
    expect(mediaExtension('https://cdn.test/a/b/pic.PNG?sig=1.2#x')).toBe('png');
    expect(mediaExtension('https://cdn.test/noext')).toBe('');
    expect(mediaExtension('https://cdn.test/')).toBe('');
  });

  it('takes a jpg, png, gif or mp4 and refuses anything else, as Reference did', () => {
    for (const ext of ['jpg', 'jpeg', 'png', 'gif', 'mp4']) {
      expect(
        createVibBroadcastSchema.safeParse({ ...base, mediaUrl: `https://cdn.test/f.${ext}` })
          .success,
      ).toBe(true);
    }
    for (const ext of ['pdf', 'webp', 'mov']) {
      expect(
        createVibBroadcastSchema.safeParse({ ...base, mediaUrl: `https://cdn.test/f.${ext}` })
          .success,
      ).toBe(false);
    }
  });

  it('refuses a file over 26 MB', () => {
    const ok = { ...base, mediaUrl: 'https://cdn.test/f.mp4', mediaSize: 26 * 1024 * 1024 };
    expect(createVibBroadcastSchema.safeParse(ok).success).toBe(true);
    expect(
      createVibBroadcastSchema.safeParse({ ...ok, mediaSize: 26 * 1024 * 1024 + 1 }).success,
    ).toBe(false);
  });

  it('a text may be 7000 characters, not more', () => {
    expect(createVibBroadcastSchema.safeParse({ ...base, body: 'x'.repeat(7000) }).success).toBe(
      true,
    );
    expect(createVibBroadcastSchema.safeParse({ ...base, body: 'x'.repeat(7001) }).success).toBe(
      false,
    );
  });
});
