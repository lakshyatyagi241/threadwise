import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  assignmentRulesSchema,
  legacyConditionsToRules,
  type AssignmentRules,
  type AssignmentSubject,
  type AssignmentTraceEntry,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { onLeaveOnSql } from '../../../common/workspace-calendar';

type Raw = Record<string, unknown>;

export interface RuleRow {
  id: number;
  uuid: string;
  name: string;
  description: string;
  subject: AssignmentSubject;
  /** The condition tree: the saved one, or the one made from flat conditions saved before the field-by-field builder. Null = no condition. */
  tree: AssignmentRules | null;
  strategy: 'fixed' | 'round_robin' | 'least_busy';
  userIds: string[];
  teamIds: string[];
  skipOffline: boolean;
  reassignOnUpdate: boolean;
  rrCursor: number | null;
  sort: number;
  isActive: boolean;
  firedCount: number;
  lastFiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: { uuid: string; name: string } | null;
  rowVersion: number;
}

/** What the engine needs to know about a record before it decides. */
export interface RecordHead {
  id: number;
  uuid: string;
  ownerId: number | null;
  ownerChangedAt: Date | null;
  /** A name for the screens (never a phone number or an email). */
  label: string;
}

export interface Candidate {
  id: number;
  uuid: string;
  name: string;
  /** Records of this subject they hold now (contacts and companies owned, or open deals owned): the least-busy measure. */
  load: number;
}

export interface RunRow {
  id: number;
  uuid: string;
  subject: AssignmentSubject;
  recordId: number;
  ruleId: number | null;
  ruleName: string | null;
  outcome: 'assigned' | 'reassigned' | 'skipped';
  reason: string;
  ownerId: number | null;
  ownerUuid: string | null;
  ownerName: string | null;
  method: string | null;
  origin: string;
  trigger: 'created' | 'updated';
  trace: AssignmentTraceEntry[];
  ownerStamp: Date | null;
  createdAt: Date;
}

const treeOf = (rules: unknown, conditions: unknown): AssignmentRules | null => {
  if (rules !== null && rules !== undefined) {
    const parsed = assignmentRulesSchema.safeParse(rules);
    return parsed.success ? parsed.data : null;
  }
  return legacyConditionsToRules(conditions);
};

const toRule = (r: Raw): RuleRow => ({
  id: Number(r.id),
  uuid: String(r.uuid),
  name: String(r.name),
  description: String(r.description ?? ''),
  subject: r.subject as AssignmentSubject,
  tree: treeOf(r.rules, r.conditions),
  strategy: r.strategy as RuleRow['strategy'],
  userIds: (r.user_ids as string[]) ?? [],
  teamIds: (r.team_ids as string[]) ?? [],
  skipOffline: r.skip_offline === true,
  reassignOnUpdate: r.reassign_on_update === true,
  rrCursor: r.rr_cursor === null || r.rr_cursor === undefined ? null : Number(r.rr_cursor),
  sort: Number(r.sort),
  isActive: r.is_active === true,
  firedCount: Number(r.fired_count),
  lastFiredAt: r.last_fired_at ? new Date(r.last_fired_at as string | Date) : null,
  createdAt: new Date(r.created_at as string | Date),
  updatedAt: new Date(r.updated_at as string | Date),
  updatedBy: r.updated_by_uuid
    ? { uuid: String(r.updated_by_uuid), name: String(r.updated_by_name ?? '') }
    : null,
  rowVersion: Number(r.row_version),
});

/** The rule columns with the last editor joined in (alias `r` for the rule, `ub` for the editor). */
const RULE_SELECT = sql`SELECT r.id, r.uuid, r.name, r.description, r.subject, r.conditions, r.rules, r.strategy, r.user_ids, r.team_ids,
       r.skip_offline, r.reassign_on_update, r.rr_cursor, r.sort, r.is_active, r.fired_count, r.last_fired_at, r.created_at,
       r.updated_at, r.row_version, ub.uuid AS updated_by_uuid, ub.full_name AS updated_by_name
  FROM assignment_rules r LEFT JOIN users ub ON ub.org_id = r.org_id AND ub.id = r.updated_by`;

