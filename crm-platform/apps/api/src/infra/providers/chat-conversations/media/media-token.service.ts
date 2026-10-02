import { Injectable } from '@nestjs/common';
import { CryptoService } from '../../../../common/crypto/crypto.service';
import { chatMediaConfig } from './media.config';

/** What a media link stands for. */
export interface MediaTokenPayload {
  /** The stored object key. */
  key: string;
  orgId: number;
  /** The staff user the link was minted for: it opens for nobody else. */
  userId: number;
  /** Display name and type from the message row, used for the download name and the Content-Type. */
  name?: string;
  mime?: string;
}

/**
 * Short-lived media links.
 *
 * The token is the payload sealed with the platform's AES-256-GCM key (`CryptoService`), so it is unreadable (the object key and
 * the workspace id stay on the server) and unforgeable (a changed byte fails authentication), with an expiry inside. It is
 * stateless: nothing is written when a thread of fifty images is read.
 *
 * It is a capability for ONE object, for ONE person, for minutes, minted after the caller proved access to the conversation. It
 * is never an address that works on its own: the media route still needs the person's session.
 */
@Injectable()
export class MediaTokenService {
  constructor(private readonly crypto: CryptoService) {}

  sign(
    payload: MediaTokenPayload,
    ttlSeconds = chatMediaConfig().tokenTtlSeconds,
    nowMs = Date.now(),
  ): string {
    const body = JSON.stringify({
      k: payload.key,
      o: payload.orgId,
      u: payload.userId,
      n: payload.name,
      m: payload.mime,
      x: Math.floor(nowMs / 1000) + ttlSeconds,
    });
    return Buffer.from(this.crypto.encrypt(body), 'utf8').toString('base64url');
  }

  /** The payload, or null for a forged, damaged, malformed or expired token (the caller cannot tell which). */
  verify(token: string, nowMs = Date.now()): MediaTokenPayload | null {
    if (
      typeof token !== 'string' ||
      token.length < 40 ||
      token.length > 2048 ||
      !/^[A-Za-z0-9_-]+$/.test(token)
    )
      return null;
    try {
      const raw = JSON.parse(
        this.crypto.decrypt(Buffer.from(token, 'base64url').toString('utf8')),
      ) as {
        k?: unknown;
        o?: unknown;
        u?: unknown;
        n?: unknown;
        m?: unknown;
        x?: unknown;
      };
      if (
        typeof raw.k !== 'string' ||
        typeof raw.o !== 'number' ||
        typeof raw.u !== 'number' ||
        typeof raw.x !== 'number' ||
        raw.x * 1000 <= nowMs
      ) {
        return null;
      }
      return {
        key: raw.k,
        orgId: raw.o,
        userId: raw.u,
        name: typeof raw.n === 'string' ? raw.n : undefined,
        mime: typeof raw.m === 'string' ? raw.m : undefined,
      };
    } catch {
      return null;
    }
  }
}
