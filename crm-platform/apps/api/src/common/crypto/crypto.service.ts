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
/**
 * Bound blob (encryption audit E4): `v2:<iv>:<tag>:<ct>:<key id>:<context label>`. The label is a hash of the context the value belongs to
 * (for example `push_subscriptions.auth:<org>:<user>`), it is the GCM associated data, and a reader must name the same context, so a blob
 * copied to another row or column no longer opens. The label sits in the blob on purpose: key rotation can then re-seal a bound blob
 * without knowing its context. A release that predates v2 cannot parse it, so v2 is only WRITTEN when CREDENTIALS_AAD_WRITE=on (default
 * off, switch it on after every instance runs a release that reads v2); every release from this one on reads both.
 */
const BOUND_VERSION = 'v2';
const labelOf = (context: string): string =>
  createHash('sha256').update(`aad:${context}`).digest('hex').slice(0, 32);

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
  private readonly aadWrite: boolean;

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
    const flag = (config as unknown as ConfigService).get<string>('CREDENTIALS_AAD_WRITE');
    this.aadWrite = (flag ?? '').trim().toLowerCase() === 'on';
  }

  /** The id of the key new blobs are sealed with. */
  get currentKeyId(): string {
    return this.current.id;
  }

  /**
   * Seals a value. With a `context` (what the value belongs to, e.g. `table.column:orgId:rowId`) and CREDENTIALS_AAD_WRITE=on the blob is
   * bound to that context (v2); otherwise it is the plain v1 format, which every release can read.
   */
  encrypt(plaintext: string, context?: string): string {
    return this.seal(
      plaintext,
      this.current,
      context !== undefined && this.aadWrite ? labelOf(context) : null,
    );
  }

  private seal(plaintext: string, key: RingKey, label: string | null): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key.key, iv);
    if (label !== null) cipher.setAAD(Buffer.from(label, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [
      label === null ? VERSION : BOUND_VERSION,
      iv.toString('base64'),
      tag.toString('base64'),
      ciphertext.toString('base64'),
      key.id,
      ...(label === null ? [] : [label]),
    ].join(':');
  }

  /** True for a blob bound to a context (v2). */
  isBound(encoded: string): boolean {
    return this.parse(encoded).label !== null;
  }

  /**
   * Opens a value. A bound (v2) blob needs the same `context` it was sealed with and refuses any other; a v1 blob has no binding and the
   * context is ignored, so a call site can pass it before the value was ever re-sealed.
   */
  decrypt(encoded: string, context?: string): string {
    const parsed = this.parse(encoded);
    if (parsed.label !== null) {
      if (context === undefined)
        throw new Error('ciphertext is bound to a context: pass it to decrypt');
      if (labelOf(context) !== parsed.label) {
        throw new Error('ciphertext was sealed for a different context');
      }
    }
    return this.openParsed(parsed);
  }

  private openParsed(parsed: ReturnType<CryptoService['parse']>): string {
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
        return this.open(candidate.key, parsed.iv, parsed.tag, parsed.data, parsed.label);
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

  /**
   * The same plaintext sealed with the current key; a blob already under it is returned as is. A bound blob stays bound to the same context
   * (its label travels in the blob), so key rotation needs no knowledge of where a value belongs.
   */
  reencrypt(encoded: string): string {
    if (this.isCurrent(encoded)) return encoded;
    const parsed = this.parse(encoded);
    return this.seal(this.openParsed(parsed), this.current, parsed.label);
  }

  private parse(encoded: string): {
    label: string | null;
    keyId: string | null;
    iv: Buffer;
    tag: Buffer;
    data: Buffer;
  } {
    const parts = typeof encoded === 'string' ? encoded.split(':') : [];
    const bound = parts[0] === BOUND_VERSION && parts.length === 6;
    if (!bound && (parts[0] !== VERSION || (parts.length !== 4 && parts.length !== 5))) {
      throw new Error('malformed ciphertext');
    }
    const [, ivB64, tagB64, dataB64, keyId, label] = parts;
    if (bound && (!keyId || !label || !/^[0-9a-f]{32}$/.test(label))) {
      throw new Error('malformed ciphertext');
    }
    // An empty plaintext seals to an empty ciphertext (GCM still produces a tag), so the data segment may be empty; iv and tag may not.
    if (!ivB64 || !tagB64 || dataB64 === undefined || (parts.length === 5 && !keyId)) {
      throw new Error('malformed ciphertext');
    }
    return {
      label: bound ? label! : null,
      keyId: keyId ?? null,
      iv: Buffer.from(ivB64, 'base64'),
      tag: Buffer.from(tagB64, 'base64'),
      data: Buffer.from(dataB64, 'base64'),
    };
  }

  private open(key: Buffer, iv: Buffer, tag: Buffer, data: Buffer, label: string | null): string {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    if (label !== null) decipher.setAAD(Buffer.from(label, 'utf8'));
    // GCM authenticates as well as encrypts: a tampered ciphertext throws
    // here instead of silently decrypting to garbage.
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }
}
