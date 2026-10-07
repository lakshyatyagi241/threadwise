import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { IMPERSONATION_MAX_MINUTES, type TokenPair } from '@crm/contracts';
import type { ActorType } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';

export type { TokenPair };

export interface TokenClaims {
  /** Internal actor id within its own pool. */
  sub: number;
  /** Internal org id. 0 for platform operators. */
  org: number;
  /** Which identity pool the subject belongs to. Guards branch on this. */
  typ: Extract<ActorType, 'user' | 'partner_agent' | 'candidate' | 'platform_operator'>;
  /** External uuid, so a client never has to handle the internal id. */
  uid: string;
  /** Session id (uuid). Present for staff users and operators. */
  sid?: string;
  /** Platform token epoch at issue time; a bump invalidates every older token. */
  ep?: number;
  /** Refresh counter (refresh tokens only). */
  rv?: number;
  /** Session was created with "keep me signed in": exempt from the idle timeout. */
  rm?: boolean;
  /**
   * Act-as claim: a platform operator is using this workspace user's identity (TW-WSP-032). Only ever on an access token
   * from `issueImpersonation`; `sid` is then the impersonation session's uuid, not an auth_sessions row.
   */
  imp?: ImpersonationClaim;
}

export interface ImpersonationClaim {
  /** impersonation_sessions.uuid (equals the token's `sid`). */
  sid: string;
  /** Operator id (platform_operators.id). */
  oid: number;
  /** Read-only session: the guard refuses every write. */
  ro: boolean;
  /** Session end, unix seconds. The token's own `exp` is never later. */
  exp: number;
}

/**
 * "15m", "30d", "900" to seconds. TTLs arrive from env as strings; the web app
 * needs a number to set a cookie lifetime.
 */
export function ttlToSeconds(ttl: string): number {
  const m = /^(\d+)\s*([smhd]?)$/i.exec(ttl.trim());
  if (!m) throw new Error(`unparseable TTL: ${ttl}`);
  const n = Number(m[1]);
  const unit = (m[2] || 's').toLowerCase();
  return n * { s: 1, m: 60, h: 3600, d: 86_400 }[unit as 's' | 'm' | 'h' | 'd'];
}

/**
 * jsonwebtoken's types model expiresIn as a narrow template literal union,
 * which no runtime-configured value can satisfy. Seconds as a number are
 * always valid, so everything is passed that way: one cast, here.
 */
const signOptions = (secret: string, expiresInSeconds: number): JwtSignOptions =>
  ({ secret, expiresIn: expiresInSeconds }) as JwtSignOptions;

/**
 * Issues and verifies JWTs for all human identity pools.
 *
 * Access and refresh tokens are signed with DIFFERENT secrets. If they shared
 * one, a leaked access token could be replayed as a refresh token and the
 * short access TTL would buy nothing.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  accessTtlSeconds(): number {
    return ttlToSeconds(this.config.get('JWT_ACCESS_TTL', { infer: true }));
  }

  refreshTtlSeconds(): number {
    return ttlToSeconds(this.config.get('JWT_REFRESH_TTL', { infer: true }));
  }

  /**
   * `refreshTtlSeconds` shortens the refresh token for sessions that did not
   * tick "keep me signed in"; it can never exceed the configured maximum.
   */
  async issue(
    claims: TokenClaims,
    options: { refreshTtlSeconds?: number } = {},
  ): Promise<TokenPair> {
    const accessTtl = this.accessTtlSeconds();
    const refreshTtl = Math.min(
      options.refreshTtlSeconds ?? this.refreshTtlSeconds(),
      this.refreshTtlSeconds(),
    );

    const { rv, ...accessClaims } = claims;
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        accessClaims,
        signOptions(this.config.get('JWT_ACCESS_SECRET', { infer: true }), accessTtl),
      ),
      this.jwt.signAsync(
        { ...accessClaims, ...(rv !== undefined ? { rv } : {}) },
        signOptions(this.config.get('JWT_REFRESH_SECRET', { infer: true }), refreshTtl),
      ),
    ]);

    return { accessToken, refreshToken, expiresIn: accessTtl };
  }

  /**
   * The act-as token of an impersonation session: access only, no refresh token, and it can never outlive the session. Nothing
   * can renew it; when it runs out the operator starts again from the console. Unlike a normal access token it is not capped by
   * the 15-minute access TTL (there is no refresh to extend it); the cap is the impersonation maximum.
   */
  async issueImpersonation(
    claims: TokenClaims & { imp: ImpersonationClaim },
    ttlSeconds: number,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const expiresIn = Math.max(1, Math.min(Math.floor(ttlSeconds), IMPERSONATION_MAX_MINUTES * 60));
    const accessToken = await this.jwt.signAsync(
      claims,
      signOptions(this.config.get('JWT_ACCESS_SECRET', { infer: true }), expiresIn),
    );
    return { accessToken, expiresIn };
  }

  async verifyAccess(token: string): Promise<TokenClaims> {
    try {
      return await this.jwt.verifyAsync<TokenClaims>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      });
    } catch {
      // Never say *why* — "expired" vs "malformed" vs "bad signature" is a
      // free hint to anyone probing the endpoint.
      throw AppError.unauthenticated('Invalid or expired token');
    }
  }

  /**
   * Signature check only, for ending a session with an access token that has
   * just run out (sign-out). It proves whose session it was; it must never be
   * used to let a request through.
   */
  async verifyAccessIgnoringExpiry(token: string): Promise<TokenClaims> {
    try {
      return await this.jwt.verifyAsync<TokenClaims>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        ignoreExpiration: true,
      });
    } catch {
      throw AppError.unauthenticated('Invalid or expired token');
    }
  }

  async verifyRefresh(token: string): Promise<TokenClaims> {
    try {
      return await this.jwt.verifyAsync<TokenClaims>(token, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      });
    } catch {
      throw AppError.unauthenticated('Invalid or expired refresh token');
    }
  }
}
