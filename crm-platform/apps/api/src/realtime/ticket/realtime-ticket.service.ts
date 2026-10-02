import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { REALTIME_TICKET_TTL_SECONDS, type RealtimeTicketResponse } from '@crm/contracts';
import type { TokenClaims } from '../../modules/auth';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';

const PREFIX = 'rtk_';
/** 32 random bytes in base64url: 43 characters. */
const TICKET_RE = /^rtk_[A-Za-z0-9_-]{43}$/;

const ticketKey = (ticket: string) =>
  `rt:ticket:${createHash('sha256').update(ticket).digest('hex')}`;

/** What a ticket stands for: the claims of the access token it was minted from. */
export type TicketClaims = Omit<TokenClaims, 'rv'>;

/**
 * The browser's way into the socket.
 *
 * The staff session lives in httpOnly cookies, which page JavaScript cannot read, and a socket connects straight to the API,
 * not through the same-origin proxy that holds the cookie. So the proxy asks the API (with the session token) for a ticket, the
 * page puts the ticket in the handshake, and the gateway swaps it for the identity.
 *
 * A ticket is 256 random bits, kept in Redis under the hash of its value (a copy of Redis reveals nothing usable), alive for
 * 60 seconds, and consumed by the first handshake that presents it (`GETDEL`: two sockets racing for one ticket cannot both
 * win). Being unguessable and held only by the server is what authenticates it; no signature is needed.
 */
@Injectable()
export class RealtimeTicketService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async mint(claims: TicketClaims): Promise<RealtimeTicketResponse> {
    const ticket = `${PREFIX}${randomBytes(32).toString('base64url')}`;
    await this.redis.set(
      ticketKey(ticket),
      JSON.stringify(claims),
      'EX',
      REALTIME_TICKET_TTL_SECONDS,
    );
    return { ticket, expiresIn: REALTIME_TICKET_TTL_SECONDS };
  }

  /** The claims the ticket was minted with, once. A used, expired, forged or malformed ticket is null. */
  async consume(ticket: unknown): Promise<TicketClaims | null> {
    if (typeof ticket !== 'string' || !TICKET_RE.test(ticket)) return null;
    const raw = await this.redis.getdel(ticketKey(ticket));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as TicketClaims;
    } catch {
      return null;
    }
  }
}
