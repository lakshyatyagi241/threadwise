import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Env } from '../../config/env.schema';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits — the size GCM is specified for
const VERSION = 'v1';

/**
 * Application-layer encryption for secrets that must be readable again:
 * channel access tokens, API-key HMAC secrets, gateway credentials.
 *
 * Passwords do NOT come through here — those are hashed with argon2 and are
 * never decrypted.
 *
 * Format: `v1:<iv-b64>:<tag-b64>:<ciphertext-b64>`. The version prefix is
 * there so a future key rotation or algorithm change can read old values
 * instead of bricking every stored credential.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService<Env, true>) {
    const raw = config.get('CREDENTIALS_ENCRYPTION_KEY', { infer: true });
    this.key = Buffer.from(raw, 'base64');
    if (this.key.length !== 32) {
      throw new Error(
        'CREDENTIALS_ENCRYPTION_KEY must be 32 bytes, base64-encoded. Generate one with: openssl rand -base64 32',
      );
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [
      VERSION,
      iv.toString('base64'),
      tag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(encoded: string): string {
    const [version, ivB64, tagB64, dataB64] = encoded.split(':');
    if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
      throw new Error('malformed ciphertext');
    }

    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivB64, 'base64'));
    // GCM authenticates as well as encrypts: a tampered ciphertext throws
    // here instead of silently decrypting to garbage.
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
