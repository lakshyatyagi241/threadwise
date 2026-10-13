import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type {
  LeadFieldMapping,
  LeadSourceDefaults,
  LeadSourceKind,
  LeadSourceStatus,
} from '@crm/contracts';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const d = (v: unknown): Date | null => (v ? new Date(v as string) : null);

export interface LeadSourceRow {
  id: number;
  uuid: string;
  kind: LeadSourceKind;
  providerKey: string | null;
  externalRef: string | null;
  name: string;
  status: LeadSourceStatus;
  tokenHash: string | null;
  tokenHint: string | null;
  tokenRotatedAt: Date | null;
  /** AES-GCM ciphertext; the service decrypts it only to compare, never to return. */
  secretEnc: string | null;
  externalIdPath: string | null;
  mapping: LeadFieldMapping;
  /** Stored as written: the service fills what an older row lacks through the defaults schema. */
  defaults: Partial<LeadSourceDefaults>;
  rawRetentionDays: number;
  rrCursor: number;
  lastEventAt: Date | null;
  createdBy: number | null;
  needsAttention: number;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const toRow = (r: Raw): LeadSourceRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  kind: r.kind as LeadSourceKind,
  providerKey: s(r.provider_key),
  externalRef: s(r.external_ref),
  name: r.name as string,
  status: r.status as LeadSourceStatus,
  tokenHash: s(r.token_hash),
  tokenHint: s(r.token_hint),
  tokenRotatedAt: d(r.token_rotated_at),
  secretEnc: s(r.secret_enc),
  externalIdPath: s(r.external_id_path),
  mapping: (r.field_mapping ?? {}) as LeadFieldMapping,
  defaults: (r.defaults ?? {}) as Partial<LeadSourceDefaults>,
  rawRetentionDays: Number(r.raw_retention_days),
  rrCursor: Number(r.rr_cursor),
  lastEventAt: d(r.last_event_at),
  createdBy: r.created_by === null || r.created_by === undefined ? null : Number(r.created_by),
  needsAttention: Number(r.needs_attention ?? 0),
  rowVersion: Number(r.row_version),
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
});

/** Needs-attention is counted per source in the same statement as the rows: two statuses of an indexed pair, never a table scan. */
const SELECT = sql`
  SELECT s.*,
    (SELECT count(*)::int FROM lead_events e
      WHERE e.org_id = s.org_id AND e.source_id = s.id AND e.status IN ('needs_review', 'failed') AND NOT e.is_test) AS needs_attention
  FROM lead_sources s`;

export interface NewLeadSource {
  kind: LeadSourceKind;
  providerKey: string | null;
  externalRef: string | null;
  name: string;
  tokenHash: string | null;
  tokenHint: string | null;
  secretEnc: string | null;
  externalIdPath: string | null;
  mapping: LeadFieldMapping;
  defaults: unknown;
  rawRetentionDays: number;
  createdBy: number | null;
}

export interface LeadSourcePatch {
  name?: string;
  status?: LeadSourceStatus;
  providerKey?: string | null;
  secretEnc?: string | null;
  externalIdPath?: string | null;
  mapping?: LeadFieldMapping;
  defaults?: unknown;
  rawRetentionDays?: number;
}

