import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { ERROR_CODES, type WspRoleTier } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';

/** Rank of a tier as SQL sees it: higher sorts first. custom (2) ranks above viewer (1) and below the named presets. */
const SCORE_TIER: Record<number, WspRoleTier> = {
  6: 'owner',
  5: 'admin',
  4: 'manager',
  3: 'agent',
  2: 'custom',
  1: 'viewer',
};
export const TIER_SCORE: Record<WspRoleTier, number> = {
  owner: 6,
  admin: 5,
  manager: 4,
  agent: 3,
  custom: 2,
  viewer: 1,
};

export interface MemberRow {
  id: number;
  uuid: string;
  email: string;
  fullName: string;
  status: string;
  invitedAt: Date | null;
  joinedAt: Date | null;
  rowVersion: number;
  tier: WspRoleTier;
  presence: string | null;
  lastSeenAt: Date | null;
  phone: string | null;
  chatLimit: number | null;
  lastLoginAt: Date | null;
}

export interface MemberRoleRow {
  userId: number;
  roleId: number;
  roleUuid: string;
  roleName: string;
  systemKey: string | null;
}

export interface RoleRow {
  id: number;
  uuid: string;
  name: string;
  systemKey: string | null;
}

export interface ListMembersFilter {
  limit: number;
  cursor?: string;
  q?: string;
  tier?: WspRoleTier;
}

interface MemberCursor {
  s: number;
  n: string;
  i: number;
}

const encode = (c: MemberCursor): string =>
  Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
function decode(raw: string): MemberCursor {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as MemberCursor;
    if (!Number.isInteger(c.s) || typeof c.n !== 'string' || !Number.isInteger(c.i))
      throw new Error('shape');
    return c;
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid pagination cursor', 400);
  }
}

const likePattern = (q: string): string => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

type Raw = Record<string, unknown>;

/** Raw `execute` rows may carry timestamps as Date or as text depending on the driver path. */
export const toDate = (v: unknown): Date | null =>
  v == null ? null : new Date(v as string | Date);

/**
 * Data access for workspace members: `users` rows seen as members, with their role set, their teams and the presence the inbox
 * keeps in `agent_statuses`. Every method runs inside the tenant transaction it is handed.
 */
@Injectable()
export class MembersRepository {
  /**
   * The tier of each user as a number, computed in SQL so the list can be sorted and paged by it: the highest of the user's
   * roles by the RBAC preset's `system_key` (Owner = `admin`), and 2 (`custom`) for a role without a preset or no role at all.
   */
  private tierScore(): SQL {
    return sql`COALESCE((
      SELECT max(CASE r.system_key
          WHEN 'admin' THEN 6
          WHEN 'workspace_admin' THEN 5
          WHEN 'manager' THEN 4
          WHEN 'agent' THEN 3
          WHEN 'viewer' THEN 1
          ELSE 2 END)
      FROM user_roles ur JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id
      WHERE ur.org_id = u.org_id AND ur.user_id = u.id), 2)`;
  }

  private toRow(r: Raw): MemberRow {
    return {
      id: Number(r.id),
      uuid: String(r.uuid),
      email: String(r.email),
      fullName: String(r.full_name),
      status: String(r.status),
      invitedAt: toDate(r.invited_at),
      joinedAt: toDate(r.joined_at),
      rowVersion: Number(r.row_version),
      tier: SCORE_TIER[Number(r.tier_score)] ?? 'custom',
      presence: (r.presence_status as string | null) ?? null,
      lastSeenAt: toDate(r.last_seen_at),
      phone: (r.phone_e164 as string | null) ?? null,
      chatLimit: r.chat_limit == null ? null : Number(r.chat_limit),
      lastLoginAt: toDate(r.last_login_at),
    };
  }

  private select(orgId: number, where: SQL): SQL {
    return sql`
      SELECT u.id, u.uuid, u.email::text AS email, u.full_name, u.status, u.invited_at, u.joined_at, u.row_version,
             ${this.tierScore()} AS tier_score, a.status AS presence_status, a.last_seen_at,
             p.phone_e164, p.chat_limit, sec.last_login_at
      FROM users u
      LEFT JOIN agent_statuses a ON a.org_id = u.org_id AND a.user_id = u.id
      LEFT JOIN user_profiles p ON p.org_id = u.org_id AND p.user_id = u.id
      LEFT JOIN user_security sec ON sec.org_id = u.org_id AND sec.user_id = u.id
      WHERE u.org_id = ${orgId} AND ${where}`;
  }

