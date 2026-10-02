import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

/** A browser-extension session lasts 30 days unless the caller says otherwise; never longer than a year. */
export const EXTENSION_TOKEN_DEFAULT_TTL_S = 30 * 24 * 3600;
export const EXTENSION_TOKEN_MAX_TTL_S = 365 * 24 * 3600;

export const hashExtensionToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export interface IssuedExtensionToken {
  /** Shown once. Only its sha256 is stored, so a database leak cannot be replayed. */
  token: string;
  uuid: string;
  expiresAt: Date;
}

/**
 * The browser extension's bearer-token store (TW-ADD-034). Reference's chrome-extension API logs in with a password and
 * gets a 60-character token; this owns the table, the hashing and the expiry rules, and the EXT domain's login,
 * logout and guard call it. Every method takes the caller's tenant transaction (RLS scopes the rows), so a token
 * can only ever resolve inside its own organisation.
 *
 * Deliberate difference from Reference: a token always expires (Reference issued tokens without a TTL, so in practice they
 * never did) and issuing clears the user's expired tokens (Reference had no cleanup), so the table stays small without
 * a cross-tenant sweep.
 */
@Injectable()
export class ExtensionTokenService {
  async issue(
    tx: Tx,
    input: { orgId: number; userId: number; label?: string; ttlSeconds?: number; now?: Date },
  ): Promise<IssuedExtensionToken> {
    const now = input.now ?? new Date();
    const ttl = Math.min(
      Math.max(1, Math.floor(input.ttlSeconds ?? EXTENSION_TOKEN_DEFAULT_TTL_S)),
      EXTENSION_TOKEN_MAX_TTL_S,
    );
    const expiresAt = new Date(now.getTime() + ttl * 1000);
    const token = randomBytes(45).toString('base64url').slice(0, 60);
    await tx.execute(
      sql`DELETE FROM extension_api_tokens WHERE user_id = ${input.userId} AND expires_at <= ${now.toISOString()}`,
    );
    const res = await tx.execute(sql`
      INSERT INTO extension_api_tokens (org_id, user_id, token_hash, label, expires_at)
      VALUES (${input.orgId}, ${input.userId}, ${hashExtensionToken(token)}, ${input.label ?? 'browser-extension'},
              ${expiresAt.toISOString()})
      RETURNING uuid`);
    return { token, uuid: (res.rows[0] as { uuid: string }).uuid, expiresAt };
  }

  /** The user a live token belongs to, or null for an unknown, revoked or expired one. Touches `last_used_at`. */
  async resolve(tx: Tx, token: string, now: Date = new Date()): Promise<{ userId: number } | null> {
    const res = await tx.execute(sql`
      UPDATE extension_api_tokens SET last_used_at = ${now.toISOString()}
      WHERE token_hash = ${hashExtensionToken(token)} AND (expires_at IS NULL OR expires_at > ${now.toISOString()})
      RETURNING user_id::int AS user_id`);
    const row = res.rows[0] as { user_id: number | null } | undefined;
    return row && row.user_id !== null ? { userId: row.user_id } : null;
  }

  /** Logout: removes the one token presented. */
  async revoke(tx: Tx, token: string): Promise<boolean> {
    const res = await tx.execute(
      sql`DELETE FROM extension_api_tokens WHERE token_hash = ${hashExtensionToken(token)} RETURNING id`,
    );
    return res.rows.length > 0;
  }
}
