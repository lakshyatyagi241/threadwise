import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { ActivityBehaviour, ActivityOptionKind, PhoneCountsAs } from '@crm/contracts';
import type { Tx } from '@crm/db';

export interface ActivityTypeRow {
  id: number;
  uuid: string;
  key: string;
  name: string | null;
  isDefault: boolean;
  behavesAs: ActivityBehaviour;
  icon: string;
  position: number;
  showInCalendar: boolean;
  allowComplete: boolean;
  allowEditCompleted: boolean;
  mobileCheckIn: boolean;
  outcomesEnabled: boolean;
  rowVersion: number;
}

export interface ActivityOptionRow {
  id: number;
  uuid: string;
  activityTypeId: number;
  kind: ActivityOptionKind;
  key: string;
  name: string | null;
  isSystem: boolean;
  countsAs: PhoneCountsAs | null;
  position: number;
  deletedAt: Date | null;
}

/** An option with the activity it belongs to: what a task, a meeting or a call needs to check and to show. */
export interface ActivityOptionWithOwner extends ActivityOptionRow {
  activityKey: string;
  activityBehavesAs: ActivityBehaviour;
  activityOutcomesEnabled: boolean;
  activityArchived: boolean;
}

type Raw = Record<string, unknown>;
const n = (v: unknown): number => Number(v);
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));

const toType = (r: Raw): ActivityTypeRow => ({
  id: n(r.id),
  uuid: r.uuid as string,
  key: r.key as string,
  name: s(r.name),
  isDefault: r.is_default as boolean,
  behavesAs: r.behaves_as as ActivityBehaviour,
  icon: r.icon as string,
  position: n(r.position),
  showInCalendar: r.show_in_calendar as boolean,
  allowComplete: r.allow_complete as boolean,
  allowEditCompleted: r.allow_edit_completed as boolean,
  mobileCheckIn: r.mobile_check_in as boolean,
  outcomesEnabled: r.outcomes_enabled as boolean,
  rowVersion: n(r.row_version),
});

const toOption = (r: Raw): ActivityOptionRow => ({
  id: n(r.id),
  uuid: r.uuid as string,
  activityTypeId: n(r.activity_type_id),
  kind: r.kind as ActivityOptionKind,
  key: r.key as string,
  name: s(r.name),
  isSystem: r.is_system as boolean,
  countsAs: (r.counts_as as PhoneCountsAs | null) ?? null,
  position: n(r.position),
  deletedAt: r.deleted_at ? new Date(r.deleted_at as string) : null,
});

const TYPE_COLS = sql`id, uuid, key, name, is_default, behaves_as, icon, position, show_in_calendar, allow_complete,
  allow_edit_completed, mobile_check_in, outcomes_enabled, row_version`;
const OPTION_COLS = sql`id, uuid, activity_type_id, kind, key, name, is_system, counts_as, position, deleted_at`;

export interface TypePatch {
  name?: string;
  icon?: string;
  showInCalendar?: boolean;
  allowComplete?: boolean;
  allowEditCompleted?: boolean;
  mobileCheckIn?: boolean;
  outcomesEnabled?: boolean;
}

/** Data access for `activity_types` and `activity_type_options`. Every query carries the org: RLS is the backstop, not the filter. */
@Injectable()
export class ActivityTypesRepository {
  /** Adds the missing defaults (idempotent; never touches a row an admin changed). */
  async seed(tx: Tx, orgId: number): Promise<void> {
    await tx.execute(sql`SELECT seed_activity_types(${orgId})`);
  }

  async listTypes(tx: Tx, orgId: number): Promise<ActivityTypeRow[]> {
    const res = await tx.execute(sql`
      SELECT ${TYPE_COLS} FROM activity_types
      WHERE org_id = ${orgId} AND archived_at IS NULL
      ORDER BY position, id
    `);
    return res.rows.map((r) => toType(r as Raw));
  }

  async listOptions(tx: Tx, orgId: number): Promise<ActivityOptionRow[]> {
    const res = await tx.execute(sql`
      SELECT ${OPTION_COLS} FROM activity_type_options
      WHERE org_id = ${orgId} AND deleted_at IS NULL
      ORDER BY kind, position, id
    `);
    return res.rows.map((r) => toOption(r as Raw));
  }

