import { Injectable } from '@nestjs/common';
import { leadSourceDefaultsSchema } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { runInOrg } from './lead-context';
import type { ConnectorSourceInput, LeadSourceDirectoryPort } from './lead-source-directory.port';
import { LeadsPlan } from './lead-plan';
import { LeadSourcesRepository } from './lead-sources.repository';
import { isUniqueViolation } from './lead-sources.service';

const MODULE_KEY = 'lead_sources';

/**
 * The connectors' side of the lead sources (`lead-source-directory.port.ts`): an installed connector asks for its source by a reference of
 * its own and gets the same one every time. It counts toward the plan's `lead_sources` cap like a webhook does, is audited and announced
 * on the outbox like one, and has no URL token: leads reach it through the ingest port, never through the public door.
 */
@Injectable()
export class LeadSourceDirectoryService implements LeadSourceDirectoryPort {
  constructor(
    private readonly db: DatabaseService,
    private readonly sources: LeadSourcesRepository,
    private readonly plan: LeadsPlan,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async ensureConnectorSource(
    orgId: number,
    input: ConnectorSourceInput,
  ): Promise<{ sourceId: number; sourceUuid: string }> {
    return runInOrg(orgId, async () => {
      try {
        return await this.once(orgId, input);
      } catch (err) {
        // Two installs racing for the same reference (or the same name): the failed insert aborted its transaction, the winner's row is
        // there now, so a second pass finds it (or picks the next free name).
        if (!isUniqueViolation(err)) throw err;
        return this.once(orgId, input);
      }
    });
  }

  private once(
    orgId: number,
    input: ConnectorSourceInput,
  ): Promise<{ sourceId: number; sourceUuid: string }> {
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const existing = await this.sources.findByExternalRef(tx, orgId, input.externalRef);
      if (existing) return { sourceId: existing.id, sourceUuid: existing.uuid };

      await this.plan.assertCanAddSource(orgId, await this.sources.count(tx, orgId));
      // Two installations of one portal in a workspace get distinct names ("IndiaMART", "IndiaMART (2)").
      let name = input.name.slice(0, 120);
      for (let n = 2; await this.sources.nameTaken(tx, orgId, name); n++) {
        name = `${input.name.slice(0, 110)} (${n})`;
      }
      const id = await this.sources.insert(tx, orgId, {
        kind: input.kind ?? 'connector',
        providerKey: input.providerKey,
        externalRef: input.externalRef,
        name,
        tokenHash: null,
        tokenHint: null,
        secretEnc: null,
        externalIdPath: null,
        mapping: {},
        defaults: leadSourceDefaultsSchema.parse({ platform: input.providerKey }),
        rawRetentionDays: 30,
        createdBy: null,
      });
      const row = (await this.sources.findById(tx, orgId, id))!;
      await this.audit.record(tx, { module: MODULE_KEY, recordId: id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: id,
        eventType: 'lead_source.created',
        orgId,
        payload: { uuid: row.uuid, name: row.name, kind: row.kind, providerKey: input.providerKey },
      });
      return { sourceId: id, sourceUuid: row.uuid };
    });
  }

  async releaseConnectorSource(orgId: number, externalRef: string): Promise<void> {
    await runInOrg(orgId, () =>
      this.db.txAs({ orgId, userId: null }, async (tx) => {
        const row = await this.sources.findByExternalRef(tx, orgId, externalRef);
        if (!row) return;
        await this.sources.delete(tx, orgId, row.id);
        await this.audit.record(tx, { module: MODULE_KEY, recordId: row.id, action: 'delete' });
        await this.outbox.emit(tx, {
          aggregateModule: MODULE_KEY,
          aggregateId: row.id,
          eventType: 'lead_source.deleted',
          orgId,
          payload: { uuid: row.uuid, name: row.name, kind: row.kind },
        });
      }),
    );
  }
}
