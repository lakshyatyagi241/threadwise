import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  clipError,
  isNumericChannelId,
  lineSignature,
  randomToken,
  signatureMatches,
  webhookRefusedMessage,
  webhookUrl,
} from '../../../src/modules/channel-line/channel-rules';

describe('the routing token', () => {
  it('is 48 URL-safe characters and differs every time', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9]{48}$/);
    expect(randomToken()).not.toBe(a);
  });
});

describe('webhookUrl', () => {
  it('is the versioned inbound path, forced to https, without a double slash', () => {
    expect(webhookUrl('http://app.example.com/', 'tok')).toBe(
      'https://app.example.com/v2/line/inbound/tok',
    );
    expect(webhookUrl('https://app.example.com', 'tok')).toBe(
      'https://app.example.com/v2/line/inbound/tok',
    );
  });
});

describe('clipError', () => {
  it('keeps 255 characters, and null for nothing', () => {
    expect(clipError('x'.repeat(300))).toHaveLength(255);
    expect(clipError('')).toBeNull();
    expect(clipError(undefined)).toBeNull();
  });

  it('names the tunnel hint when LINE refuses the webhook', () => {
    expect(webhookRefusedMessage('bad url')).toContain('LINE refused the webhook: bad url');
    expect(webhookRefusedMessage('bad url')).toContain('public HTTPS');
  });
});

describe('X-Line-Signature', () => {
  const body = Buffer.from('{"destination":"U1","events":[]}');

  it('is the base64 of HMAC-SHA256 of the raw body keyed by the channel secret', () => {
    const expected = createHmac('sha256', 'secret-value').update(body).digest('base64');
    expect(lineSignature(body, 'secret-value')).toBe(expected);
  });

  it('matches only the right secret and the exact body', () => {
    const sig = lineSignature(body, 'channel-secret-1234');
    expect(signatureMatches(body, 'channel-secret-1234', sig)).toBe(true);
    expect(signatureMatches(body, 'another-secret-1234', sig)).toBe(false);
    expect(signatureMatches(Buffer.from('{"events":[]}'), 'channel-secret-1234', sig)).toBe(false);
  });

  it('never matches a missing secret, a missing header or a header of another length', () => {
    const sig = lineSignature(body, 'channel-secret-1234');
    expect(signatureMatches(body, '', sig)).toBe(false);
    expect(signatureMatches(body, 'channel-secret-1234', '')).toBe(false);
    expect(signatureMatches(body, 'channel-secret-1234', sig.slice(1))).toBe(false);
  });
});

describe('isNumericChannelId', () => {
  it('accepts the console Channel ID and refuses a bot user id', () => {
    expect(isNumericChannelId('1234567890')).toBe(true);
    expect(isNumericChannelId('U4af4980629abcdef')).toBe(false);
    expect(isNumericChannelId('')).toBe(false);
    expect(isNumericChannelId(null)).toBe(false);
  });
});
