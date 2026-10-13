import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { WaDeviceGroupListQuery, WaDeviceGroupStats } from '@crm/contracts';
import type { Cursor } from '../../common/pagination/cursor';
import type { GroupPatch, GroupSnapshot } from '../node-bridge-runtime';
import type { GroupFacts } from './device-groups-rules';

/** One member of the cached roster (`wa_device_groups.participants`); `phone` and `lid` are digits. */
export interface WaDeviceGroupParticipant {
  jid: string;
  phone: string | null;
  lid: string | null;
  name: string | null;
  admin: 'superadmin' | 'admin' | null;
}
/** One person waiting to be let in (`wa_device_groups.join_requests`); `requestedAt` is an ISO time. */
export interface WaDeviceGroupJoinRequest {
  jid: string;
  phone: string | null;
  lid: string | null;
  name: string | null;
  requestedAt: string | null;
}

/**
 * A `wa_device_groups` row as the screens and the sync read it. The invite code is NOT here: only `inviteCodeOf` reads it, and only the
 * explicit invite-link route returns it (`hasInvite` says whether one is held).
 */
export interface DeviceGroupRow {
  id: number;
  uuid: string;
  device_id: number;
  device_uuid: string;
  group_jid: string;
  subject: string | null;
  description: string | null;
  size: number;
  is_admin: boolean;
  announce: boolean;
  restrict_info: boolean;
  join_approval: boolean;
  member_add_mode: string;
  owner_jid: string | null;
  has_invite: boolean;
  picture_url: string | null;
  creation_at: Date | null;
  synced_at: Date | null;
  left_at: Date | null;
  participants: WaDeviceGroupParticipant[];
  join_requests: WaDeviceGroupJoinRequest[];
  created_at: Date;
  /** The same instant with microseconds, for the keyset cursor (a JS Date keeps milliseconds only). */
  created_at_iso: string;
  row_version: number;
  /** `conversations.uuid` of the inbox thread of this group, when there is one. */
  conversation_uuid: string | null;
}

const COLUMNS =
  sql.raw(`g.id, g.uuid, g.device_id, d.uuid AS device_uuid, g.group_jid, g.subject, g.description, g.size, g.is_admin,
  g.announce, g.restrict_info, g.join_approval, g.member_add_mode, g.owner_jid, (g.invite_code IS NOT NULL) AS has_invite, g.picture_url,
  g.creation_at, g.synced_at, g.left_at, g.participants, g.join_requests, g.created_at, g.row_version,
  to_char(g.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso,
  (SELECT cv.uuid FROM channels ch
     JOIN conversations cv ON cv.org_id = ch.org_id AND cv.channel_id = ch.id AND cv.peer_key = 'g:' || g.group_jid
    WHERE ch.org_id = g.org_id AND ch.kind = 'whatsapp_qr' AND ch.external_id = d.uuid::text
    ORDER BY ch.id LIMIT 1) AS conversation_uuid`);

const FROM = sql.raw(
  `FROM wa_device_groups g JOIN devices d ON d.org_id = g.org_id AND d.id = g.device_id`,
);

const arrayOf = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

const toRow = (r: Record<string, unknown>): DeviceGroupRow => ({
  id: Number(r.id),
  uuid: String(r.uuid),
  device_id: Number(r.device_id),
  device_uuid: String(r.device_uuid),
  group_jid: String(r.group_jid),
  subject: (r.subject as string | null) ?? null,
  description: (r.description as string | null) ?? null,
  size: Number(r.size ?? 0),
  is_admin: Boolean(r.is_admin),
  announce: Boolean(r.announce),
  restrict_info: Boolean(r.restrict_info),
  join_approval: Boolean(r.join_approval),
  member_add_mode: String(r.member_add_mode),
  owner_jid: (r.owner_jid as string | null) ?? null,
  has_invite: Boolean(r.has_invite),
  picture_url: (r.picture_url as string | null) ?? null,
  creation_at: r.creation_at ? new Date(r.creation_at as string) : null,
  synced_at: r.synced_at ? new Date(r.synced_at as string) : null,
  left_at: r.left_at ? new Date(r.left_at as string) : null,
  participants: arrayOf<WaDeviceGroupParticipant>(r.participants),
  join_requests: arrayOf<WaDeviceGroupJoinRequest>(r.join_requests),
  created_at: new Date(r.created_at as string),
  created_at_iso: String(r.created_at_iso),
  row_version: Number(r.row_version),
  conversation_uuid: (r.conversation_uuid as string | null) ?? null,
});