  async list(
    tx: Tx,
    orgId: number,
    filter: ListMembersFilter,
  ): Promise<{ rows: MemberRow[]; nextCursor: string | null; hasMore: boolean }> {
    const conds: SQL[] = [sql`u.status <> 'inactive'`];
    if (filter.q) {
      const p = likePattern(filter.q);
      conds.push(sql`(u.full_name ILIKE ${p} OR u.email::text ILIKE ${p})`);
    }
    const base = this.select(orgId, sql.join(conds, sql` AND `));

    const outer: SQL[] = [];
    if (filter.tier) outer.push(sql`m.tier_score = ${TIER_SCORE[filter.tier]}`);
    if (filter.cursor) {
      const c = decode(filter.cursor);
      outer.push(
        sql`(m.tier_score < ${c.s} OR (m.tier_score = ${c.s} AND (lower(m.full_name) > ${c.n} OR (lower(m.full_name) = ${c.n} AND m.id > ${c.i}))))`,
      );
    }
    const res = await tx.execute(sql`
      SELECT m.* FROM (${base}) m
      ${outer.length > 0 ? sql`WHERE ${sql.join(outer, sql` AND `)}` : sql``}
      ORDER BY m.tier_score DESC, lower(m.full_name), m.id
      LIMIT ${filter.limit + 1}`);
    const raw = res.rows as Raw[];
    const hasMore = raw.length > filter.limit;
    const rows = (hasMore ? raw.slice(0, filter.limit) : raw).map((r) => this.toRow(r));
    const last = hasMore ? raw[filter.limit - 1] : undefined;
    return {
      rows,
      hasMore,
      nextCursor: last
        ? encode({
            s: Number(last.tier_score),
            n: String(last.full_name).toLowerCase(),
            i: Number(last.id),
          })
        : null,
    };
  }

  async byUuid(tx: Tx, orgId: number, uuid: string): Promise<MemberRow | undefined> {
    const res = await tx.execute(this.select(orgId, sql`u.uuid = ${uuid}::uuid`));
    const row = res.rows[0] as Raw | undefined;
    return row ? this.toRow(row) : undefined;
  }

  async byId(tx: Tx, orgId: number, id: number): Promise<MemberRow | undefined> {
    const res = await tx.execute(this.select(orgId, sql`u.id = ${id}`));
    const row = res.rows[0] as Raw | undefined;
    return row ? this.toRow(row) : undefined;
  }

  /** Members (not removed) per tier, and how many of them have not accepted yet. */
  async tierCounts(
    tx: Tx,
    orgId: number,
  ): Promise<{ byTier: Map<WspRoleTier, number>; pending: number }> {
    const res = await tx.execute(sql`
      SELECT m.tier_score, count(*)::int AS n, count(*) FILTER (WHERE m.joined_at IS NULL AND m.invited_at IS NOT NULL)::int AS pending
      FROM (${this.select(orgId, sql`u.status <> 'inactive'`)}) m
      GROUP BY m.tier_score`);
    const byTier = new Map<WspRoleTier, number>();
    let pending = 0;
    for (const r of res.rows as Raw[]) {
      byTier.set(SCORE_TIER[Number(r.tier_score)] ?? 'custom', Number(r.n));
      pending += Number(r.pending);
    }
    return { byTier, pending };
  }

