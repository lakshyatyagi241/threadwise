import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { Cursor } from '../../common/pagination/cursor';
import type { GroupFacts } from './waba-group-rules';

/** A `waba_groups` row as the screens read it. */
export interface WabaGroupRow {
  id: number;
  uuid: string;
  provider_config_id: number;
  group_id: string;
  subject: string | null;
  description: string | null;
  invite_link: string | null;
  join_approval_mode: string | null;
  participant_count: number;
  suspended: boolean;
  creation_timestamp: Date | null;
  synced_at: Date | null;
  meta_json: Record<string, unknown> | null;
  created_at: Date;
  /** The same instant with microseconds, for the keyset cursor (a JS Date keeps milliseconds only). */
  created_at_iso: string;
  row_version: number;
}

const COLUMNS =
  sql.raw(`id, uuid, provider_config_id, group_id, subject, description, invite_link, join_approval_mode,
  participant_count, suspended, creation_timestamp, synced_at, meta_json, created_at, row_version,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso`);

const toRow = (r: Record<string, unknown>): WabaGroupRow => ({
  id: Number(r.id),
  uuid: String(r.uuid),
  provider_config_id: Number(r.provider_config_id),
  group_id: String(r.group_id),
  subject: (r.subject as string | null) ?? null,
  description: (r.description as string | null) ?? null,
  invite_link: (r.invite_link as string | null) ?? null,
  join_approval_mode: (r.join_approval_mode as string | null) ?? null,
  participant_count: Number(r.participant_count),
  suspended: Boolean(r.suspended),
  creation_timestamp: r.creation_timestamp ? new Date(r.creation_timestamp as string) : null,
  synced_at: r.synced_at ? new Date(r.synced_at as string) : null,
  meta_json: (r.meta_json as Record<string, unknown> | null) ?? null,
  created_at: new Date(r.created_at as string),
  created_at_iso: String(r.created_at_iso),
  row_version: Number(r.row_version),
});

export const factsOf = (r: WabaGroupRow): GroupFacts => ({
  subject: r.subject,
  description: r.description,
  inviteLink: r.invite_link,
  joinApprovalMode: r.join_approval_mode,
  participantCount: r.participant_count,
  suspended: r.suspended,
  creationTimestamp: r.creation_timestamp,
  meta: r.meta_json ?? {},
});

export interface GroupStatsRow {
  groups: number;
  members: number;
  joinRequests: number;
  suspended: number;
}

/**
 * Tenant-scoped access to `waba_groups` for the management screens. Every method runs inside the caller's `DatabaseService.tx`, and every
 * read names the number (`provider_config_id`): a group is addressed by (workspace, number, group), never by Meta's id alone.
 */
