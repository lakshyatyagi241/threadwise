import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { AssignmentConditions, AssignmentSubject } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { onLeaveOnSql } from '../../../common/workspace-calendar';
import type { AssignmentFacts } from './assignment-matcher';

type Raw = Record<string, unknown>;

export interface RuleRow {
  id: number;
  uuid: string;
  name: string;
  subject: AssignmentSubject;
  conditions: AssignmentConditions;
  strategy: 'fixed' | 'round_robin' | 'least_busy';
  userIds: string[];
  teamIds: string[];
  skipOffline: boolean;
  rrCursor: number | null;
  sort: number;
  isActive: boolean;
  firedCount: number;
  lastFiredAt: Date | null;
  rowVersion: number;
}

export interface RecordFacts {
  id: number;
  uuid: string;
  ownerId: number | null;
  ownerChangedAt: Date | null;
  facts: AssignmentFacts;
}

export interface Candidate {
  id: number;
  uuid: string;
  name: string;
  /** Records of this subject they hold now (contacts owned, or open deals owned): the least-busy measure. */
  load: number;
}

const toRule = (r: Raw): RuleRow => ({
  id: Number(r.id),
  uuid: String(r.uuid),
  name: String(r.name),
  subject: r.subject as AssignmentSubject,
  conditions: r.conditions as AssignmentConditions,
  strategy: r.strategy as RuleRow['strategy'],
  userIds: (r.user_ids as string[]) ?? [],
  teamIds: (r.team_ids as string[]) ?? [],
  skipOffline: r.skip_offline === true,
  rrCursor: r.rr_cursor === null || r.rr_cursor === undefined ? null : Number(r.rr_cursor),
  sort: Number(r.sort),
  isActive: r.is_active === true,
  firedCount: Number(r.fired_count),
  lastFiredAt: r.last_fired_at ? new Date(r.last_fired_at as string | Date) : null,
  rowVersion: Number(r.row_version),
});

const RULE_COLS = sql`id, uuid, name, subject, conditions, strategy, user_ids, team_ids, skip_offline, rr_cursor, sort, is_active, fired_count, last_fired_at, row_version`;

const scalars = (data: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
        out[k] = String(v);
    }
  }
  return out;
};