  /** Seats in use: everyone who is not removed, pending invitations included. */
  async seatsUsed(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*)::int AS n FROM users WHERE org_id = ${orgId} AND status <> 'inactive'`,
    );
    return Number((res.rows[0] as Raw).n);
  }

  async rolesForUsers(tx: Tx, orgId: number, userIds: number[]): Promise<MemberRoleRow[]> {
    if (userIds.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT ur.user_id, r.id AS role_id, r.uuid AS role_uuid, r.name AS role_name, r.system_key
      FROM user_roles ur JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id
      WHERE ur.org_id = ${orgId} AND ur.user_id IN (${sql.join(
        userIds.map((i) => sql`${i}`),
        sql`, `,
      )})
      ORDER BY r.name`);
    return (res.rows as Raw[]).map((r) => ({
      userId: Number(r.user_id),
      roleId: Number(r.role_id),
      roleUuid: String(r.role_uuid),
      roleName: String(r.role_name),
      systemKey: (r.system_key as string | null) ?? null,
    }));
  }

  async teamUuidsForUsers(
    tx: Tx,
    orgId: number,
    userIds: number[],
  ): Promise<Map<number, string[]>> {
    const out = new Map<number, string[]>();
    if (userIds.length === 0) return out;
    const res = await tx.execute(sql`
      SELECT tm.user_id, t.uuid AS team_uuid
      FROM team_members tm JOIN teams t ON t.org_id = tm.org_id AND t.id = tm.team_id
      WHERE tm.org_id = ${orgId} AND tm.user_id IN (${sql.join(
        userIds.map((i) => sql`${i}`),
        sql`, `,
      )})
      ORDER BY t.sort, t.name`);
    for (const r of res.rows as Raw[]) {
      const id = Number(r.user_id);
      out.set(id, [...(out.get(id) ?? []), String(r.team_uuid)]);
    }
    return out;
  }

  async listRoles(tx: Tx, orgId: number): Promise<RoleRow[]> {
    const res = await tx.execute(
      sql`SELECT id, uuid, name, system_key FROM roles WHERE org_id = ${orgId} ORDER BY name`,
    );
    return (res.rows as Raw[]).map(toRole);
  }

  async roleByUuid(tx: Tx, orgId: number, uuid: string): Promise<RoleRow | undefined> {
    const res = await tx.execute(
      sql`SELECT id, uuid, name, system_key FROM roles WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const row = res.rows[0] as Raw | undefined;
    return row ? toRole(row) : undefined;
  }

  async userByEmail(
    tx: Tx,
    orgId: number,
    email: string,
  ): Promise<{ id: number; uuid: string; status: string } | undefined> {
    const res = await tx.execute(
      sql`SELECT id, uuid, status FROM users WHERE org_id = ${orgId} AND email = ${email}`,
    );
    const row = res.rows[0] as Raw | undefined;
    return row
      ? { id: Number(row.id), uuid: String(row.uuid), status: String(row.status) }
      : undefined;
  }

  /** A user nobody can sign in as yet: the hash is random bytes nobody holds, so only the invite link can open the account. */
  async insertPending(
    tx: Tx,
    orgId: number,
    v: { email: string; fullName: string; passwordHash: string },
  ): Promise<{ id: number; uuid: string }> {
    const res = await tx.execute(sql`
      INSERT INTO users (org_id, email, full_name, password_hash, status, invited_at, joined_at)
      VALUES (${orgId}, ${v.email}, ${v.fullName}, ${v.passwordHash}, 'active', now(), NULL)
      RETURNING id, uuid`);
    const row = res.rows[0] as Raw;
    return { id: Number(row.id), uuid: String(row.uuid) };
  }

  /** A removed member invited again: the same row comes back as a fresh pending invitation. */
  async reactivate(
    tx: Tx,
    orgId: number,
    id: number,
    v: { fullName: string; passwordHash: string },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE users SET full_name = ${v.fullName}, password_hash = ${v.passwordHash}, status = 'active',
                       invited_at = now(), joined_at = NULL
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /**
   * The member's phone and chat limit, written to the profile row (created when the member has none yet). A key left out
   * keeps what is stored, `null` clears it; the display name and theme of an existing profile are never touched.
   */
  async upsertDetails(
    tx: Tx,
    orgId: number,
    userId: number,
    v: { phone?: string | null; chatLimit?: number | null },
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO user_profiles (org_id, user_id, phone_e164, chat_limit)
      VALUES (${orgId}, ${userId}, ${v.phone ?? null}, ${v.chatLimit ?? null})
      ON CONFLICT (org_id, user_id) DO UPDATE SET
        phone_e164 = ${v.phone === undefined ? sql`user_profiles.phone_e164` : sql`${v.phone}`},
        phone_verified_at = ${v.phone === undefined ? sql`user_profiles.phone_verified_at` : sql`CASE WHEN ${v.phone}::text IS NOT DISTINCT FROM user_profiles.phone_e164 THEN user_profiles.phone_verified_at END`},
        chat_limit = ${v.chatLimit === undefined ? sql`user_profiles.chat_limit` : sql`${v.chatLimit}::integer`}`);
  }

  /**
   * Availability of one agent: the stored status, upserted. Only `status` and the heartbeat are written; the counters and the
   * round-robin clock of the row stay as the inbox keeps them.
   */
  async setAvailability(
    tx: Tx,
    orgId: number,
    userId: number,
    status: 'online' | 'offline',
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO agent_statuses (org_id, user_id, status, last_seen_at)
      VALUES (${orgId}, ${userId}, ${status}, now())
      ON CONFLICT (org_id, user_id) DO UPDATE SET status = EXCLUDED.status, last_seen_at = now()`);
  }

  /** What routing reads: the stored status, and `online` when nobody has ever switched this member. */
  async availabilityOf(tx: Tx, orgId: number, userId: number): Promise<string> {
    const res = await tx.execute(
      sql`SELECT status FROM agent_statuses WHERE org_id = ${orgId} AND user_id = ${userId}`,
    );
    return ((res.rows[0] as Raw | undefined)?.status as string | undefined) ?? 'online';
  }

  async ensureSecurity(tx: Tx, orgId: number, userId: number): Promise<void> {
    await tx.execute(sql`
      INSERT INTO user_security (org_id, user_id) VALUES (${orgId}, ${userId})
      ON CONFLICT (org_id, user_id) DO NOTHING`);
  }

  /**
   * A removed member who is invited again starts clean: no verified address and no second factor carried over from the
   * earlier membership, so the invitation link is the only thing that can open the account.
   */
  async resetSecurity(tx: Tx, orgId: number, userId: number): Promise<void> {
    await tx.execute(sql`
      INSERT INTO user_security (org_id, user_id) VALUES (${orgId}, ${userId})
      ON CONFLICT (org_id, user_id) DO UPDATE
        SET email_verified_at = NULL, mfa_enabled = false, mfa_secret_enc = NULL, mfa_confirmed_at = NULL,
            mfa_last_step = NULL, mfa_recovery_hashes = '[]'::jsonb, force_password_change = false`);
  }

  /** The member's whole role set becomes this one role. */
  async setSingleRole(tx: Tx, orgId: number, userId: number, roleId: number): Promise<void> {
    await tx.execute(sql`DELETE FROM user_roles WHERE org_id = ${orgId} AND user_id = ${userId}`);
    await tx.execute(
      sql`INSERT INTO user_roles (org_id, user_id, role_id) VALUES (${orgId}, ${userId}, ${roleId})`,
    );
  }

  /** Bumps the row version when it still matches what the caller read; false means somebody changed it first. */
  async touchWithVersion(tx: Tx, orgId: number, id: number, expected: number): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE users SET updated_at = now() WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${expected}
      RETURNING id`);
    return res.rows.length > 0;
  }

  /** Soft removal: the account, its history and its references stay; access, roles and team places go. */
  async deactivate(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(
      sql`UPDATE users SET status = 'inactive' WHERE org_id = ${orgId} AND id = ${id}`,
    );
    await tx.execute(sql`DELETE FROM user_roles WHERE org_id = ${orgId} AND user_id = ${id}`);
    await tx.execute(sql`DELETE FROM team_members WHERE org_id = ${orgId} AND user_id = ${id}`);
  }

  /** Burns every live one-time token of the user (invite, reset, verify, email change). */
  async cancelLiveTokens(tx: Tx, orgId: number, userId: number): Promise<void> {
    await tx.execute(sql`
      UPDATE user_tokens SET consumed_at = now()
      WHERE org_id = ${orgId} AND user_id = ${userId} AND consumed_at IS NULL`);
  }

  async displayName(tx: Tx, orgId: number, userId: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT full_name FROM users WHERE org_id = ${orgId} AND id = ${userId}`,
    );
    return ((res.rows[0] as Raw | undefined)?.full_name as string | undefined) ?? null;
  }

  async orgInfo(tx: Tx, orgId: number): Promise<{ name: string; slug: string }> {
    const res = await tx.execute(sql`SELECT name, slug FROM organizations WHERE id = ${orgId}`);
    const row = res.rows[0] as Raw;
    return { name: String(row.name), slug: String(row.slug) };
  }

  /** Accepting: the invitee's own password goes in and the member becomes joined, only while the invitation is still open. */
  async markJoined(tx: Tx, orgId: number, id: number, passwordHash: string): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE users SET password_hash = ${passwordHash}, joined_at = now()
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'active' AND joined_at IS NULL AND invited_at IS NOT NULL
      RETURNING id`);
    return res.rows.length > 0;
  }

  async markEmailVerifiedAndPassword(tx: Tx, orgId: number, userId: number): Promise<void> {
    await tx.execute(sql`
      INSERT INTO user_security (org_id, user_id, email_verified_at, password_changed_at, force_password_change)
      VALUES (${orgId}, ${userId}, now(), now(), false)
      ON CONFLICT (org_id, user_id) DO UPDATE
        SET email_verified_at = COALESCE(user_security.email_verified_at, now()),
            password_changed_at = now(), force_password_change = false`);
  }

  /**
   * One audit_log row with a dotted action (`member.invited`), the way the auth domain writes its events. AuditService only
   * knows insert/update/delete; these actions are what the activity log is meant to show for membership changes.
   */
  async audit(
    tx: Tx,
    e: {
      orgId: number;
      actorId: number | null;
      actorType: string;
      module: 'members' | 'teams';
      recordId: number;
      action: string;
      delta?: Record<string, unknown>;
      requestId?: string | null;
    },
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta, request_id)
      VALUES (${e.orgId}, ${e.actorId}, ${e.actorType}, ${e.module}, ${e.recordId}, ${e.action},
              ${e.delta ? JSON.stringify(e.delta) : null}::jsonb, ${e.requestId ?? null})`);
  }
}

const toRole = (r: Raw): RoleRow => ({
  id: Number(r.id),
  uuid: String(r.uuid),
  name: String(r.name),
  systemKey: (r.system_key as string | null) ?? null,
});
