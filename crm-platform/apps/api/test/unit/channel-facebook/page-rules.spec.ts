import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  STATE_TTL_MS,
  attachmentType,
  clipError,
  commentThreadKey,
  connectSummary,
  dmThreadKey,
  isTokenError,
  loginUrl,
  parseThreadKey,
  preview,
  readState,
  senderName,
  signatureMatches,
  verifyHandshake,
  webhookAddress,
} from '../../../src/modules/channel-facebook/page-rules';

const NOW = 1_800_000_000_000;
const state = (o: object) => JSON.stringify({ orgId: 3, userId: 9, at: NOW, nonce: 'abc', ...o });

describe('connecting a Page (TW-FB-002, 003)', () => {
  it('the webhook address is forced to https and tolerates a trailing slash', () => {
    expect(webhookAddress('http://localhost:3000')).toBe(
      'https://localhost:3000/v2/facebook/webhook',
    );
    expect(webhookAddress('https://api.example.com/')).toBe(
      'https://api.example.com/v2/facebook/webhook',
    );
  });

  it('the login dialog carries the scopes, and a configuration id replaces them in effect', () => {
    const base = {
      graphVersion: 'v21.0',
      appId: '123',
      redirectUri: 'https://api.test/v2/facebook/callback',
      state: 'sealed',
      scopes: ['pages_show_list', 'pages_messaging'],
    };
    const plain = new URL(loginUrl({ ...base, configId: null }));
    expect(plain.origin + plain.pathname).toBe('https://www.facebook.com/v21.0/dialog/oauth');
    expect(plain.searchParams.get('scope')).toBe('pages_show_list,pages_messaging');
    expect(plain.searchParams.get('state')).toBe('sealed');
    expect(plain.searchParams.get('response_type')).toBe('code');
    expect(plain.searchParams.has('config_id')).toBe(false);

    const withConfig = new URL(loginUrl({ ...base, configId: 'cfg1' }));
    expect(withConfig.searchParams.get('config_id')).toBe('cfg1');
    expect(withConfig.searchParams.get('override_default_response_type')).toBe('true');
  });

  it('a state is good only when it parses, is fresh and is not from the future (login-CSRF)', () => {
    expect(readState(state({}), NOW + 1000)).toEqual({
      orgId: 3,
      userId: 9,
      at: NOW,
      nonce: 'abc',
    });
    expect(readState(state({ userId: null }), NOW)?.userId).toBeNull();
    expect(readState(state({}), NOW + STATE_TTL_MS + 1)).toBeNull();
    expect(readState(state({ at: NOW + 120_000 }), NOW)).toBeNull();
    expect(readState('not json', NOW)).toBeNull();
    expect(readState('null', NOW)).toBeNull();
    expect(readState(state({ orgId: '3' }), NOW)).toBeNull();
    expect(readState(state({ nonce: 5 }), NOW)).toBeNull();
    expect(readState(state({ userId: 'x' }), NOW)).toBeNull();
  });

  it('the summary names one Page, or counts several and names the first five', () => {
    expect(connectSummary(['Shop'])).toBe('Facebook Page “Shop” connected.');
    expect(connectSummary(['A', 'B', 'C'])).toBe('3 Facebook Pages connected: A, B, C');
    expect(connectSummary(['A', 'B', 'C', 'D', 'E', 'F'])).toBe(
      '6 Facebook Pages connected: A, B, C, D, E…',
    );
  });

  it('errors are clipped to 490 characters; Meta code 190 is the revoked-token code', () => {
    expect(clipError('x'.repeat(600))).toHaveLength(490);
    expect(clipError(null)).toBeNull();
    expect(clipError('')).toBeNull();
    expect(isTokenError(190)).toBe(true);
    expect(isTokenError(10)).toBe(false);
    expect(isTokenError(undefined)).toBe(false);
  });
});

