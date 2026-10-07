import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { AiagResponder, SaveAiagResponderInput } from '@crm/contracts';
import { saveAiagResponderSchema } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';

const MODULE_KEY = 'workspace_settings';

/**
 * Who answers the workspace's WhatsApp: our AI, or Meta's own Business Agent (TW-AIAG-013). The two settings are columns of
 * `workspace_settings` (the workspaces domain owns the table; it has no service for these two, so they are read and written here).
 *
 * This only stores the choice. The stand-down of our AI and the keyword auto-reply when Meta's agent answers is enforced where those
 * replies are sent, and is not changed here.
 */
@Injectable()
export class ResponderService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async get(): Promise<AiagResponder> {
    const orgId = RequestContextStore.orgId();
    return this.db.tx((tx) => this.read(tx, orgId));
  }

  async save(input: SaveAiagResponderInput): Promise<AiagResponder> {
    const orgId = RequestContextStore.orgId();
    const next = saveAiagResponderSchema.parse(input);
    return this.db.tx(async (tx) => {
      const before = await this.read(tx, orgId);
      // A workspace that never saved its settings has no row yet; every other column has a default.
      const res = await tx.execute(sql`
        INSERT INTO workspace_settings (org_id, ai_responder_mode, meta_agent_enabled)
        VALUES (${orgId}, ${next.mode}, ${next.metaAgentEnabled})
        ON CONFLICT (org_id) DO UPDATE
          SET ai_responder_mode = EXCLUDED.ai_responder_mode, meta_agent_enabled = EXCLUDED.meta_agent_enabled
        RETURNING id`);
      const recordId = Number((res.rows[0] as { id: number | string }).id);
      const after: AiagResponder = { mode: next.mode, metaAgentEnabled: next.metaAgentEnabled };
      if (before.mode !== after.mode || before.metaAgentEnabled !== after.metaAgentEnabled) {
        await this.audit.record(tx, {
          module: MODULE_KEY,
          recordId,
          action: 'update',
          delta: {
            ...(before.mode !== after.mode
              ? { aiResponderMode: { old: before.mode, new: after.mode } }
              : {}),
            ...(before.metaAgentEnabled !== after.metaAgentEnabled
              ? { metaAgentEnabled: { old: before.metaAgentEnabled, new: after.metaAgentEnabled } }
              : {}),
          },
        });
        await this.outbox.emit(tx, {
          aggregateModule: MODULE_KEY,
          aggregateId: recordId,
          eventType: 'ai_responder.changed',
          payload: { mode: after.mode, metaAgentEnabled: after.metaAgentEnabled },
        });
      }
      return after;
    });
  }

  private async read(tx: Tx, orgId: number): Promise<AiagResponder> {
    const res = await tx.execute(
      sql`SELECT ai_responder_mode, meta_agent_enabled FROM workspace_settings WHERE org_id = ${orgId}`,
    );
    const r = res.rows[0] as { ai_responder_mode: string; meta_agent_enabled: boolean } | undefined;
    return {
      mode: (r?.ai_responder_mode ?? 'threadwise_only') as AiagResponder['mode'],
      metaAgentEnabled: r?.meta_agent_enabled ?? false,
    };
  }
}
