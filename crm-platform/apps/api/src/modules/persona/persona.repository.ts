import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';

/** What the resolver needs from a workspace's `workspace_persona` row, plus the persona's latest published version. */
export interface WorkspacePersonaRecord {
  personaKey: string;
  personaVersion: number;
  pinned: boolean;
  soloUi: string;
  showAllModules: boolean;
  workspaceOverrides: unknown;
  operatorOverrides: unknown;
  rev: number;
  /**
   * When the row was created, in ms. A row that is deleted and created again restarts `rev` at 1, so a cache key made of `rev` alone
   * could match an entry of the old row.
   */
  epoch: number;
  /** `personas.current_version`: null when the persona has no published version (or no longer exists). */
  currentVersion: number | null;
}

/** The columns a write needs from a locked workspace row. */
export interface LockedWorkspacePersona {
  rev: number;
  personaKey: string;
  workspaceOverrides: unknown;
}

export interface PersonaLogEntry {
  orgId: number;
  actorId: number | null;
  action: string;
  itemId: string;
  before: unknown;
  after: unknown;
}

interface RecordRow {
  persona_key: string;
  persona_version: number;
  pinned: boolean;
  solo_ui: string;
  show_all_modules: boolean;
  workspace_overrides: unknown;
  operator_overrides: unknown;
  rev: number;
  epoch: string | number;
  current_version: number | null;
}

/**
 * Reads of the persona tables (docs/specs/persona-profiles.md, section 4). Both run as the workspace itself, under its row-level
 * security: the workspace row is its own, and the catalog policies let a tenant read a persona and its published versions but never a
 * draft, so nothing here needs the privileged path.
 */
@Injectable()
export class PersonaRepository {
  constructor(private readonly db: DatabaseService) {}

  /** The workspace's row joined to its persona's latest published version, in one statement. `null` = the workspace has no row. */
  async workspaceRecord(orgId: number): Promise<WorkspacePersonaRecord | null> {
    return this.db.txAs({ orgId }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT wp.persona_key, wp.persona_version, wp.pinned, wp.solo_ui, wp.show_all_modules,
               wp.workspace_overrides, wp.operator_overrides, wp.rev,
               (extract(epoch FROM wp.created_at) * 1000)::bigint AS epoch, p.current_version
          FROM workspace_persona wp
          LEFT JOIN personas p ON p.key = wp.persona_key
         WHERE wp.org_id = ${orgId}
      `);
      const r = res.rows[0] as unknown as RecordRow | undefined;
      if (!r) return null;
      return {
        personaKey: r.persona_key,
        personaVersion: Number(r.persona_version),
        pinned: r.pinned,
        soloUi: r.solo_ui,
        showAllModules: r.show_all_modules,
        workspaceOverrides: r.workspace_overrides,
        operatorOverrides: r.operator_overrides,
        rev: Number(r.rev),
        epoch: Number(r.epoch),
        currentVersion: r.current_version === null ? null : Number(r.current_version),
      };
    });
  }

  /**
   * The definition document of one PUBLISHED (or superseded) version, or `null` if there is none. A published version never changes, so
   * callers may keep the answer.
   */
  async publishedDefinition(orgId: number, key: string, version: number): Promise<unknown | null> {
    return this.db.txAs({ orgId }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT v.definition
          FROM persona_versions v
          JOIN personas p ON p.id = v.persona_id
         WHERE p.key = ${key} AND v.version = ${version} AND v.status <> 'draft'
      `);
      const row = res.rows[0] as unknown as { definition: unknown } | undefined;
      return row ? row.definition : null;
    });
  }

  /**
   * The workspace's row, locked for the rest of the transaction (a write is coming). `null` = the workspace has no row. Runs inside the
   * caller's tenant transaction, so row-level security applies as for any request.
   */
  async lockWorkspaceRow(tx: Tx, orgId: number): Promise<LockedWorkspacePersona | null> {
    const res = await tx.execute(sql`
      SELECT rev, persona_key, workspace_overrides
        FROM workspace_persona
       WHERE org_id = ${orgId}
         FOR UPDATE
    `);
    const r = res.rows[0] as unknown as
      { rev: number; persona_key: string; workspace_overrides: unknown } | undefined;
    return r
      ? { rev: Number(r.rev), personaKey: r.persona_key, workspaceOverrides: r.workspace_overrides }
      : null;
  }

  /** Replaces the workspace's own override document. The row's trigger bumps `rev`; the operator columns are not touched. */
  async saveWorkspaceOverrides(tx: Tx, orgId: number, document: unknown): Promise<void> {
    await tx.execute(sql`
      UPDATE workspace_persona
         SET workspace_overrides = ${JSON.stringify(document)}::jsonb
       WHERE org_id = ${orgId}
    `);
  }

  /** One line of the append-only history, in the workspace layer. The policy binds `actor_id` to the acting user; the database stamps the time. */
  async appendLog(tx: Tx, entry: PersonaLogEntry): Promise<void> {
    await tx.execute(sql`
      INSERT INTO workspace_persona_log (org_id, layer, actor_kind, actor_id, action, item_id, before, after)
      VALUES (${entry.orgId}, 'workspace', 'user', ${entry.actorId}, ${entry.action}, ${entry.itemId},
              ${entry.before === null ? null : JSON.stringify(entry.before)}::jsonb,
              ${entry.after === null ? null : JSON.stringify(entry.after)}::jsonb)
    `);
  }
}
