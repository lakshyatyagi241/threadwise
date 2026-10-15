import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Env } from '../../config/env.schema';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits — the size GCM is specified for
/**
 * Blob layout: `v1:<iv>:<tag>:<ct>[:<key id>]`. The key id is a trailing segment
 * on purpose, not a new version: an instance still running the old four-segment
 * reader decrypts a new blob (it ignores the extra segment), so a rolling deploy
 * never meets a value it cannot open. Blobs written before rotation existed have
 * no key id and are tried against every key in the ring.
 */
const VERSION = 'v1';

interface RingKey {
  /** First 8 hex characters of SHA-256(key): names a key without revealing it. */
  id: string;
  key: Buffer;
}

function toRingKey(base64: string, label: string): RingKey {
  const key = Buffer.from(base64.trim(), 'base64');
  if (key.length !== 32) {
    throw new Error(
      `${label} must be 32 bytes, base64-encoded. Generate one with: openssl rand -base64 32`,
    );
  }
  return { id: createHash('sha256').update(key).digest('hex').slice(0, 8), key };
}

/**
 * Application-layer encryption for secrets that must be readable again:
 * channel access tokens, API-key HMAC secrets, gateway credentials, MFA secrets.
 *
 * Passwords do NOT come through here — those are hashed with argon2 and are
 * never decrypted.
 *
 * Key rotation (TW-AUTH-047). Reference had a single APP_KEY: losing or changing
 * it bricked every stored secret. Here every blob names the key that sealed it
 * (`v1:<iv>:<tag>:<ct>:<key id>`) and the service holds a ring:
 *
 *   CREDENTIALS_ENCRYPTION_KEY                 the key new blobs are sealed with
 *   CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS       comma-separated older keys, decrypt only
 *
 * To rotate: move the current key into PREVIOUS_KEYS, set a fresh current key,
 * deploy, run the re-encrypt command (`maintenance/reencrypt-secrets.cli.ts`)
 * until it reports nothing left under an old key, then drop the old key. Blobs
 * without a key id (written before rotation existed) are tried against every key
 * in the ring.
 */
@Injectable()
export class CryptoService {
  private readonly current: RingKey;
  private readonly ring: RingKey[];

  constructor(config: ConfigService<Env, true>) {
    this.current = toRingKey(
      config.get('CREDENTIALS_ENCRYPTION_KEY', { infer: true }),
      'CREDENTIALS_ENCRYPTION_KEY',
    );
    // Not in the validated Env type on purpose: it is optional, and the schema
    // file belongs to the platform kernel. ConfigService falls back to process.env.
    const previousRaw = (config as unknown as ConfigService).get<string>(
      'CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS',
    );
    const previous = (previousRaw ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
      .map((k) => toRingKey(k, 'CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS'))
      .filter((k) => k.id !== this.current.id);
    this.ring = [this.current, ...previous];
  }

  /** The id of the key new blobs are sealed with. */
  get currentKeyId(): string {
    return this.current.id;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.current.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [
      VERSION,
      iv.toString('base64'),
      tag.toString('base64'),
      ciphertext.toString('base64'),
      this.current.id,
    ].join(':');
  }

  decrypt(encoded: string): string {
    const parsed = this.parse(encoded);
    // A blob with a key id names its key; one without does not, so every ring
    // key is a candidate. GCM's tag makes a wrong key fail loudly, never decrypt to garbage.
    const candidates =
      parsed.keyId === null ? this.ring : this.ring.filter((k) => k.id === parsed.keyId);
    if (candidates.length === 0) {
      throw new Error(
        `ciphertext was sealed with key ${parsed.keyId}, which is not in the key ring`,
      );
    }
    let last: unknown;
    for (const candidate of candidates) {
      try {
        return this.open(candidate.key, parsed.iv, parsed.tag, parsed.data);
      } catch (err) {
        last = err;
      }
    }
    throw last instanceof Error ? last : new Error('decryption failed');
  }

  /** True when the blob is sealed with the current key (and so needs no re-encryption). */
  isCurrent(encoded: string): boolean {
    try {
      return this.parse(encoded).keyId === this.current.id;
    } catch {
      return false;
    }
  }

  /** The key id a blob names; null for blobs written before key ids existed. */
  keyIdOf(encoded: string): string | null {
    return this.parse(encoded).keyId;
  }

  /** The same plaintext sealed with the current key; a blob already under it is returned as is. */
  reencrypt(encoded: string): string {
    return this.isCurrent(encoded) ? encoded : this.encrypt(this.decrypt(encoded));
  }

  private parse(encoded: string): {
    keyId: string | null;
    iv: Buffer;
    tag: Buffer;
    data: Buffer;
  } {
    const parts = typeof encoded === 'string' ? encoded.split(':') : [];
    if (parts[0] !== VERSION || (parts.length !== 4 && parts.length !== 5)) {
      throw new Error('malformed ciphertext');
    }
    const [, ivB64, tagB64, dataB64, keyId] = parts;
    // An empty plaintext seals to an empty ciphertext (GCM still produces a tag), so the data segment may be empty; iv and tag may not.
    if (!ivB64 || !tagB64 || dataB64 === undefined || (parts.length === 5 && !keyId)) {
      throw new Error('malformed ciphertext');
    }
    return {
      keyId: keyId ?? null,
      iv: Buffer.from(ivB64, 'base64'),
      tag: Buffer.from(tagB64, 'base64'),
      data: Buffer.from(dataB64, 'base64'),
    };
  }

  private open(key: Buffer, iv: Buffer, tag: Buffer, data: Buffer): string {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    // GCM authenticates as well as encrypts: a tampered ciphertext throws
    // here instead of silently decrypting to garbage.
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }
}
