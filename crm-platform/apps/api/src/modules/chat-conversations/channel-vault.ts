import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { CryptoService } from '../../common/crypto/crypto.service';

export type Credentials = Record<string, string | undefined>;

export type CredentialsRead =
  { state: 'none' } | { state: 'unreadable' } | { state: 'readable'; credentials: Credentials };

const lastFour = (v: string): string => v.slice(-4);

/**
 * Channel credentials at rest: one JSON document sealed with the credentials key (AES-GCM) before it is stored, opened when a send or a
 * webhook needs it. A cell that cannot be opened (the key changed, the value was edited by hand) reads as "unreadable" and is logged by
 * channel reference, never thrown: one stale row must not break the channel list. The plaintext leaves this class only to the caller that
 * is about to use it and is never logged.
 *
 * The webhook verify token is the other secret a channel has: it is random, shown once, and only its SHA-256 is kept, which is all the
 * provider's challenge needs (a constant-time comparison of two hashes).
 */
@Injectable()
export class ChannelVault {
  private readonly logger = new Logger(ChannelVault.name);

  constructor(private readonly crypto: CryptoService) {}

  seal(
    credentials: Credentials,
    secretFields: readonly string[],
  ): { cipher: string; hints: Record<string, string> } {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(credentials)) if (v !== undefined && v !== '') clean[k] = v;
    const hints: Record<string, string> = {};
    for (const f of secretFields) {
      const v = clean[f];
      if (v) hints[f] = lastFour(v);
    }
    return { cipher: this.crypto.encrypt(JSON.stringify(clean)), hints };
  }

  open(cipher: string | null | undefined, ref: string): CredentialsRead {
    if (!cipher) return { state: 'none' };
    try {
      const parsed: unknown = JSON.parse(this.crypto.decrypt(cipher));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      return { state: 'readable', credentials: parsed as Credentials };
    } catch {
      this.logger.warn(
        { ref },
        'stored channel credentials could not be opened; treating them as absent',
      );
      return { state: 'unreadable' };
    }
  }

  newWebhookToken(): { token: string; hash: string } {
    const token = randomBytes(24).toString('base64url');
    return { token, hash: this.hashToken(token) };
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Constant time, and false on a missing hash (a channel with no token never matches). */
  tokenMatches(presented: string, storedHash: string | null): boolean {
    if (!storedHash) return false;
    const a = Buffer.from(this.hashToken(presented), 'hex');
    const b = Buffer.from(storedHash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