/** Data access for lead sources. Every method runs inside the caller's tenant transaction. */
@Injectable()
export class LeadSourcesRepository {
  async list(tx: Tx, orgId: number): Promise<LeadSourceRow[]> {
    const res = await tx.execute(
      sql`${SELECT} WHERE s.org_id = ${orgId} ORDER BY s.created_at DESC, s.id DESC`,
    );
    return (res.rows as Raw[]).map(toRow);
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<LeadSourceRow | undefined> {
    const res = await tx.execute(
      sql`${SELECT} WHERE s.org_id = ${orgId} AND s.uuid = ${uuid}::uuid`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<LeadSourceRow | undefined> {
    const res = await tx.execute(sql`${SELECT} WHERE s.org_id = ${orgId} AND s.id = ${id}`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findByExternalRef(
    tx: Tx,
    orgId: number,
    externalRef: string,
  ): Promise<LeadSourceRow | undefined> {
    const res = await tx.execute(
      sql`${SELECT} WHERE s.org_id = ${orgId} AND s.external_ref = ${externalRef} LIMIT 1`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async count(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*)::int AS n FROM lead_sources WHERE org_id = ${orgId}`,
    );
    return Number((res.rows[0] as { n: number }).n);
  }

  async nameTaken(tx: Tx, orgId: number, name: string, exceptId?: number): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM lead_sources
      WHERE org_id = ${orgId} AND lower(name) = lower(${name})
        ${exceptId === undefined ? sql`` : sql`AND id <> ${exceptId}`}
      LIMIT 1`);
    return res.rows.length > 0;
  }

  async insert(tx: Tx, orgId: number, v: NewLeadSource): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO lead_sources
        (org_id, kind, provider_key, external_ref, name, token_hash, token_hint, token_rotated_at, secret_enc, external_id_path,
         field_mapping, defaults, raw_retention_days, created_by)
      VALUES
        (${orgId}, ${v.kind}, ${v.providerKey}, ${v.externalRef}, ${v.name}, ${v.tokenHash}, ${v.tokenHint},
         ${v.tokenHash ? sql`now()` : sql`NULL`}, ${v.secretEnc}, ${v.externalIdPath},
         ${JSON.stringify(v.mapping)}::jsonb, ${JSON.stringify(v.defaults)}::jsonb, ${v.rawRetentionDays}, ${v.createdBy})
      RETURNING id`);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  /** Optimistic update: false when the row moved since the editor read it (the caller answers 409). */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number,
    patch: LeadSourcePatch,
  ): Promise<boolean> {
    const sets: SQL[] = [];
    if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
    if (patch.status !== undefined) sets.push(sql`status = ${patch.status}`);
    if (patch.providerKey !== undefined) sets.push(sql`provider_key = ${patch.providerKey}`);
    if (patch.secretEnc !== undefined) sets.push(sql`secret_enc = ${patch.secretEnc}`);
    if (patch.externalIdPath !== undefined)
      sets.push(sql`external_id_path = ${patch.externalIdPath}`);
    if (patch.mapping !== undefined)
      sets.push(sql`field_mapping = ${JSON.stringify(patch.mapping)}::jsonb`);
    if (patch.defaults !== undefined)
      sets.push(sql`defaults = ${JSON.stringify(patch.defaults)}::jsonb`);
    if (patch.rawRetentionDays !== undefined)
      sets.push(sql`raw_retention_days = ${patch.rawRetentionDays}`);
    if (sets.length === 0) return true;
    const res = await tx.execute(sql`
      UPDATE lead_sources SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${expectedVersion}
      RETURNING id`);
    return res.rows.length > 0;
  }

  /** A new token replaces the old one at once: the old URL answers 404 from the next request. No version check: rotating is not an edit. */
  async rotateToken(tx: Tx, orgId: number, id: number, hash: string, hint: string): Promise<void> {
    await tx.execute(sql`
      UPDATE lead_sources SET token_hash = ${hash}, token_hint = ${hint}, token_rotated_at = now()
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async delete(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const res = await tx.execute(
      sql`DELETE FROM lead_sources WHERE org_id = ${orgId} AND id = ${id} RETURNING id`,
    );
    return res.rows.length > 0;
  }

  /**
   * Takes the next position of a round robin: the row lock serialises two leads arriving together, so each gets its own turn.
   * Also stamps the last event. Bookkeeping only: the touch trigger leaves `row_version` alone.
   */
  async takeTurn(tx: Tx, orgId: number, id: number): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE lead_sources SET rr_cursor = rr_cursor + 1, last_event_at = now()
      WHERE org_id = ${orgId} AND id = ${id}
      RETURNING rr_cursor - 1 AS turn`);
    return Number((res.rows[0] as { turn: number | string } | undefined)?.turn ?? 0);
  }

  async stampLastEvent(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(
      sql`UPDATE lead_sources SET last_event_at = now() WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  // --- reference reads: what a source's settings may point at -----------------------------------------------------------------

  /** The listed users that are active members, in the order given (a round robin is a rotation over the admin's list). */
  async activeUsers(
    tx: Tx,
    orgId: number,
    uuids: string[],
  ): Promise<Array<{ id: number; uuid: string }>> {
    if (uuids.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT id, uuid FROM users
      WHERE org_id = ${orgId} AND status = 'active'
        AND uuid IN (${sql.join(
          uuids.map((u) => sql`${u}::uuid`),
          sql`, `,
        )})`);
    const byUuid = new Map(
      (res.rows as Array<{ id: number | string; uuid: string }>).map((r) => [
        r.uuid,
        { id: Number(r.id), uuid: r.uuid },
      ]),
    );
    return uuids.flatMap((u) => {
      const hit = byUuid.get(u);
      return hit ? [hit] : [];
    });
  }

  /** Active contact properties by key with their type: the ones a mapping may fill. */
  async contactFieldTypes(tx: Tx, orgId: number, keys: string[]): Promise<Map<string, string>> {
    if (keys.length === 0) return new Map();
    const res = await tx.execute(sql`
      SELECT key, field_type FROM fields
      WHERE org_id = ${orgId} AND module_key = 'contacts' AND is_active
        AND key IN (${sql.join(
          keys.map((k) => sql`${k}`),
          sql`, `,
        )})`);
    return new Map(
      (res.rows as Array<{ key: string; field_type: string }>).map((r) => [r.key, r.field_type]),
    );
  }

  /** A stage that exists, is active and is not a lost stage (a lost stage demands a reason nobody is here to give). */
  async stageUsable(tx: Tx, orgId: number, stage: string): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM status_options
      WHERE org_id = ${orgId} AND module_key = 'contacts' AND option_group = 'lifecycle_stage' AND value = ${stage}
        AND is_active AND NOT is_lost LIMIT 1`);
    return res.rows.length > 0;
  }

  /** Whether the workspace has this flow (its uuid). Whether it is switched on is read when a lead arrives. */
  async flowExists(tx: Tx, orgId: number, uuid: string): Promise<boolean> {
    const res = await tx.execute(
      sql`SELECT 1 FROM flows WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    return res.rows.length > 0;
  }

  async pipelineExists(tx: Tx, orgId: number, uuid: string): Promise<number | undefined> {
    const res = await tx.execute(
      sql`SELECT id FROM pipelines WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as { id: number | string } | undefined;
    return r ? Number(r.id) : undefined;
  }

  async stageOfPipeline(
    tx: Tx,
    orgId: number,
    stageUuid: string,
  ): Promise<{ pipelineId: number } | undefined> {
    const res = await tx.execute(
      sql`SELECT pipeline_id FROM pipeline_stages WHERE org_id = ${orgId} AND uuid = ${stageUuid}::uuid`,
    );
    const r = res.rows[0] as { pipeline_id: number | string } | undefined;
    return r ? { pipelineId: Number(r.pipeline_id) } : undefined;
  }
}
