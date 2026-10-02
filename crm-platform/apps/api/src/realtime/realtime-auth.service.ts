import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppError } from '../common/errors/app-error';
import type { ActorType } from '../common/context/request-context';
import { REDIS_CLIENT } from '../infra/redis/redis.module';
import { TokenService, type TokenClaims } from '../modules/auth';
import { EpochService } from '../modules/auth/sessions/epoch.service';
import { AuthKeys } from '../modules/auth/support/redis-keys';
import { RealtimeTicketService } from './ticket/realtime-ticket.service';

/** Who is on the other end of a socket. Set once at the handshake and never taken from anything the client sends later. */
export interface SocketIdentity {
  orgId: number;
  /** Internal id within the actor's own pool (a staff user id for `user`). */
  actorId: number;
  actorType: ActorType;
  /** The actor's external uuid. */
  uid: string;
  /** The session behind the connection: ending it ends the socket. */
  sid?: string;
  ep?: number;
}

const toIdentity = (claims: Omit<TokenClaims, 'rv'>): SocketIdentity => ({
  orgId: claims.org,
  actorId: claims.sub,
  actorType: claims.typ,
  uid: claims.uid,
  sid: claims.sid,
  ep: claims.ep,
});

/**
 * Turns a handshake into an identity, and later says whether that identity is still good.
 *
 * Two ways in: a one-time ticket (the browser, see `RealtimeTicketService`) or an access token (a server-side client that can
 * hold one). Either way the session must be alive: a connection made with a token whose session was revoked is refused,
 * exactly as an HTTP request would be.
 */
@Injectable()
export class RealtimeAuthService {
  private readonly logger = new Logger(RealtimeAuthService.name);

  constructor(
    private readonly tickets: RealtimeTicketService,
    private readonly tokens: TokenService,
    private readonly epoch: EpochService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Throws `UNAUTHENTICATED` for anything that is not a valid, live credential. The reason is never revealed to the client. */
  async authenticate(auth: unknown, authorizationHeader?: string): Promise<SocketIdentity> {
    const handshake = (auth ?? {}) as { ticket?: unknown; token?: unknown };

    let claims: Omit<TokenClaims, 'rv'> | null = null;
    if (handshake.ticket !== undefined) {
      claims = await this.tickets.consume(handshake.ticket);
    } else {
      const token =
        typeof handshake.token === 'string'
          ? handshake.token
          : authorizationHeader?.startsWith('Bearer ')
            ? authorizationHeader.slice('Bearer '.length).trim()
            : null;
      if (token) claims = await this.tokens.verifyAccess(token);
    }
    if (!claims) throw AppError.unauthenticated('Invalid or expired credential');
    // Platform operators belong to no workspace; there is no room for them.
    if (claims.typ === 'platform_operator' || !(claims.org > 0)) {
      throw AppError.unauthenticated('Invalid or expired credential');
    }

    const identity = toIdentity(claims);
    if ((await this.revoked([identity])).length > 0) {
      throw AppError.unauthenticated('Invalid or expired credential');
    }
    return identity;
  }

  /**
   * The identities among these whose session was ended (sign out, revoke, password reset) or whose token epoch was bumped
   * ("revoke everything"). One Redis round trip for the lot. Redis being down answers "none": like the HTTP guard, refusing
   * everyone because a cache is down would be the worse outcome.
   */
  async revoked(identities: SocketIdentity[]): Promise<SocketIdentity[]> {
    const backed = identities.filter((i) => i.sid !== undefined);
    if (backed.length === 0) return [];
    try {
      const [currentEpoch, flags] = await Promise.all([
        this.epoch.current(),
        this.redis.mget(backed.map((i) => AuthKeys.revoked(i.sid!))),
      ]);
      return backed.filter((identity, index) => flags[index] || (identity.ep ?? 0) < currentEpoch);
    } catch (err) {
      this.logger.warn({ err }, 'realtime session check skipped: redis unavailable');
      return [];
    }
  }
}
