import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const d = (v: unknown): Date | null =>
  v === null || v === undefined ? null : v instanceof Date ? v : new Date(v as string);

export type ConsentStatus =
  'pending' | 'awaiting_confirm' | 'confirmed' | 'cancelled' | 'rejected' | 'expired';

export interface ConsentRow {
  id: number;
  orgId: number;
  uuid: string;
  userId: number;
  capabilities: string[];
  returnTo: string;
  status: ConsentStatus;
  expiresAt: Date;
  accountEmail: string | null;
  accountSub: string | null;
  scopes: string | null;
  missingScopes: string[];
  refreshTokenEnc: string | null;
  accessTokenEnc: string | null;
  accessTokenExpiresAt: Date | null;
}

const toRow = (r: Raw): ConsentRow => ({
  id: Number(r.id),
  orgId: Number(r.org_id),
  uuid: r.uuid as string,
  userId: Number(r.user_id),
  capabilities: (r.capabilities as string[]) ?? [],
  returnTo: r.return_to as string,
  status: r.status as ConsentStatus,
  expiresAt: new Date(r.expires_at as string),
  accountEmail: s(r.account_email),
  accountSub: s(r.account_sub),
  scopes: s(r.scopes),
  missingScopes: (r.missing_scopes as string[] | null) ?? [],
  refreshTokenEnc: s(r.refresh_token_enc),
  accessTokenEnc: s(r.access_token_enc),
  accessTokenExpiresAt: d(r.access_token_expires_at),
});

/** The Google consents in flight (`google_consent_requests`): one row per press of Connect, used at most once. */
@Injectable()
export class GoogleConsentRepository {
  async create(
    tx: Tx,
    orgId: number,
    v: {
      nonceHash: string;
      userId: number;
      capabilities: string[];
      returnTo: string;
      expiresAt: Date;
    },
  ): Promise<ConsentRow> {
    const res = await tx.execute(sql`
      INSERT INTO google_consent_requests (org_id, nonce_hash, user_id, capabilities, return_to, expires_at)
      VALUES (${orgId}, ${v.nonceHash}, ${v.userId}, ${sql`ARRAY[${sql.join(
        v.capabilities.map((c) => sql`${c}`),
        sql`, `,
      )}]::text[]`}, ${v.returnTo}, ${v.expiresAt.toISOString()}::timestamptz)
      RETURNING *`);
    return toRow((res.rows as Raw[])[0]!);
  }

  /**
   * The callback's claim: pending to awaiting_confirm in one statement, so a code is exchanged once however many times the link is
   * opened. When nothing is claimed it says why (`expired`, `used` or `none`).
   */
  async claim(
    tx: Tx,
    orgId: number,
    nonceHash: string,
  ): Promise<{ row: ConsentRow } | { row: null; why: 'expired' | 'used' | 'none' }> {
    const res = await tx.execute(sql`
      UPDATE google_consent_requests SET status = 'awaiting_confirm'
       WHERE org_id = ${orgId} AND nonce_hash = ${nonceHash} AND status = 'pending' AND expires_at > now()
       RETURNING *`);
    const hit = (res.rows as Raw[])[0];
    if (hit) return { row: toRow(hit) };
    const seen = (
      await tx.execute(
        sql`SELECT status, expires_at < now() AS late FROM google_consent_requests WHERE org_id = ${orgId} AND nonce_hash = ${nonceHash}`,
      )
    ).rows[0] as { status: string; late: boolean } | undefined;
    if (!seen) return { row: null, why: 'none' };
    if (seen.status === 'pending' && seen.late) return { row: null, why: 'expired' };
    return { row: null, why: 'used' };
  }

  async find(
    tx: Tx,
    orgId: number,
    uuid: string,
    forUpdate = false,
  ): Promise<ConsentRow | undefined> {
    const res = await tx.execute(sql`
      SELECT * FROM google_consent_requests WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid ${forUpdate ? sql`FOR UPDATE` : sql``}`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  /** What Google returned, sealed, for the confirmation page to show and the confirmation to store. */
  async fill(
    tx: Tx,
    orgId: number,
    id: number,
    v: {
      accountEmail: string | null;
      accountSub: string | null;
      scopes: string;
      missingScopes: string[];
      refreshTokenEnc: string | null;
      accessTokenEnc: string;
      accessTokenExpiresAt: Date;
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE google_consent_requests
         SET account_email = ${v.accountEmail}, account_sub = ${v.accountSub}, scopes = ${v.scopes},
             missing_scopes = ${sql`ARRAY[${sql.join(
               v.missingScopes.map((m) => sql`${m}`),
               sql`, `,
             )}]::text[]`},
             refresh_token_enc = ${v.refreshTokenEnc}, access_token_enc = ${v.accessTokenEnc},
             access_token_expires_at = ${v.accessTokenExpiresAt.toISOString()}::timestamptz
       WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** Ends a request for good and forgets its tokens (nothing sealed outlives the decision). */
  async finish(
    tx: Tx,
    orgId: number,
    id: number,
    status: Exclude<ConsentStatus, 'pending' | 'awaiting_confirm'>,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE google_consent_requests
         SET status = ${status}, decided_at = now(), refresh_token_enc = NULL, access_token_enc = NULL, access_token_expires_at = NULL
       WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** The nonce-keyed finish for a callback that ends without a row in hand (denied, no code). */
  async finishByNonce(
    tx: Tx,
    orgId: number,
    nonceHash: string,
    status: 'cancelled' | 'rejected',
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE google_consent_requests SET status = ${status}, decided_at = now()
       WHERE org_id = ${orgId} AND nonce_hash = ${nonceHash} AND status IN ('pending', 'awaiting_confirm')`);
  }

  /**
   * Ends a request that is still open and hands back what it held, in ONE statement: of several workers (or a worker and a person) that
   * reach the same request, exactly one gets the tokens back and the rest get null, so a grant is withdrawn at Google at most once.
   */
  async end(
    tx: Tx,
    orgId: number,
    id: number,
    status: 'cancelled' | 'rejected' | 'expired',
  ): Promise<{
    refreshTokenEnc: string | null;
    accessTokenEnc: string | null;
    accountSub: string | null;
  } | null> {
    const res = await tx.execute(sql`
      WITH old AS (
        SELECT refresh_token_enc, access_token_enc, account_sub FROM google_consent_requests
         WHERE org_id = ${orgId} AND id = ${id} AND status IN ('pending', 'awaiting_confirm') FOR UPDATE)
      UPDATE google_consent_requests r
         SET status = ${status}, decided_at = now(), refresh_token_enc = NULL, access_token_enc = NULL, access_token_expires_at = NULL
        FROM old
       WHERE r.org_id = ${orgId} AND r.id = ${id} AND r.status IN ('pending', 'awaiting_confirm')
       RETURNING old.refresh_token_enc, old.access_token_enc, old.account_sub`);
    const r = (res.rows as Raw[])[0];
    return r
      ? {
          refreshTokenEnc: s(r.refresh_token_enc),
          accessTokenEnc: s(r.access_token_enc),
          accountSub: s(r.account_sub),
        }
      : null;
  }

  /** Requests past their time that still hold anything (across workspaces: the sweep is privileged). Claiming is `end`, not a lock here. */
  async due(tx: Tx, limit: number): Promise<ConsentRow[]> {
    const res = await tx.execute(sql`
      SELECT * FROM google_consent_requests
       WHERE status IN ('pending', 'awaiting_confirm') AND expires_at < now()
       ORDER BY expires_at LIMIT ${limit}`);
    return (res.rows as Raw[]).map(toRow);
  }
}