const toRun = (r: Raw): RunRow => ({
  id: Number(r.id),
  uuid: String(r.uuid),
  subject: r.subject as AssignmentSubject,
  recordId: Number(r.record_id),
  ruleId: r.rule_id === null || r.rule_id === undefined ? null : Number(r.rule_id),
  ruleName: (r.rule_name as string | null) ?? null,
  outcome: r.outcome as RunRow['outcome'],
  reason: String(r.reason),
  ownerId: r.owner_id === null || r.owner_id === undefined ? null : Number(r.owner_id),
  ownerUuid: r.owner_uuid ? String(r.owner_uuid) : null,
  ownerName: r.owner_name ? String(r.owner_name) : null,
  method: (r.method as string | null) ?? null,
  origin: String(r.origin),
  trigger: r.trigger as RunRow['trigger'],
  trace: (r.trace as AssignmentTraceEntry[]) ?? [],
  ownerStamp: r.owner_stamp ? new Date(r.owner_stamp as string | Date) : null,
  createdAt: new Date(r.created_at as string | Date),
});

const TABLE = { contact: sql`contacts`, company: sql`companies`, deal: sql`deals` } as const;
const OWNER_COL = {
  contact: sql`owner_id`,
  company: sql`owner_id`,
  deal: sql`owner_user_id`,
} as const;
const LABEL = {
  contact: sql`coalesce(nullif(btrim(name), ''), 'Contact')`,
  company: sql`name`,
  deal: sql`title`,
} as const;

/** Data access for the assignment rules, the settings, the run log and the records the engine looks at. */
@Injectable()
export class ContactAssignmentRepository {
  // --- settings ----------------------------------------------------------------------------------------------------------------

  async settings(tx: Tx, orgId: number): Promise<{ enabled: boolean; applyToImports: boolean }> {
    const res = await tx.execute(
      sql`SELECT enabled, apply_to_imports FROM assignment_settings WHERE org_id = ${orgId}`,
    );
    const r = res.rows[0] as Raw | undefined;
    return { enabled: r?.enabled === true, applyToImports: r?.apply_to_imports === true };
  }

