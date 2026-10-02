import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  AI_PROVIDER_SLUGS,
  type AiProviderSlug,
  type WorkspaceAiKeyItem,
  type WorkspaceAiKeysResponse,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { AiKeyResolver } from './ai-key-resolver.service';
import { KeyVault } from './key-vault';

const MODULE_KEY = 'ai_provider_keys';

interface KeyRow {
  id: number;
  uuid: string;
  provider: string;
  api_key: string;
  key_last4: string | null;
  is_active: boolean;
  row_version: number;
  updated_at: string;
}
const COLUMNS = sql.raw(
  'id, uuid, provider, api_key, key_last4, is_active, row_version, updated_at',
);

const toItem = (r: KeyRow): WorkspaceAiKeyItem => ({
  id: r.uuid,
  provider: r.provider as AiProviderSlug,
  isActive: r.is_active,
  keyLast4: r.key_last4,
  rowVersion: r.row_version,
  updatedAt: new Date(r.updated_at).toISOString(),
});

/**
 * A workspace's own provider keys, "bring your own key" (TW-AIADM-011..014). One key per vendor per workspace.
 *
 * Saving is not plan-gated, as in the Team Inbox path of Reference: the gate is applied when a call picks its key
 * (AiKeyResolver), so a workspace can store its key before it upgrades and the screen says whether it will be used.
 * The secret is write-only; every change leaves an audit row and an outbox event in the same transaction (Reference
 * wrote neither).
 */
@Injectable()
export class WorkspaceKeysService {
  constructor(
    private readonly db: DatabaseService,
    private readonly vault: KeyVault,
    private readonly resolver: AiKeyResolver,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async list(): Promise<WorkspaceAiKeysResponse> {
    const ctx = RequestContextStore.require();
    const rows = await this.db.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT ${COLUMNS} FROM ai_provider_keys WHERE org_id = ${ctx.orgId} ORDER BY provider`,
      );
      return res.rows as unknown as KeyRow[];
    });
    const { byokAllowed, sources } = await this.resolver.sourcesFor(ctx.orgId);
    return {
      data: rows.map(toItem),
      byokAllowed,
      sources: AI_PROVIDER_SLUGS.filter((p) => sources.has(p)).map((provider) => ({
        provider,
        source: sources.get(provider)!,
      })),
    };
  }

  /** Adds or replaces the key for a vendor, and switches it on (Reference's updateOrCreate with is_active = true). */
  async save(provider: AiProviderSlug, apiKey: string): Promise<WorkspaceAiKeyItem> {
    const ctx = RequestContextStore.require();
    const sealed = this.vault.seal(apiKey);
    return this.db.tx(async (tx) => {
      const before = await this.byProvider(tx, ctx.orgId, provider);
      const res = await tx.execute(sql`
        INSERT INTO ai_provider_keys (org_id, provider, api_key, key_last4, is_active)
        VALUES (${ctx.orgId}, ${provider}, ${sealed.cipher}, ${sealed.last4}, true)
        ON CONFLICT (org_id, provider) DO UPDATE
          SET api_key = EXCLUDED.api_key, key_last4 = EXCLUDED.key_last4, is_active = true
        RETURNING ${COLUMNS}
      `);
      const row = res.rows[0] as unknown as KeyRow;
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: row.id,
        action: before ? 'update' : 'insert',
        delta: {
          key: {
            old: before ? `••••${before.key_last4 ?? ''}` : null,
            new: `••••${row.key_last4 ?? ''}`,
          },
          ...(before && !before.is_active ? { isActive: { old: false, new: true } } : {}),
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: row.id,
        eventType: 'ai_provider_key.saved',
        payload: { uuid: row.uuid, provider, replaced: before !== undefined },
      });
      return toItem(row);
    });
  }

  /** Switches a saved key on or off (TW-AIADM-013). Idempotent: the requested state, not a flip. */
  async setActive(uuid: string, isActive: boolean): Promise<WorkspaceAiKeyItem> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lock(tx, ctx.orgId, uuid);
      if (row.is_active === isActive) return toItem(row);
      const res = await tx.execute(sql`
        UPDATE ai_provider_keys SET is_active = ${isActive}
        WHERE org_id = ${ctx.orgId} AND id = ${row.id} RETURNING ${COLUMNS}
      `);
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: row.id,
        action: 'update',
        delta: { isActive: { old: row.is_active, new: isActive } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: row.id,
        eventType: isActive ? 'ai_provider_key.activated' : 'ai_provider_key.deactivated',
        payload: { uuid, provider: row.provider },
      });
      return toItem(res.rows[0] as unknown as KeyRow);
    });
  }

  /** Removes a saved key; calls fall back to the platform's key (TW-AIADM-014). */
  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.lock(tx, ctx.orgId, uuid);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: row.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: row.id,
        eventType: 'ai_provider_key.deleted',
        payload: { uuid, provider: row.provider },
      });
      await tx.execute(
        sql`DELETE FROM ai_provider_keys WHERE org_id = ${ctx.orgId} AND id = ${row.id}`,
      );
    });
  }

  private async byProvider(tx: Tx, orgId: number, provider: string): Promise<KeyRow | undefined> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM ai_provider_keys WHERE org_id = ${orgId} AND provider = ${provider} FOR UPDATE
    `);
    return res.rows[0] as unknown as KeyRow | undefined;
  }

  private async lock(tx: Tx, orgId: number, uuid: string): Promise<KeyRow> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM ai_provider_keys WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid FOR UPDATE
    `);
    const row = res.rows[0] as unknown as KeyRow | undefined;
    if (!row) throw AppError.notFound('AI provider key', uuid);
    return row;
  }
}
