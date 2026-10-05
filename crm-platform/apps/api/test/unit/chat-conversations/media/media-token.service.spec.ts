import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { CryptoService } from '../../../../src/common/crypto/crypto.service';
import { MediaTokenService } from '../../../../src/infra/providers/chat-conversations/media/media-token.service';

const crypto = (byte: number) =>
  new CryptoService(
    new ConfigService({
      CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, byte).toString('base64'),
    }) as never,
  );
const tokens = new MediaTokenService(crypto(7));
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
const PAYLOAD = {
  key: 'chat/3/2026/10/a.png',
  orgId: 3,
  userId: 7,
  name: 'photo.png',
  mime: 'image/png',
};

describe('MediaTokenService', () => {
  it('round-trips the payload', () => {
    expect(tokens.verify(tokens.sign(PAYLOAD, 300, NOW), NOW + 1000)).toEqual(PAYLOAD);
  });

  it('is URL safe and hides the key and the workspace', () => {
    const token = tokens.sign(PAYLOAD, 300, NOW);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain('chat');
    expect(Buffer.from(token, 'base64url').toString('utf8')).not.toContain('a.png');
  });

  it('expires: valid until the moment, refused from it', () => {
    const token = tokens.sign(PAYLOAD, 300, NOW);
    expect(tokens.verify(token, NOW + 299_000)).not.toBeNull();
    expect(tokens.verify(token, NOW + 300_000)).toBeNull();
    expect(tokens.verify(token, NOW + 3_600_000)).toBeNull();
  });

  it('refuses a token that was changed by one character', () => {
    const token = tokens.sign(PAYLOAD, 300, NOW);
    const i = Math.floor(token.length / 2);
    const forged = `${token.slice(0, i)}${token[i] === 'A' ? 'B' : 'A'}${token.slice(i + 1)}`;
    expect(tokens.verify(forged, NOW)).toBeNull();
  });

  it('refuses a token sealed with another key (another installation)', () => {
    const foreign = new MediaTokenService(crypto(9)).sign(PAYLOAD, 300, NOW);
    expect(tokens.verify(foreign, NOW)).toBeNull();
  });

  it.each([
    '',
    'short',
    'x'.repeat(5000),
    'not a token!!!',
    '%2e%2e%2f',
    null as unknown as string,
  ])('refuses garbage %j without throwing', (garbage) => {
    expect(() => tokens.verify(garbage as string, NOW)).not.toThrow();
    expect(tokens.verify(garbage as string, NOW)).toBeNull();
  });

  it('keeps name and mime optional', () => {
    const bare = { key: 'chat/3/a.bin', orgId: 3, userId: 7 };
    expect(tokens.verify(tokens.sign(bare, 60, NOW), NOW)).toEqual({
      ...bare,
      name: undefined,
      mime: undefined,
    });
  });
});