  async saveSettings(
    tx: Tx,
    orgId: number,
    v: { enabled: boolean; applyToImports: boolean },
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO assignment_settings (org_id, enabled, apply_to_imports) VALUES (${orgId}, ${v.enabled}, ${v.applyToImports})
      ON CONFLICT (org_id) DO UPDATE SET enabled = EXCLUDED.enabled, apply_to_imports = EXCLUDED.apply_to_imports`);
  }

  // --- rules -------------------------------------------------------------------------------------------------------------------

  /** In list order (subject, then the drag order). */
  async rules(
    tx: Tx,
    orgId: number,
    subject?: AssignmentSubject,
    activeOnly = false,
  ): Promise<RuleRow[]> {
    const res = await tx.execute(sql`
      ${RULE_SELECT}
      WHERE r.org_id = ${orgId} ${subject ? sql`AND r.subject = ${subject}` : sql``} ${activeOnly ? sql`AND r.is_active` : sql``}
      ORDER BY r.subject, r.sort, r.id`);
    return (res.rows as Raw[]).map(toRule);
  }

  async ruleByUuid(tx: Tx, orgId: number, uuid: string, lock = false): Promise<RuleRow | null> {
    const res = await tx.execute(sql`
      ${RULE_SELECT} WHERE r.org_id = ${orgId} AND r.uuid = ${uuid} ${lock ? sql`FOR UPDATE OF r` : sql``}`);
    return res.rows[0] ? toRule(res.rows[0] as Raw) : null;
  }

  async ruleById(tx: Tx, orgId: number, id: number, lock = false): Promise<RuleRow | null> {
    const res = await tx.execute(sql`
      ${RULE_SELECT} WHERE r.org_id = ${orgId} AND r.id = ${id} ${lock ? sql`FOR UPDATE OF r` : sql``}`);
    return res.rows[0] ? toRule(res.rows[0] as Raw) : null;
  }

  async nextSort(tx: Tx, orgId: number, subject: AssignmentSubject): Promise<number> {
    const res = await tx.execute(
      sql`SELECT coalesce(max(sort), 0) + 10 AS n FROM assignment_rules WHERE org_id = ${orgId} AND subject = ${subject}`,
    );
    return Number((res.rows[0] as Raw).n);
  }

  async insertRule(
    tx: Tx,
    orgId: number,
    v: {
      name: string;
      description: string;
      subject: string;
      rules: AssignmentRules | null;
      strategy: string;
      userIds: string[];
      teamIds: string[];
      skipOffline: boolean;
      reassignOnUpdate: boolean;
      isActive: boolean;
      sort: number;
      actorId: number | null;
    },
  ): Promise<string> {
    const res = await tx.execute(sql`
      INSERT INTO assignment_rules (org_id, name, description, subject, rules, strategy, user_ids, team_ids, skip_offline,
                                    reassign_on_update, is_active, sort, created_by, updated_by)
      VALUES (${orgId}, ${v.name}, ${v.description}, ${v.subject}, ${v.rules === null ? sql`NULL` : sql`${JSON.stringify(v.rules)}::jsonb`},
              ${v.strategy}, ${JSON.stringify(v.userIds)}::jsonb, ${JSON.stringify(v.teamIds)}::jsonb, ${v.skipOffline},
              ${v.reassignOnUpdate}, ${v.isActive}, ${v.sort}, ${v.actorId}, ${v.actorId})
      RETURNING uuid`);
    return String((res.rows[0] as Raw).uuid);
  }

  /**
   * Saves an edit. Writing `rules` retires the flat `conditions` a rule may have been saved with, so an emptied tree means "no
   * condition" and not "the old conditions again". A changed pool starts a fresh rotation.
   */
  async updateRule(
    tx: Tx,
    orgId: number,
    id: number,
    rowVersion: number,
    v: {
      name: string;
      description: string;
      tree: AssignmentRules | null;
      strategy: string;
      userIds: string[];
      teamIds: string[];
      skipOffline: boolean;
      reassignOnUpdate: boolean;
      isActive: boolean;
      actorId: number | null;
      resetRotation: boolean;
    },
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE assignment_rules SET name = ${v.name}, description = ${v.description},
             rules = ${v.tree === null ? sql`NULL` : sql`${JSON.stringify(v.tree)}::jsonb`}, conditions = '{}'::jsonb,
             strategy = ${v.strategy}, user_ids = ${JSON.stringify(v.userIds)}::jsonb, team_ids = ${JSON.stringify(v.teamIds)}::jsonb,
             skip_offline = ${v.skipOffline}, reassign_on_update = ${v.reassignOnUpdate}, is_active = ${v.isActive},
             updated_by = ${v.actorId}
             ${v.resetRotation ? sql`, rr_cursor = NULL` : sql``}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${rowVersion} RETURNING id`);
    return res.rows.length > 0;
  }

  async setActive(
    tx: Tx,
    orgId: number,
    id: number,
    active: boolean,
    actorId: number | null,
  ): Promise<void> {
    await tx.execute(
      sql`UPDATE assignment_rules SET is_active = ${active}, updated_by = ${actorId} WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  async deleteRule(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM assignment_rules WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async setSort(tx: Tx, orgId: number, id: number, sort: number): Promise<void> {
    await tx.execute(
      sql`UPDATE assignment_rules SET sort = ${sort} WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  async markFired(tx: Tx, orgId: number, id: number, cursor: number | null): Promise<void> {
    await tx.execute(sql`
      UPDATE assignment_rules SET fired_count = fired_count + 1, last_fired_at = now(),
             rr_cursor = ${cursor === null ? sql`rr_cursor` : cursor}
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  // --- what rules point at ------------------------------------------------------------------------------------------------------

  async userIdsByUuid(
    tx: Tx,
    orgId: number,
    uuids: readonly string[],
  ): Promise<Map<string, number>> {
    if (uuids.length === 0) return new Map();
    const res = await tx.execute(sql`
      SELECT uuid, id FROM users WHERE org_id = ${orgId} AND status = 'active'
        AND uuid IN (${sql.join(
          uuids.map((u) => sql`${u}::uuid`),
          sql`, `,
        )})`);
    return new Map((res.rows as Raw[]).map((r) => [String(r.uuid), Number(r.id)]));
  }

  async teamIdsByUuid(
    tx: Tx,
    orgId: number,
    uuids: readonly string[],
  ): Promise<Map<string, number>> {
    if (uuids.length === 0) return new Map();
    const res = await tx.execute(sql`
      SELECT uuid, id FROM teams WHERE org_id = ${orgId}
        AND uuid IN (${sql.join(
          uuids.map((u) => sql`${u}::uuid`),
          sql`, `,
        )})`);
    return new Map((res.rows as Raw[]).map((r) => [String(r.uuid), Number(r.id)]));
  }

  async teamMembers(tx: Tx, orgId: number, teamIds: readonly number[]): Promise<number[]> {
    if (teamIds.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT DISTINCT user_id FROM team_members WHERE org_id = ${orgId}
        AND team_id IN (${sql.join(
          teamIds.map((t) => sql`${t}`),
          sql`, `,
        )}) ORDER BY user_id`);
    return (res.rows as Raw[]).map((r) => Number(r.user_id));
  }

  /** The people among `ids` who can take work today: active, not on leave, and (when asked) not offline, each with their load. */
  async candidates(
    tx: Tx,
    orgId: number,
    ids: readonly number[],
    subject: AssignmentSubject,
    skipOffline: boolean,
    today: string,
  ): Promise<Candidate[]> {
    if (ids.length === 0) return [];
    const load =
      subject === 'contact'
        ? sql`(SELECT count(*)::int FROM contacts c WHERE c.org_id = u.org_id AND c.owner_id = u.id)`
        : subject === 'company'
          ? sql`(SELECT count(*)::int FROM companies co WHERE co.org_id = u.org_id AND co.owner_id = u.id)`
          : sql`(SELECT count(*)::int FROM deals d WHERE d.org_id = u.org_id AND d.owner_user_id = u.id AND d.status = 'open')`;
    const res = await tx.execute(sql`
      SELECT u.id, u.uuid, u.full_name, ${load} AS load
      FROM users u LEFT JOIN agent_statuses s ON s.org_id = u.org_id AND s.user_id = u.id
      WHERE u.org_id = ${orgId} AND u.status = 'active'
        AND u.id IN (${sql.join(
          ids.map((i) => sql`${i}`),
          sql`, `,
        )})
        AND NOT ${onLeaveOnSql('u', today)}
        ${skipOffline ? sql`AND COALESCE(s.status, 'online') <> 'offline'` : sql``}
      ORDER BY u.id`);
    return (res.rows as Raw[]).map((r) => ({
      id: Number(r.id),
      uuid: String(r.uuid),
      name: String(r.full_name),
      load: Number(r.load),
    }));
  }

  /** Delegates of these people (internal ids): used for a fixed rule whose person is away. */
  async delegatesOf(tx: Tx, orgId: number, ids: readonly number[]): Promise<Map<number, number>> {
    if (ids.length === 0) return new Map();
    const res = await tx.execute(sql`
      SELECT d.user_id, d.delegate_user_id FROM member_delegates d
      JOIN users du ON du.org_id = d.org_id AND du.id = d.delegate_user_id AND du.status = 'active'
      WHERE d.org_id = ${orgId} AND d.user_id IN (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )})`);
    return new Map((res.rows as Raw[]).map((r) => [Number(r.user_id), Number(r.delegate_user_id)]));
  }

  // --- the records ---------------------------------------------------------------------------------------------------------------

  async recordHead(
    tx: Tx,
    orgId: number,
    subject: AssignmentSubject,
    uuid: string,
    lock: boolean,
  ): Promise<RecordHead | null> {
    const res = await tx.execute(sql`
      SELECT id, uuid, ${OWNER_COL[subject]} AS owner, owner_changed_at, ${LABEL[subject]} AS label
      FROM ${TABLE[subject]} WHERE org_id = ${orgId} AND uuid = ${uuid}
      ${lock ? sql`FOR UPDATE` : sql``}`);
    const r = res.rows[0] as Raw | undefined;
    if (!r) return null;
    return {
      id: Number(r.id),
      uuid: String(r.uuid),
      ownerId: r.owner === null ? null : Number(r.owner),
      ownerChangedAt: r.owner_changed_at ? new Date(r.owner_changed_at as string | Date) : null,
      label: String(r.label ?? ''),
    };
  }

  /**
   * Which of these conditions hold for the record, in one statement: one boolean column per condition (`r0`, `r1`...).
   * The conditions are SQL over the module's own table (see `compileAssignment`).
   */
  async evaluate(
    tx: Tx,
    orgId: number,
    subject: AssignmentSubject,
    recordId: number,
    wheres: readonly SQL[],
  ): Promise<boolean[]> {
    if (wheres.length === 0) return [];
    const cols = sql.join(
      wheres.map((w, i) => sql`coalesce((${w}), false) AS ${sql.raw(`r${i}`)}`),
      sql`, `,
    );
    const res = await tx.execute(
      sql`SELECT ${cols} FROM ${TABLE[subject]} WHERE org_id = ${orgId} AND id = ${recordId}`,
    );
    const row = res.rows[0] as Raw | undefined;
    return wheres.map((_, i) => row?.[`r${i}`] === true);
  }

  /**
   * Writes the owner. `expect` says what the row must still look like: a record nobody ever gave an owner (a first assignment), or
   * one still with the engine's last pick (a reassignment). Returns the new `owner_changed_at`, or null when the row moved under us.
   */
  async setOwner(
    tx: Tx,
    orgId: number,
    subject: AssignmentSubject,
    id: number,
    ownerId: number,
    expect: { kind: 'unowned' } | { kind: 'engine'; ownerId: number; stamp: Date | null },
  ): Promise<Date | null> {
    const col = OWNER_COL[subject];
    const guard =
      expect.kind === 'unowned'
        ? sql`${col} IS NULL AND owner_changed_at IS NULL`
        : // A timestamp read into JavaScript has lost its microseconds, so the stamp is compared within a few milliseconds.
          expect.stamp === null
          ? sql`${col} = ${expect.ownerId} AND owner_changed_at IS NULL`
          : sql`${col} = ${expect.ownerId} AND owner_changed_at IS NOT NULL
              AND abs(extract(epoch FROM owner_changed_at) - extract(epoch FROM ${expect.stamp.toISOString()}::timestamptz)) < 0.005`;
    const res = await tx.execute(sql`
      UPDATE ${TABLE[subject]} SET ${col} = ${ownerId}
      WHERE org_id = ${orgId} AND id = ${id} AND ${guard} RETURNING owner_changed_at`);
    const r = res.rows[0] as Raw | undefined;
    if (!r) return null;
    return r.owner_changed_at ? new Date(r.owner_changed_at as string | Date) : new Date();
  }

  // --- the run log -----------------------------------------------------------------------------------------------------------------

  async insertRun(
    tx: Tx,
    orgId: number,
    v: {
      subject: AssignmentSubject;
      recordId: number;
      ruleId: number | null;
      ruleName: string | null;
      outcome: RunRow['outcome'];
      reason: string;
      ownerId: number | null;
      method: string | null;
      origin: string;
      trigger: 'created' | 'updated';
      trace: AssignmentTraceEntry[];
      ownerStamp: Date | null;
    },
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO assignment_runs (org_id, subject, record_id, rule_id, rule_name, outcome, reason, owner_id, method, origin, trigger, trace, owner_stamp)
      VALUES (${orgId}, ${v.subject}, ${v.recordId}, ${v.ruleId}, ${v.ruleName}, ${v.outcome}, ${v.reason}, ${v.ownerId}, ${v.method},
              ${v.origin}, ${v.trigger}, ${JSON.stringify(v.trace)}::jsonb, ${v.ownerStamp})`);
  }

  /** The engine's latest successful pick for a record (an assignment or a reassignment). */
  async lastPick(
    tx: Tx,
    orgId: number,
    subject: AssignmentSubject,
    recordId: number,
  ): Promise<RunRow | null> {
    const res = await tx.execute(sql`
      SELECT r.*, NULL::uuid AS owner_uuid, NULL::text AS owner_name FROM assignment_runs r
      WHERE r.org_id = ${orgId} AND r.subject = ${subject} AND r.record_id = ${recordId} AND r.outcome IN ('assigned', 'reassigned')
      ORDER BY r.id DESC LIMIT 1`);
    return res.rows[0] ? toRun(res.rows[0] as Raw) : null;
  }

  async runs(
    tx: Tx,
    orgId: number,
    q: {
      subject?: AssignmentSubject;
      ruleId?: number;
      recordId?: number;
      outcome?: string;
      beforeId?: number;
      limit: number;
    },
  ): Promise<RunRow[]> {
    const res = await tx.execute(sql`
      SELECT r.*, u.uuid AS owner_uuid, u.full_name AS owner_name
      FROM assignment_runs r LEFT JOIN users u ON u.org_id = r.org_id AND u.id = r.owner_id
      WHERE r.org_id = ${orgId}
        ${q.subject ? sql`AND r.subject = ${q.subject}` : sql``}
        ${q.ruleId !== undefined ? sql`AND r.rule_id = ${q.ruleId}` : sql``}
        ${q.recordId !== undefined ? sql`AND r.record_id = ${q.recordId}` : sql``}
        ${q.outcome ? sql`AND r.outcome = ${q.outcome}` : sql``}
        ${q.beforeId !== undefined ? sql`AND r.id < ${q.beforeId}` : sql``}
      ORDER BY r.id DESC LIMIT ${q.limit}`);
    return (res.rows as Raw[]).map(toRun);
  }

  /** uuid and label of records by internal id, for the log (an id missing from the answer has been deleted). */
  async labels(
    tx: Tx,
    orgId: number,
    subject: AssignmentSubject,
    ids: readonly number[],
  ): Promise<Map<number, { uuid: string; label: string }>> {
    if (ids.length === 0) return new Map();
    const res = await tx.execute(sql`
      SELECT id, uuid, ${LABEL[subject]} AS label FROM ${TABLE[subject]} WHERE org_id = ${orgId}
        AND id IN (${sql.join(
          ids.map((i) => sql`${i}`),
          sql`, `,
        )})`);
    return new Map(
      (res.rows as Raw[]).map((r) => [
        Number(r.id),
        { uuid: String(r.uuid), label: String(r.label ?? '') },
      ]),
    );
  }

  /** The internal id of a record by uuid (for filtering the log by record). */
  async recordIdByUuid(
    tx: Tx,
    orgId: number,
    subject: AssignmentSubject,
    uuid: string,
  ): Promise<number | null> {
    const res = await tx.execute(
      sql`SELECT id FROM ${TABLE[subject]} WHERE org_id = ${orgId} AND uuid = ${uuid}`,
    );
    return res.rows[0] ? Number((res.rows[0] as Raw).id) : null;
  }

  /** Deletes runs older than the retention, in every workspace (privileged caller). Returns how many. */
  async pruneRuns(tx: Tx, days: number): Promise<number> {
    const res = await tx.execute(sql`
      DELETE FROM assignment_runs WHERE (org_id, id) IN (
        SELECT org_id, id FROM assignment_runs WHERE created_at < now() - make_interval(days => ${days})
        ORDER BY id LIMIT 5000 FOR UPDATE SKIP LOCKED) RETURNING 1`);
    return res.rows.length;
  }

  async audit(
    tx: Tx,
    e: {
      orgId: number;
      module: string;
      recordId: number;
      action: string;
      delta: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta)
      VALUES (${e.orgId}, NULL, 'system', ${e.module}, ${e.recordId}, ${e.action}, ${JSON.stringify(e.delta)}::jsonb)`);
  }
}