describe('the webhook door (TW-FB-006)', () => {
  const secret = 'app-secret';
  const body = Buffer.from('{"object":"page"}');
  const sign = (s: string, b: Buffer | string = body) =>
    `sha256=${createHmac('sha256', s).update(b).digest('hex')}`;

  it('a signature made with any configured secret matches, a forged or malformed one does not', () => {
    expect(signatureMatches(body, sign(secret), [secret])).toBe(true);
    expect(signatureMatches(body, sign('other'), ['first', 'other'])).toBe(true);
    expect(signatureMatches(body, sign('wrong'), [secret])).toBe(false);
    expect(signatureMatches(body, sign(secret, 'tampered'), [secret])).toBe(false);
    expect(signatureMatches(body, sign(secret).replace('sha256=', ''), [secret])).toBe(false);
    expect(signatureMatches(body, '', [secret])).toBe(false);
    expect(signatureMatches(body, sign(secret), [''])).toBe(false);
  });

  it('the handshake answers only for subscribe with the exact token', () => {
    expect(verifyHandshake('subscribe', 'tok', 'tok')).toBe(true);
    expect(verifyHandshake('subscribe', 'tox', 'tok')).toBe(false);
    expect(verifyHandshake('subscribe', 'toke', 'tok')).toBe(false);
    expect(verifyHandshake('unsubscribe', 'tok', 'tok')).toBe(false);
    expect(verifyHandshake('subscribe', '', null)).toBe(false);
    expect(verifyHandshake('subscribe', '', '')).toBe(false);
  });
});

describe('threads and replies (TW-FB-007, 009, 011)', () => {
  it('a DM thread and a comment thread have distinct keys, and a missing commenter is anon', () => {
    expect(dmThreadKey('P1', '555')).toBe('fb:P1:555');
    expect(commentThreadKey('P1', 'P1_77', '555')).toBe('fb:P1:post:P1_77:555');
    expect(commentThreadKey('P1', 'P1_77', '')).toBe('fb:P1:post:P1_77:anon');
  });

  it('a thread key reads back to the Page and the person or post; anything else is not ours', () => {
    expect(parseThreadKey('fb:P1:555')).toEqual({ kind: 'dm', pageId: 'P1', psid: '555' });
    expect(parseThreadKey('fb:P1:post:P1_77:555')).toEqual({
      kind: 'comment',
      pageId: 'P1',
      postId: 'P1_77',
    });
    expect(parseThreadKey('fb:P1:post:P1_77:anon')).toEqual({
      kind: 'comment',
      pageId: 'P1',
      postId: 'P1_77',
    });
    expect(parseThreadKey('tg:1:2')).toBeNull();
    expect(parseThreadKey('fb:')).toBeNull();
    expect(parseThreadKey('fb:P1')).toBeNull();
    expect(parseThreadKey('fb:P1:post')).toBeNull();
  });

  it('the preview is cut at 120 characters', () => {
    expect(preview('hi')).toBe('hi');
    expect(preview('x'.repeat(120))).toHaveLength(120);
    expect(preview('x'.repeat(200))).toBe(`${'x'.repeat(117)}...`);
  });

  it('a sender is named by name, else first and last, else nothing', () => {
    expect(senderName({ name: ' Asha Rao ', first_name: 'A' })).toBe('Asha Rao');
    expect(senderName({ first_name: 'Asha', last_name: 'Rao' })).toBe('Asha Rao');
    expect(senderName({ first_name: 'Asha' })).toBe('Asha');
    expect(senderName({})).toBe('');
    expect(senderName(null)).toBe('');
  });

  it('an inbox media type maps to the attachment Meta expects', () => {
    expect(attachmentType('image')).toBe('image');
    expect(attachmentType('sticker')).toBe('image');
    expect(attachmentType('video')).toBe('video');
    expect(attachmentType('ptt')).toBe('audio');
    expect(attachmentType('document')).toBe('file');
    expect(attachmentType(null)).toBe('file');
  });
});