/** Data access for the assignment rules, the settings and the records the engine looks at. */
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

  async rules(
    tx: Tx,
    orgId: number,
    subject?: AssignmentSubject,
    activeOnly = false,
  ): Promise<RuleRow[]> {
    const res = await tx.execute(sql`
      SELECT ${RULE_COLS} FROM assignment_rules
      WHERE org_id = ${orgId} ${subject ? sql`AND subject = ${subject}` : sql``} ${activeOnly ? sql`AND is_active` : sql``}
      ORDER BY subject, sort, id`);
    return (res.rows as Raw[]).map(toRule);
  }

  async ruleByUuid(tx: Tx, orgId: number, uuid: string, lock = false): Promise<RuleRow | null> {
    const res = await tx.execute(
      lock
        ? sql`SELECT ${RULE_COLS} FROM assignment_rules WHERE org_id = ${orgId} AND uuid = ${uuid} FOR UPDATE`
        : sql`SELECT ${RULE_COLS} FROM assignment_rules WHERE org_id = ${orgId} AND uuid = ${uuid}`,
    );
    return res.rows[0] ? toRule(res.rows[0] as Raw) : null;
  }

  async ruleById(tx: Tx, orgId: number, id: number, lock = false): Promise<RuleRow | null> {
    const res = await tx.execute(
      lock
        ? sql`SELECT ${RULE_COLS} FROM assignment_rules WHERE org_id = ${orgId} AND id = ${id} FOR UPDATE`
        : sql`SELECT ${RULE_COLS} FROM assignment_rules WHERE org_id = ${orgId} AND id = ${id}`,
    );
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
      subject: string;
      conditions: unknown;
      strategy: string;
      userIds: string[];
      teamIds: string[];
      skipOffline: boolean;
      isActive: boolean;
      sort: number;
      createdBy: number | null;
    },
  ): Promise<string> {
    const res = await tx.execute(sql`
      INSERT INTO assignment_rules (org_id, name, subject, conditions, strategy, user_ids, team_ids, skip_offline, is_active, sort, created_by)
      VALUES (${orgId}, ${v.name}, ${v.subject}, ${JSON.stringify(v.conditions)}::jsonb, ${v.strategy},
              ${JSON.stringify(v.userIds)}::jsonb, ${JSON.stringify(v.teamIds)}::jsonb, ${v.skipOffline}, ${v.isActive}, ${v.sort}, ${v.createdBy})
      RETURNING uuid`);
    return String((res.rows[0] as Raw).uuid);
  }

  async updateRule(
    tx: Tx,
    orgId: number,
    id: number,
    rowVersion: number,
    v: Omit<
      RuleRow,
      'id' | 'uuid' | 'subject' | 'rrCursor' | 'sort' | 'firedCount' | 'lastFiredAt' | 'rowVersion'
    >,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE assignment_rules SET name = ${v.name}, conditions = ${JSON.stringify(v.conditions)}::jsonb, strategy = ${v.strategy},
             user_ids = ${JSON.stringify(v.userIds)}::jsonb, team_ids = ${JSON.stringify(v.teamIds)}::jsonb,
             skip_offline = ${v.skipOffline}, is_active = ${v.isActive},
             -- a changed pool starts a fresh rotation
             rr_cursor = NULL
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${rowVersion} RETURNING id`);
    return res.rows.length > 0;
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

  async contactFacts(
    tx: Tx,
    orgId: number,
    uuid: string,
    origin: string,
    lock: boolean,
  ): Promise<RecordFacts | null> {
    const res = await tx.execute(sql`
      SELECT c.id, c.uuid, c.owner_id, c.owner_changed_at, c.source, c.country_code,
             regexp_replace(coalesce(c.normalized_phone, c.phone, ''), '[^0-9]', '', 'g') AS phone_digits,
             c.lifecycle_stage, c.data,
             coalesce((SELECT array_agg(t.uuid::text) FROM contact_tags ct
                        JOIN tags t ON t.org_id = ct.org_id AND t.id = ct.tag_id
                        WHERE ct.org_id = c.org_id AND ct.contact_id = c.id), '{}') AS tag_uuids
      FROM contacts c WHERE c.org_id = ${orgId} AND c.uuid = ${uuid}
      ${lock ? sql`FOR UPDATE OF c` : sql``}`);
    const r = res.rows[0] as Raw | undefined;
    if (!r) return null;
    return {
      id: Number(r.id),
      uuid: String(r.uuid),
      ownerId: r.owner_id === null ? null : Number(r.owner_id),
      ownerChangedAt: r.owner_changed_at ? new Date(r.owner_changed_at as string | Date) : null,
      facts: {
        source: (r.source as string | null) ?? null,
        countryCode: (r.country_code as string | null) ?? null,
        phoneDigits: (r.phone_digits as string) || null,
        lifecycleStage: (r.lifecycle_stage as string | null) ?? null,
        tagIds: (r.tag_uuids as string[]) ?? [],
        origin,
        properties: scalars(r.data),
        pipelineId: null,
        value: null,
      },
    };
  }

  async dealFacts(
    tx: Tx,
    orgId: number,
    uuid: string,
    origin: string,
    lock: boolean,
  ): Promise<RecordFacts | null> {
    const res = await tx.execute(sql`
      SELECT d.id, d.uuid, d.owner_user_id, d.owner_changed_at, d.source, (d.value_minor / 100.0)::text AS value, p.uuid AS pipeline_uuid
      FROM deals d JOIN pipelines p ON p.org_id = d.org_id AND p.id = d.pipeline_id
      WHERE d.org_id = ${orgId} AND d.uuid = ${uuid}
      ${lock ? sql`FOR UPDATE OF d` : sql``}`);
    const r = res.rows[0] as Raw | undefined;
    if (!r) return null;
    return {
      id: Number(r.id),
      uuid: String(r.uuid),
      ownerId: r.owner_user_id === null ? null : Number(r.owner_user_id),
      ownerChangedAt: r.owner_changed_at ? new Date(r.owner_changed_at as string | Date) : null,
      facts: {
        source: (r.source as string | null) ?? null,
        countryCode: null,
        phoneDigits: null,
        lifecycleStage: null,
        tagIds: [],
        origin,
        properties: {},
        pipelineId: String(r.pipeline_uuid),
        value: r.value === null ? null : Number(r.value),
      },
    };
  }

  /** Writes the owner only where nobody ever set one. False when the row moved under us. */
  async setOwner(
    tx: Tx,
    orgId: number,
    subject: AssignmentSubject,
    id: number,
    ownerId: number,
  ): Promise<boolean> {
    const res =
      subject === 'contact'
        ? await tx.execute(sql`
            UPDATE contacts SET owner_id = ${ownerId}
            WHERE org_id = ${orgId} AND id = ${id} AND owner_id IS NULL AND owner_changed_at IS NULL RETURNING id`)
        : await tx.execute(sql`
            UPDATE deals SET owner_user_id = ${ownerId}
            WHERE org_id = ${orgId} AND id = ${id} AND owner_user_id IS NULL AND owner_changed_at IS NULL RETURNING id`);
    return res.rows.length > 0;
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
