import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { randomToken, sha256Hex } from '../support/crypto-utils';

export type TokenKind = 'email_verify' | 'password_reset' | 'email_change';

export interface ConsumedToken {
  userId: number;
  payload: Record<string, unknown>;
}

/**
 * One-time tokens for the mail-link flows (TW-AUTH-013/014/015, email change).
 *
 * Only the SHA-256 of the token is stored; the token itself exists only in the
 * mail. A user has at most one live token per kind (issuing a new one retires
 * the old), and consuming is a single conditional UPDATE, so two simultaneous
 * clicks cannot both succeed. Reference's verification link was replayable for 60
 * minutes and doubled as a passwordless login; neither is true here.
 */
@Injectable()
export class UserTokensService {
  constructor(private readonly db: DatabaseService) {}

  async issue(
    tx: Tx,
    orgId: number,
    userId: number,
    kind: TokenKind,
    ttlSeconds: number,
    payload: Record<string, unknown> = {},
  ): Promise<string> {
    const token = randomToken(32);
    await tx.execute(sql`
      DELETE FROM user_tokens
      WHERE org_id = ${orgId} AND user_id = ${userId} AND kind = ${kind} AND consumed_at IS NULL
    `);
    await tx.execute(sql`
      INSERT INTO user_tokens (org_id, user_id, kind, token_hash, payload, expires_at)
      VALUES (${orgId}, ${userId}, ${kind}, ${sha256Hex(token)}, ${JSON.stringify(payload)}::jsonb,
              now() + make_interval(secs => ${ttlSeconds}))
    `);
    return token;
  }

  /** Is this token currently usable? Does not consume it. */
  async peek(orgId: number, kind: TokenKind, token: string): Promise<ConsumedToken | null> {
    const res = await this.db.txAs({ orgId }, async (tx) =>
      tx.execute(sql`
        SELECT user_id, payload FROM user_tokens
        WHERE org_id = ${orgId} AND kind = ${kind} AND token_hash = ${sha256Hex(token)}
          AND consumed_at IS NULL AND expires_at > now()
      `),
    );
    const row = res.rows[0] as unknown as
      { user_id: number; payload: Record<string, unknown> } | undefined;
    return row ? { userId: row.user_id, payload: row.payload } : null;
  }

  /** Atomically burns the token inside the caller's transaction. Null if it was not usable. */
  async consume(
    tx: Tx,
    orgId: number,
    kind: TokenKind,
    token: string,
  ): Promise<ConsumedToken | null> {
    const res = await tx.execute(sql`
      UPDATE user_tokens SET consumed_at = now()
      WHERE org_id = ${orgId} AND kind = ${kind} AND token_hash = ${sha256Hex(token)}
        AND consumed_at IS NULL AND expires_at > now()
      RETURNING user_id, payload
    `);
    const row = res.rows[0] as unknown as
      { user_id: number; payload: Record<string, unknown> } | undefined;
    return row ? { userId: row.user_id, payload: row.payload } : null;
  }

  invalid(): AppError {
    return new AppError(
      ERROR_CODES.AUTH_TOKEN_INVALID,
      'This link is invalid or has expired. Request a new one.',
      HttpStatus.BAD_REQUEST,
    );
  }
}
