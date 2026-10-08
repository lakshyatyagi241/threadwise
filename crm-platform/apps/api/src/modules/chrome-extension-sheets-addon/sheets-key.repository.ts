import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

export interface SheetsKeyRow {
  settingsId: number;
  userUuid: string;
  hash: string | null;
  suffix: string | null;
  createdAt: Date | null;
  lastUsedAt: Date | null;
}

/** What the guard learns from a key before any tenant is known. */
export interface SheetsKeyOwner {
  orgId: number;
  orgUuid: string;
  orgName: string;
  userId: number;
  userUuid: string;
  userName: string;
  userEmail: string;
  userStatus: string;
}

type Raw = Record<string, unknown>;
const date = (v: unknown): Date | null => (v ? new Date(v as string) : null);

/**
 * The member's key lives in `user_settings` (sheets_key_*), one row per member, so "one active key per member" is the shape of the table.
 * Every method but `findOwner` runs in the caller's tenant transaction.
 */
@Injectable()
export class SheetsKeyRepository {
  async read(tx: Tx, orgId: number, userId: number): Promise<SheetsKeyRow | undefined> {
    const res = await tx.execute(sql`
      SELECT us.id, u.uuid AS user_uuid, us.sheets_key_hash, us.sheets_key_suffix,
             us.sheets_key_created_at, us.sheets_key_last_used_at
      FROM users u
      LEFT JOIN user_settings us ON us.org_id = u.org_id AND us.user_id = u.id
      WHERE u.org_id = ${orgId} AND u.id = ${userId}
      FOR UPDATE OF u`);
    const r = res.rows[0] as Raw | undefined;
    if (!r) return undefined;
    return {
      settingsId: r.id === null ? 0 : Number(r.id),
      userUuid: r.user_uuid as string,
      hash: (r.sheets_key_hash as string | null) ?? null,
      suffix: (r.sheets_key_suffix as string | null) ?? null,
      createdAt: date(r.sheets_key_created_at),
      lastUsedAt: date(r.sheets_key_last_used_at),
    };
  }

  /** Stores a new key for the member, replacing any earlier one, and returns the settings row id. */
  async set(
    tx: Tx,
    orgId: number,
    userId: number,
    key: { hash: string; suffix: string },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO user_settings (org_id, user_id, sheets_key_hash, sheets_key_suffix, sheets_key_created_at, sheets_key_last_used_at)
      VALUES (${orgId}, ${userId}, ${key.hash}, ${key.suffix}, now(), NULL)
      ON CONFLICT (org_id, user_id) DO UPDATE
        SET sheets_key_hash = EXCLUDED.sheets_key_hash, sheets_key_suffix = EXCLUDED.sheets_key_suffix,
            sheets_key_created_at = EXCLUDED.sheets_key_created_at, sheets_key_last_used_at = NULL
      RETURNING id`);
    return Number((res.rows[0] as Raw).id);
  }

  async clear(tx: Tx, orgId: number, userId: number): Promise<void> {
    await tx.execute(sql`
      UPDATE user_settings
      SET sheets_key_hash = NULL, sheets_key_suffix = NULL, sheets_key_created_at = NULL, sheets_key_last_used_at = NULL
      WHERE org_id = ${orgId} AND user_id = ${userId}`);
  }

  async touch(tx: Tx, orgId: number, settingsId: number): Promise<void> {
    await tx.execute(
      sql`UPDATE user_settings SET sheets_key_last_used_at = now() WHERE org_id = ${orgId} AND id = ${settingsId}`,
    );
  }

  /**
   * The member a key belongs to. Privileged by necessity: the bearer key is the only thing the add-on sends, so the workspace is found
   * from it (one of the sanctioned uses of `privileged()`, like the API keys). The unique index on the hash answers in one lookup.
   */
  async findOwner(
    tx: Tx,
    hash: string,
  ): Promise<(SheetsKeyOwner & { settingsId: number }) | undefined> {
    const res = await tx.execute(sql`
      SELECT us.id AS settings_id, us.org_id, o.uuid AS org_uuid, o.name AS org_name,
             u.id AS user_id, u.uuid AS user_uuid, u.full_name, u.email::text AS email, u.status
      FROM user_settings us
      JOIN users u ON u.org_id = us.org_id AND u.id = us.user_id
      JOIN organizations o ON o.id = us.org_id
      WHERE us.sheets_key_hash = ${hash}
      LIMIT 1`);
    const r = res.rows[0] as Raw | undefined;
    if (!r) return undefined;
    return {
      settingsId: Number(r.settings_id),
      orgId: Number(r.org_id),
      orgUuid: r.org_uuid as string,
      orgName: r.org_name as string,
      userId: Number(r.user_id),
      userUuid: r.user_uuid as string,
      userName: r.full_name as string,
      userEmail: r.email as string,
      userStatus: r.status as string,
    };
  }
}