export const factsOf = (r: DeviceGroupRow): GroupFacts => ({
  subject: r.subject,
  description: r.description,
  size: r.size,
  isAdmin: r.is_admin,
  announce: r.announce,
  restrict: r.restrict_info,
  joinApproval: r.join_approval,
  memberAddMode: r.member_add_mode,
  left: r.left_at !== null,
  roster: r.participants.map((p) => ({ jid: p.jid, admin: p.admin })),
  pending: r.join_requests.length,
});

/** The `ILIKE` text for a search term: the term is literal, so `%`, `_` and the escape character are escaped. */
const likePattern = (q: string): string => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Tenant-scoped access to `wa_device_groups`. Every method runs inside the caller's `DatabaseService.tx` and names the device: a group is
 * addressed by (workspace, number, group), never by the WhatsApp id alone.
 */
@Injectable()
export class DeviceGroupsRepository {
  async list(
    tx: Tx,
    orgId: number,
    deviceId: number,
    q: Pick<WaDeviceGroupListQuery, 'limit' | 'q' | 'status'>,
    cursor?: Cursor,
  ): Promise<DeviceGroupRow[]> {
    const where: SQL[] = [sql`g.org_id = ${orgId}`, sql`g.device_id = ${deviceId}`];
    if (q.q) where.push(sql`g.subject ILIKE ${likePattern(q.q)}`);
    if (q.status === 'active') where.push(sql`g.left_at IS NULL`);
    if (q.status === 'left') where.push(sql`g.left_at IS NOT NULL`);
    if (cursor) {
      where.push(
        sql`(g.created_at, g.id) < (${cursor.createdAtIso ?? cursor.createdAt.toISOString()}::timestamptz, ${cursor.id})`,
      );
    }
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} ${FROM}
       WHERE ${sql.join(where, sql` AND `)}
       ORDER BY g.created_at DESC, g.id DESC
       LIMIT ${q.limit + 1}`);
    return res.rows.map(toRow);
  }

  /** Over every group of the number, not one page. */
  async stats(tx: Tx, orgId: number, deviceId: number): Promise<WaDeviceGroupStats> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS groups,
             coalesce(sum(size) FILTER (WHERE left_at IS NULL), 0)::int AS members,
             coalesce(sum(jsonb_array_length(join_requests)) FILTER (WHERE left_at IS NULL), 0)::int AS join_requests,
             (count(*) FILTER (WHERE is_admin AND left_at IS NULL))::int AS admin,
             (count(*) FILTER (WHERE left_at IS NOT NULL))::int AS "left"
        FROM wa_device_groups
       WHERE org_id = ${orgId} AND device_id = ${deviceId}`);
    const r = (res.rows[0] ?? {}) as Record<string, unknown>;
    return {
      groups: Number(r.groups ?? 0),
      members: Number(r.members ?? 0),
      joinRequests: Number(r.join_requests ?? 0),
      admin: Number(r.admin ?? 0),
      left: Number(r.left ?? 0),
    };
  }

  async findByUuid(
    tx: Tx,
    orgId: number,
    deviceId: number,
    uuid: string,
    lock = false,
  ): Promise<DeviceGroupRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} ${FROM}
       WHERE g.org_id = ${orgId} AND g.device_id = ${deviceId} AND g.uuid = ${uuid}::uuid
       ${lock ? sql`FOR UPDATE OF g` : sql``}`);
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  async findByJid(
    tx: Tx,
    orgId: number,
    deviceId: number,
    groupJid: string,
    lock = false,
  ): Promise<DeviceGroupRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} ${FROM}
       WHERE g.org_id = ${orgId} AND g.device_id = ${deviceId} AND g.group_jid = ${groupJid}
       ${lock ? sql`FOR UPDATE OF g` : sql``}`);
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  /** The rows of one number for a directory sync (all of them, or just these groups), locked. */
  async forSync(
    tx: Tx,
    orgId: number,
    deviceId: number,
    groupIds: string[] | null,
  ): Promise<DeviceGroupRow[]> {
    const only =
      groupIds === null
        ? sql``
        : groupIds.length === 0
          ? sql`AND false`
          : sql`AND g.group_jid IN (${sql.join(
              groupIds.map((g) => sql`${g}`),
              sql`, `,
            )})`;
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} ${FROM}
       WHERE g.org_id = ${orgId} AND g.device_id = ${deviceId} ${only}
       ORDER BY g.id FOR UPDATE OF g`);
    return res.rows.map(toRow);
  }

  /**
   * What WhatsApp said about a group now. Inserts the row or refreshes it; a group the number is in again clears `left_at`. The invite
   * code is kept only while we are an admin (a member cannot use it), the pending requests only while we are an admin too. `creatorId`
   * is set only when the row is new (our own create).
   */
  async upsertSnapshot(
    tx: Tx,
    orgId: number,
    deviceId: number,
    g: GroupSnapshot,
    now: Date,
    creatorId: number | null = null,
  ): Promise<DeviceGroupRow> {
    const participants = JSON.stringify(
      g.participants.map((p) => ({
        jid: p.jid,
        phone: p.phone,
        lid: p.lid,
        name: p.name,
        admin: p.admin,
      })),
    );
    const size = Math.max(0, Math.trunc(g.size ?? g.participants.length));
    const res = await tx.execute(sql`
      INSERT INTO wa_device_groups (org_id, device_id, group_jid, subject, description, size, is_admin, announce, restrict_info,
        join_approval, member_add_mode, owner_jid, addressing_mode, invite_code, creation_at, synced_at, participants, created_by_user_id)
      VALUES (${orgId}, ${deviceId}, ${g.groupId}, ${g.subject}, ${g.description}, ${size}, ${g.isAdmin}, ${g.announce}, ${g.restrict},
        ${g.joinApproval}, ${g.memberAddMode}, ${g.owner}, ${g.addressingMode}, ${g.isAdmin ? g.inviteCode : null},
        ${g.creation}::timestamptz, ${now}, ${participants}::jsonb, ${creatorId})
      ON CONFLICT (org_id, device_id, group_jid) DO UPDATE SET
        subject = EXCLUDED.subject,
        description = EXCLUDED.description,
        size = EXCLUDED.size,
        is_admin = EXCLUDED.is_admin,
        announce = EXCLUDED.announce,
        restrict_info = EXCLUDED.restrict_info,
        join_approval = EXCLUDED.join_approval,
        member_add_mode = EXCLUDED.member_add_mode,
        owner_jid = coalesce(EXCLUDED.owner_jid, wa_device_groups.owner_jid),
        addressing_mode = coalesce(EXCLUDED.addressing_mode, wa_device_groups.addressing_mode),
        invite_code = CASE WHEN EXCLUDED.is_admin THEN coalesce(EXCLUDED.invite_code, wa_device_groups.invite_code) ELSE NULL END,
        join_requests = CASE WHEN EXCLUDED.is_admin THEN wa_device_groups.join_requests ELSE '[]'::jsonb END,
        creation_at = coalesce(EXCLUDED.creation_at, wa_device_groups.creation_at),
        synced_at = EXCLUDED.synced_at,
        left_at = NULL,
        participants = EXCLUDED.participants,
        created_by_user_id = coalesce(wa_device_groups.created_by_user_id, EXCLUDED.created_by_user_id)
      RETURNING id`);
    const id = Number((res.rows[0] as { id: number | string }).id);
    const row = await this.byId(tx, orgId, id);
    return row!;
  }

  async byId(tx: Tx, orgId: number, id: number): Promise<DeviceGroupRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} ${FROM} WHERE g.org_id = ${orgId} AND g.id = ${id}`);
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  /** The number left, or was removed: the row stays (decision D5), read-only; the pending queue and the link are no use any more. */
  async markLeft(tx: Tx, orgId: number, id: number, now: Date): Promise<DeviceGroupRow> {
    await tx.execute(sql`
      UPDATE wa_device_groups
         SET left_at = coalesce(left_at, ${now}), is_admin = false, invite_code = NULL, join_requests = '[]'::jsonb, synced_at = ${now}
       WHERE org_id = ${orgId} AND id = ${id}`);
    return (await this.byId(tx, orgId, id))!;
  }

  /** A change WhatsApp announced (`groups.update`), applied at once; the re-read that follows corrects anything this missed. */
  async applyPatch(
    tx: Tx,
    orgId: number,
    id: number,
    p: GroupPatch,
    now: Date,
  ): Promise<DeviceGroupRow> {
    await tx.execute(sql`
      UPDATE wa_device_groups SET
        subject = ${p.subject !== undefined ? p.subject : sql`subject`},
        description = ${p.description !== undefined ? p.description : sql`description`},
        announce = ${p.announce !== undefined ? p.announce : sql`announce`},
        restrict_info = ${p.restrict !== undefined ? p.restrict : sql`restrict_info`},
        join_approval = ${p.joinApproval !== undefined ? p.joinApproval : sql`join_approval`},
        member_add_mode = ${p.memberAddMode !== undefined ? p.memberAddMode : sql`member_add_mode`},
        synced_at = ${now}
       WHERE org_id = ${orgId} AND id = ${id}`);
    return (await this.byId(tx, orgId, id))!;
  }

  async setAdmin(tx: Tx, orgId: number, id: number, isAdmin: boolean): Promise<DeviceGroupRow> {
    await tx.execute(sql`
      UPDATE wa_device_groups
         SET is_admin = ${isAdmin},
             invite_code = CASE WHEN ${isAdmin} THEN invite_code ELSE NULL END,
             join_requests = CASE WHEN ${isAdmin} THEN join_requests ELSE '[]'::jsonb END
       WHERE org_id = ${orgId} AND id = ${id}`);
    return (await this.byId(tx, orgId, id))!;
  }

  /** The roster and the member count after a change we made; the re-read the runtime schedules corrects names and anything missed. */
  async setRoster(
    tx: Tx,
    orgId: number,
    id: number,
    participants: WaDeviceGroupParticipant[],
    size: number,
  ): Promise<DeviceGroupRow> {
    await tx.execute(sql`
      UPDATE wa_device_groups SET participants = ${JSON.stringify(participants.slice(0, 1024))}::jsonb, size = ${Math.max(0, size)}
       WHERE org_id = ${orgId} AND id = ${id}`);
    return (await this.byId(tx, orgId, id))!;
  }

  /** Settings we changed through WhatsApp and it accepted (partial when a later call of one PATCH failed). */
  async setSettings(
    tx: Tx,
    orgId: number,
    id: number,
    p: {
      subject?: string;
      description?: string | null;
      announce?: boolean;
      restrict?: boolean;
      joinApproval?: boolean;
      memberAddMode?: 'all_member_add' | 'admin_add';
    },
    now: Date,
  ): Promise<DeviceGroupRow> {
    return this.applyPatch(
      tx,
      orgId,
      id,
      {
        ...(p.subject !== undefined ? { subject: p.subject } : {}),
        ...(p.description !== undefined ? { description: p.description ?? '' } : {}),
        ...(p.announce !== undefined ? { announce: p.announce } : {}),
        ...(p.restrict !== undefined ? { restrict: p.restrict } : {}),
        ...(p.joinApproval !== undefined ? { joinApproval: p.joinApproval } : {}),
        ...(p.memberAddMode !== undefined ? { memberAddMode: p.memberAddMode } : {}),
      },
      now,
    );
  }

  async setJoinRequests(
    tx: Tx,
    orgId: number,
    id: number,
    requests: WaDeviceGroupJoinRequest[],
  ): Promise<DeviceGroupRow> {
    await tx.execute(sql`
      UPDATE wa_device_groups SET join_requests = ${JSON.stringify(requests.slice(0, 1000))}::jsonb
       WHERE org_id = ${orgId} AND id = ${id}`);
    return (await this.byId(tx, orgId, id))!;
  }

  async setInviteCode(
    tx: Tx,
    orgId: number,
    id: number,
    code: string | null,
  ): Promise<DeviceGroupRow> {
    await tx.execute(sql`
      UPDATE wa_device_groups SET invite_code = ${code} WHERE org_id = ${orgId} AND id = ${id}`);
    return (await this.byId(tx, orgId, id))!;
  }

  /** The secret. Read only by the invite-link route (and the reset); never put in a list, a log or an audit row. */
  async inviteCodeOf(tx: Tx, orgId: number, id: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT invite_code FROM wa_device_groups WHERE org_id = ${orgId} AND id = ${id}`,
    );
    return ((res.rows[0] as { invite_code: string | null } | undefined)?.invite_code ?? null) as
      string | null;
  }

  async lastSyncedAt(tx: Tx, orgId: number, deviceId: number): Promise<Date | null> {
    const res = await tx.execute(sql`
      SELECT max(synced_at) AS at FROM wa_device_groups WHERE org_id = ${orgId} AND device_id = ${deviceId}`);
    const at = (res.rows[0] as { at: string | Date | null } | undefined)?.at;
    return at ? new Date(at) : null;
  }
}
