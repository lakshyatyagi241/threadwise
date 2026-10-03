import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { Profile } from './account-rules';

export interface AccountRow {
  id: number;
  uuid: string;
  instaflowAccountId: string;
  username: string | null;
  name: string | null;
  avatar: string | null;
  status: string;
  followers: number | null;
  syncedAt: Date | null;
  createdAt: Date;
  rowVersion: number;
}

interface Raw {
  id: number | string;
  uuid: string;
  instaflow_account_id: string;
  username: string | null;
  name: string | null;
  avatar: string | null;
  status: string;
  followers: number | string | null;
  synced_at: Date | string | null;
  created_at: Date | string;
  row_version: number;
}

const COLUMNS = sql.raw(
  `id, uuid, instaflow_account_id, username, name, avatar, status, followers, synced_at, created_at, row_version`,
);

const toRow = (r: Raw): AccountRow => ({
  id: Number(r.id),
  uuid: r.uuid,
  instaflowAccountId: r.instaflow_account_id,
  username: r.username,
  name: r.name,
  avatar: r.avatar,
  status: r.status,
  followers: r.followers === null ? null : Number(r.followers),
  syncedAt: r.synced_at === null ? null : new Date(r.synced_at),
  createdAt: new Date(r.created_at),
  rowVersion: r.row_version,
});

/** `workspace_ig_accounts`, always inside the caller's tenant transaction (RLS scopes every statement). */
@Injectable()
export class AccountsRepository {
  async list(tx: Tx, orgId: number): Promise<AccountRow[]> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM workspace_ig_accounts WHERE org_id = ${orgId} ORDER BY lower(coalesce(username, '')), id`,
    );
    return (res.rows as unknown as Raw[]).map(toRow);
  }

  async linkedIds(tx: Tx, orgId: number): Promise<Set<string>> {
    const res = await tx.execute(
      sql`SELECT instaflow_account_id FROM workspace_ig_accounts WHERE org_id = ${orgId}`,
    );
    return new Set(
      (res.rows as Array<{ instaflow_account_id: string }>).map((r) => r.instaflow_account_id),
    );
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<AccountRow | undefined> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM workspace_ig_accounts WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid FOR UPDATE`,
    );
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  /**
   * One row per (organization, engine account): linking again refreshes the profile on the same row and keeps its uuid.
   * `followers` is only replaced when one is given.
   */
  async upsert(
    tx: Tx,
    orgId: number,
    accountId: string,
    p: Profile,
    followers: number | null,
  ): Promise<{ row: AccountRow; created: boolean }> {
    const res = await tx.execute(sql`
      INSERT INTO workspace_ig_accounts (org_id, instaflow_account_id, username, name, avatar, status, followers, synced_at)
      VALUES (${orgId}, ${accountId}, ${p.username}, ${p.name}, ${p.avatar}, ${p.status}, ${followers}, now())
      ON CONFLICT (org_id, instaflow_account_id) DO UPDATE SET
        username = EXCLUDED.username, name = EXCLUDED.name, avatar = EXCLUDED.avatar, status = EXCLUDED.status,
        followers = coalesce(EXCLUDED.followers, workspace_ig_accounts.followers), synced_at = now()
      RETURNING ${COLUMNS}, (xmax = 0) AS inserted`);
    const raw = (res.rows as unknown as Array<Raw & { inserted: boolean }>)[0]!;
    return { row: toRow(raw), created: raw.inserted };
  }

  async remove(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM workspace_ig_accounts WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async count(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*)::int AS n FROM workspace_ig_accounts WHERE org_id = ${orgId}`,
    );
    return Number((res.rows[0] as { n: number }).n);
  }

  /**
   * Deletes every Instagram thread of the organization and its messages, and returns how many threads went. Messages carry no
   * foreign key to their thread, so they are removed first by name; the other tables that point at a thread cascade or null out.
   */
  async purgeInbox(tx: Tx, orgId: number): Promise<number> {
    await tx.execute(sql`
      DELETE FROM messages WHERE org_id = ${orgId}
        AND conversation_id IN (SELECT id FROM conversations WHERE org_id = ${orgId} AND channel = 'instagram')`);
    const res = await tx.execute(
      sql`DELETE FROM conversations WHERE org_id = ${orgId} AND channel = 'instagram' RETURNING id`,
    );
    return res.rows.length;
  }

  /** Every organization with a linked account: the pull sweep's work list. */
  async orgsWithAccounts(tx: Tx): Promise<number[]> {
    const res = await tx.execute(
      sql`SELECT DISTINCT org_id FROM workspace_ig_accounts ORDER BY org_id`,
    );
    return (res.rows as Array<{ org_id: number | string }>).map((r) => Number(r.org_id));
  }

  /** The signed-in person's email: the engine matches the accounts the person owns by it. */
  async userEmail(tx: Tx, orgId: number, userId: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT email::text AS email FROM users WHERE org_id = ${orgId} AND id = ${userId}`,
    );
    return (res.rows[0] as { email: string } | undefined)?.email ?? null;
  }
}
