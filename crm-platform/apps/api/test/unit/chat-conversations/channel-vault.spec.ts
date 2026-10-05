import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { ChannelVault } from '../../../src/modules/chat-conversations/channel-vault';

const vault = (key = Buffer.alloc(32, 7).toString('base64')) =>
  new ChannelVault(new CryptoService({ get: () => key } as unknown as ConfigService<never, true>));

describe('ChannelVault: credentials at rest', () => {
  it('seals a document the database cannot read, and opens it again', () => {
    const v = vault();
    const sealed = v.seal({ accessToken: 'EAAB-very-secret-1234', phoneNumberId: '99' }, [
      'accessToken',
    ]);
    expect(sealed.cipher).toMatch(/^v1:/);
    expect(sealed.cipher).not.toContain('EAAB');
    const opened = v.open(sealed.cipher, 'ch');
    expect(opened).toEqual({
      state: 'readable',
      credentials: { accessToken: 'EAAB-very-secret-1234', phoneNumberId: '99' },
    });
  });

  it('keeps only the last four characters of each secret field as a hint, and none for non-secrets', () => {
    const sealed = vault().seal(
      { accessToken: 'abcdef1234', appSecret: 'zzzzzzzz5678', phoneNumberId: '99' },
      ['accessToken', 'appSecret'],
    );
    expect(sealed.hints).toEqual({ accessToken: '1234', appSecret: '5678' });
  });

  it('drops empty and undefined values', () => {
    const v = vault();
    const { cipher } = v.seal({ a: 'x', b: '', c: undefined }, []);
    expect(v.open(cipher, 'ch')).toEqual({ state: 'readable', credentials: { a: 'x' } });
  });

  it('a missing value reads as none; a tampered or foreign-key value reads as unreadable and never throws', () => {
    const v = vault();
    expect(v.open(null, 'ch')).toEqual({ state: 'none' });
    expect(v.open('', 'ch')).toEqual({ state: 'none' });
    const { cipher } = v.seal({ a: 'secret' }, []);
    const parts = cipher.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(v.open(parts.join(':'), 'ch')).toEqual({ state: 'unreadable' });
    expect(vault(Buffer.alloc(32, 9).toString('base64')).open(cipher, 'ch')).toEqual({
      state: 'unreadable',
    });
    expect(v.open('not-a-cipher', 'ch')).toEqual({ state: 'unreadable' });
  });

  it('two seals of the same document differ (random IV)', () => {
    const v = vault();
    expect(v.seal({ a: 'x' }, []).cipher).not.toBe(v.seal({ a: 'x' }, []).cipher);
  });
});

describe('ChannelVault: the webhook verify token', () => {
  it('is random, shown as itself once, and kept only as a SHA-256 hash that matches in constant time', () => {
    const v = vault();
    const a = v.newWebhookToken();
    const b = v.newWebhookToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).not.toContain(a.token);
    expect(v.tokenMatches(a.token, a.hash)).toBe(true);
    expect(v.tokenMatches(b.token, a.hash)).toBe(false);
    expect(v.tokenMatches('', a.hash)).toBe(false);
  });

  it('a channel with no token never matches anything', () => {
    expect(vault().tokenMatches('anything', null)).toBe(false);
  });
});