@Injectable()
export class WabaGroupsRepository {
  async list(
    tx: Tx,
    orgId: number,
    configId: number,
    limit: number,
    cursor?: Cursor,
  ): Promise<WabaGroupRow[]> {
    const after = cursor
      ? sql`AND (created_at, id) < (${cursor.createdAtIso ?? cursor.createdAt.toISOString()}::timestamptz, ${cursor.id})`
      : sql``;
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM waba_groups
       WHERE org_id = ${orgId} AND provider_config_id = ${configId} ${after}
       ORDER BY created_at DESC, id DESC
       LIMIT ${limit + 1}`);
    return res.rows.map(toRow);
  }

  /** Over every group of the number, not one page. A pending request is one key of `meta_json.join_requests` (an object; a legacy array counts 0). */
  async stats(tx: Tx, orgId: number, configId: number): Promise<GroupStatsRow> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS groups,
             coalesce(sum(participant_count), 0)::int AS members,
             coalesce(sum(CASE WHEN jsonb_typeof(meta_json -> 'join_requests') = 'object'
                               THEN (SELECT count(*) FROM jsonb_object_keys(meta_json -> 'join_requests'))
                               ELSE 0 END), 0)::int AS join_requests,
             (count(*) FILTER (WHERE suspended))::int AS suspended
        FROM waba_groups
       WHERE org_id = ${orgId} AND provider_config_id = ${configId}`);
    const r = (res.rows[0] ?? {}) as Record<string, unknown>;
    return {
      groups: Number(r.groups ?? 0),
      members: Number(r.members ?? 0),
      joinRequests: Number(r.join_requests ?? 0),
      suspended: Number(r.suspended ?? 0),
    };
  }

  async findByUuid(
    tx: Tx,
    orgId: number,
    configId: number,
    uuid: string,
    lock = false,
  ): Promise<WabaGroupRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM waba_groups
       WHERE org_id = ${orgId} AND provider_config_id = ${configId} AND uuid = ${uuid}::uuid
       ${lock ? sql`FOR UPDATE` : sql``}`);
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  async findByGroupId(
    tx: Tx,
    orgId: number,
    configId: number,
    groupId: string,
    lock = false,
  ): Promise<WabaGroupRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM waba_groups
       WHERE org_id = ${orgId} AND provider_config_id = ${configId} AND group_id = ${groupId}
       ${lock ? sql`FOR UPDATE` : sql``}`);
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  /**
   * What our own create knows now: the row appears without an invite link (Meta sends it on the lifecycle webhook). The webhook may have
   * made the row first, so this is an upsert on (number, group) and the maker is set only when the row is new.
   */
  async upsertCreated(
    tx: Tx,
    orgId: number,
    configId: number,
    input: {
      groupId: string;
      subject: string;
      description: string | null;
      joinApprovalMode: string | null;
      userId: number | null;
      now: Date;
    },
  ): Promise<WabaGroupRow> {
    const res = await tx.execute(sql`
      INSERT INTO waba_groups (org_id, provider_config_id, group_id, subject, description, join_approval_mode, created_by_user_id, synced_at, meta_json)
      VALUES (${orgId}, ${configId}, ${input.groupId}, ${input.subject}, ${input.description}, ${input.joinApprovalMode},
              ${input.userId}, ${input.now}, '{}'::jsonb)
      ON CONFLICT (org_id, provider_config_id, group_id) DO UPDATE SET
        subject = EXCLUDED.subject,
        description = coalesce(EXCLUDED.description, waba_groups.description),
        join_approval_mode = coalesce(EXCLUDED.join_approval_mode, waba_groups.join_approval_mode),
        synced_at = EXCLUDED.synced_at
      RETURNING ${COLUMNS}`);
    return toRow(res.rows[0] as Record<string, unknown>);
  }

  /** The state a refresh read from Meta; the link only when that second call worked. */
  async applyRefresh(
    tx: Tx,
    orgId: number,
    id: number,
    v: {
      subject: string | null;
      description: string | null;
      joinApprovalMode: string | null;
      participantCount: number | null;
      suspended: boolean | null;
      inviteLink: string | null;
      now: Date;
    },
  ): Promise<WabaGroupRow> {
    const res = await tx.execute(sql`
      UPDATE waba_groups SET
        subject = coalesce(${v.subject}, subject),
        description = coalesce(${v.description}, description),
        join_approval_mode = coalesce(${v.joinApprovalMode}, join_approval_mode),
        participant_count = coalesce(${v.participantCount}::int, participant_count),
        suspended = coalesce(${v.suspended}::boolean, suspended),
        invite_link = coalesce(${v.inviteLink}, invite_link),
        synced_at = ${v.now}
       WHERE org_id = ${orgId} AND id = ${id}
      RETURNING ${COLUMNS}`);
    return toRow(res.rows[0] as Record<string, unknown>);
  }

  async setInviteLink(
    tx: Tx,
    orgId: number,
    id: number,
    link: string | null,
    now: Date,
  ): Promise<WabaGroupRow> {
    const res = await tx.execute(sql`
      UPDATE waba_groups SET invite_link = ${link}, synced_at = ${now}
       WHERE org_id = ${orgId} AND id = ${id}
      RETURNING ${COLUMNS}`);
    return toRow(res.rows[0] as Record<string, unknown>);
  }

  /** The handled ids leave the pending queue (the participant webhook corrects the member count). */
  async removePending(tx: Tx, orgId: number, id: number, ids: string[]): Promise<WabaGroupRow> {
    const res = await tx.execute(sql`
      UPDATE waba_groups SET meta_json = jsonb_set(
          coalesce(meta_json, '{}'::jsonb), '{join_requests}',
          coalesce((SELECT jsonb_object_agg(k, v)
                      FROM jsonb_each(CASE WHEN jsonb_typeof(meta_json -> 'join_requests') = 'object'
                                           THEN meta_json -> 'join_requests' ELSE '{}'::jsonb END) AS e(k, v)
                     WHERE NOT (k = ANY (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)))), '{}'::jsonb),
          true)
       WHERE org_id = ${orgId} AND id = ${id}
      RETURNING ${COLUMNS}`);
    return toRow(res.rows[0] as Record<string, unknown>);
  }

  async delete(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM waba_groups WHERE org_id = ${orgId} AND id = ${id}`);
  }
}