  async findTypeByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    lock = false,
  ): Promise<ActivityTypeRow | undefined> {
    const res = await tx.execute(sql`
      SELECT ${TYPE_COLS} FROM activity_types
      WHERE org_id = ${orgId} AND uuid = ${uuid} AND archived_at IS NULL
      ${lock ? sql`FOR UPDATE` : sql``}
    `);
    const r = res.rows[0] as Raw | undefined;
    return r ? toType(r) : undefined;
  }

  /** The default activity with this key ('task', 'meeting', 'phone'): where the switches of tasks, meetings and calls live. */
  async findTypeByKey(tx: Tx, orgId: number, key: string): Promise<ActivityTypeRow | undefined> {
    const res = await tx.execute(sql`
      SELECT ${TYPE_COLS} FROM activity_types
      WHERE org_id = ${orgId} AND key = ${key} AND archived_at IS NULL
    `);
    const r = res.rows[0] as Raw | undefined;
    return r ? toType(r) : undefined;
  }

  /** Names and keys of the live custom activities, to keep a new one unique. */
  async customNamesAndKeys(
    tx: Tx,
    orgId: number,
  ): Promise<{ key: string; name: string | null; archived: boolean }[]> {
    const res = await tx.execute(sql`
      SELECT key, name, archived_at IS NOT NULL AS archived FROM activity_types WHERE org_id = ${orgId}
    `);
    return res.rows.map((r) => ({
      key: (r as Raw).key as string,
      name: s((r as Raw).name),
      archived: (r as Raw).archived as boolean,
    }));
  }

  async countCustom(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS c FROM activity_types WHERE org_id = ${orgId} AND NOT is_default AND archived_at IS NULL
    `);
    return n((res.rows[0] as Raw).c);
  }

  async insertType(
    tx: Tx,
    orgId: number,
    v: {
      key: string;
      name: string;
      behavesAs: ActivityBehaviour;
      icon: string;
      position: number;
      showInCalendar: boolean;
      allowComplete: boolean;
      outcomesEnabled: boolean;
      createdBy: number | null;
    },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO activity_types (org_id, key, name, is_default, behaves_as, icon, position, show_in_calendar, allow_complete, outcomes_enabled, created_by)
      VALUES (${orgId}, ${v.key}, ${v.name}, false, ${v.behavesAs}, ${v.icon}, ${v.position}, ${v.showInCalendar}, ${v.allowComplete},
              ${v.outcomesEnabled}, ${v.createdBy})
      RETURNING id
    `);
    return n((res.rows[0] as Raw).id);
  }

  async nextTypePosition(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT coalesce(max(position), -1) + 1 AS p FROM activity_types WHERE org_id = ${orgId}`,
    );
    return n((res.rows[0] as Raw).p);
  }

  async updateType(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number,
    p: TypePatch,
  ): Promise<boolean> {
    const sets = [sql`updated_at = now()`];
    if (p.name !== undefined) sets.push(sql`name = ${p.name}`);
    if (p.icon !== undefined) sets.push(sql`icon = ${p.icon}`);
    if (p.showInCalendar !== undefined) sets.push(sql`show_in_calendar = ${p.showInCalendar}`);
    if (p.allowComplete !== undefined) sets.push(sql`allow_complete = ${p.allowComplete}`);
    if (p.allowEditCompleted !== undefined)
      sets.push(sql`allow_edit_completed = ${p.allowEditCompleted}`);
    if (p.mobileCheckIn !== undefined) sets.push(sql`mobile_check_in = ${p.mobileCheckIn}`);
    if (p.outcomesEnabled !== undefined) sets.push(sql`outcomes_enabled = ${p.outcomesEnabled}`);
    const res = await tx.execute(sql`
      UPDATE activity_types SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${expectedVersion}
      RETURNING id
    `);
    return res.rows.length > 0;
  }

  async archiveType(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(
      sql`UPDATE activity_types SET archived_at = now() WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  // --- options ------------------------------------------------------------------------------------------------------------

  /** Every option of one list, removed ones included (a re-added name brings its row back). */
  async allOptionsOf(
    tx: Tx,
    orgId: number,
    typeId: number,
    kind: ActivityOptionKind,
  ): Promise<ActivityOptionRow[]> {
    const res = await tx.execute(sql`
      SELECT ${OPTION_COLS} FROM activity_type_options
      WHERE org_id = ${orgId} AND activity_type_id = ${typeId} AND kind = ${kind}
      ORDER BY position, id
      FOR UPDATE
    `);
    return res.rows.map((r) => toOption(r as Raw));
  }

  async insertOption(
    tx: Tx,
    orgId: number,
    v: {
      typeId: number;
      kind: ActivityOptionKind;
      key: string;
      name: string;
      countsAs: PhoneCountsAs | null;
      position: number;
    },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO activity_type_options (org_id, activity_type_id, kind, key, name, is_system, counts_as, position)
      VALUES (${orgId}, ${v.typeId}, ${v.kind}, ${v.key}, ${v.name}, false, ${v.countsAs}, ${v.position})
      RETURNING id
    `);
    return n((res.rows[0] as Raw).id);
  }

  async reviveOption(
    tx: Tx,
    orgId: number,
    id: number,
    position: number,
    name: string | null,
    countsAs: PhoneCountsAs | null,
  ): Promise<void> {
    // A seeded option keeps its null name (its localised word); a custom one takes the name as typed now.
    await tx.execute(sql`
      UPDATE activity_type_options
      SET deleted_at = NULL, position = ${position}, name = coalesce(${name}, name), counts_as = coalesce(${countsAs}, counts_as)
      WHERE org_id = ${orgId} AND id = ${id}
    `);
  }

  async findOptionByUuid(
    tx: Tx,
    orgId: number,
    activityId: number,
    optionUuid: string,
  ): Promise<ActivityOptionRow | undefined> {
    const res = await tx.execute(sql`
      SELECT ${OPTION_COLS} FROM activity_type_options
      WHERE org_id = ${orgId} AND activity_type_id = ${activityId} AND uuid = ${optionUuid} AND deleted_at IS NULL
      FOR UPDATE
    `);
    const r = res.rows[0] as Raw | undefined;
    return r ? toOption(r) : undefined;
  }

  async softDeleteOption(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(
      sql`UPDATE activity_type_options SET deleted_at = now() WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  /** Re-numbers a list 0..n-1 in the given order. */
  async setPositions(tx: Tx, orgId: number, orderedIds: number[]): Promise<void> {
    if (orderedIds.length === 0) return;
    const list = sql.join(
      orderedIds.map((i) => sql`${i}`),
      sql`, `,
    );
    await tx.execute(sql`
      UPDATE activity_type_options o SET position = (v.ord - 1)::int
      FROM unnest(ARRAY[${list}]::bigint[]) WITH ORDINALITY AS v(id, ord)
      WHERE o.org_id = ${orgId} AND o.id = v.id
    `);
  }

  async countActive(
    tx: Tx,
    orgId: number,
    typeId: number,
    kind: ActivityOptionKind,
  ): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS c FROM activity_type_options
      WHERE org_id = ${orgId} AND activity_type_id = ${typeId} AND kind = ${kind} AND deleted_at IS NULL
    `);
    return n((res.rows[0] as Raw).c);
  }

  // --- what the consumers (tasks, meetings, calls) read ----------------------------------------------------------------------

  async optionWithOwner(
    tx: Tx,
    orgId: number,
    optionUuid: string,
  ): Promise<ActivityOptionWithOwner | undefined> {
    const res = await tx.execute(sql`
      SELECT o.id, o.uuid, o.activity_type_id, o.kind, o.key, o.name, o.is_system, o.counts_as, o.position, o.deleted_at,
             a.key AS activity_key, a.behaves_as AS activity_behaves_as, a.outcomes_enabled AS activity_outcomes_enabled,
             a.archived_at IS NOT NULL AS activity_archived
      FROM activity_type_options o
      JOIN activity_types a ON a.org_id = o.org_id AND a.id = o.activity_type_id
      WHERE o.org_id = ${orgId} AND o.uuid = ${optionUuid}
    `);
    const r = res.rows[0] as Raw | undefined;
    if (!r) return undefined;
    return {
      ...toOption(r),
      activityKey: r.activity_key as string,
      activityBehavesAs: r.activity_behaves_as as ActivityBehaviour,
      activityOutcomesEnabled: r.activity_outcomes_enabled as boolean,
      activityArchived: r.activity_archived as boolean,
    };
  }

  /** The id of a seeded option (for the follow-up task type). */
  async systemOptionId(
    tx: Tx,
    orgId: number,
    activityKey: string,
    kind: ActivityOptionKind,
    key: string,
  ): Promise<number | null> {
    const res = await tx.execute(sql`
      SELECT o.id FROM activity_type_options o
      JOIN activity_types a ON a.org_id = o.org_id AND a.id = o.activity_type_id
      WHERE o.org_id = ${orgId} AND a.key = ${activityKey} AND o.kind = ${kind} AND o.key = ${key}
    `);
    const r = res.rows[0] as Raw | undefined;
    return r ? n(r.id) : null;
  }
}
