import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import type { ActorType } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';

export interface TokenClaims {
  /** Internal actor id within its own pool. */
  sub: number;
  /** Internal org id. */
  org: number;
  /** Which identity pool the subject belongs to. Guards branch on this. */
  typ: Extract<ActorType, 'user' | 'partner_agent' | 'candidate'>;
  /** External uuid, so a client never has to handle the internal id. */
  uid: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

/**
 * TTLs come from validated env as plain strings ('15m', '30d').
 * jsonwebtoken's types model that as a narrow template literal union, which no
 * runtime-configured string can satisfy — hence one cast, here, rather than at
 * every call site.
 */
const signOptions = (secret: string, expiresIn: string): JwtSignOptions =>
  ({ secret, expiresIn }) as JwtSignOptions;

/**
 * Issues and verifies JWTs for all three human identity pools.
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

  async issue(claims: TokenClaims): Promise<TokenPair> {
    const accessTtl = this.config.get('JWT_ACCESS_TTL', { infer: true });

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        claims,
        signOptions(this.config.get('JWT_ACCESS_SECRET', { infer: true }), accessTtl),
      ),
      this.jwt.signAsync(
        claims,
        signOptions(
          this.config.get('JWT_REFRESH_SECRET', { infer: true }),
          this.config.get('JWT_REFRESH_TTL', { infer: true }),
        ),
      ),
    ]);

    return { accessToken, refreshToken, expiresIn: accessTtl };
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
