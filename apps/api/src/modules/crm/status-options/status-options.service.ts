import { Injectable } from '@nestjs/common';
import type {
  CreateStatusOptionInput,
  ListStatusOptionsQuery,
  ModuleKey,
  PageResponse,
  ReorderStatusOptionsInput,
  StatusOptionResponse,
  UpdateStatusOptionInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { toStatusOptionResponse } from './status-options.mapper';
import { StatusOptionsRepository } from './status-options.repository';

const MODULE_KEY = 'status_options';

/** Lifecycle stages, deal statuses, subscription statuses — org-extensible enum groups. */
@Injectable()
export class StatusOptionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: StatusOptionsRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListStatusOptionsQuery): Promise<PageResponse<StatusOptionResponse>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, ctx.orgId, query.moduleKey, query.optionGroup);
      return {
        data: rows.map(toStatusOptionResponse),
        page: { nextCursor: null, hasMore: false, limit: query.limit },
      };
    });
  }

  async create(input: CreateStatusOptionInput): Promise<StatusOptionResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const position =
        input.position ??
        (await this.repo.nextPosition(tx, ctx.orgId, input.moduleKey, input.optionGroup));

      if (input.isDefault) {
        await this.repo.clearDefault(tx, ctx.orgId, input.moduleKey, input.optionGroup);
      }

      const created = await this.repo.insert(tx, ctx.orgId, {
        moduleKey: input.moduleKey,
        optionGroup: input.optionGroup,
        value: input.value,
        label: input.label,
        color: input.color,
        position,
        isDefault: input.isDefault,
      });

      await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'status_option.created',
        payload: {
          uuid: created.uuid,
          moduleKey: input.moduleKey,
          optionGroup: input.optionGroup,
          value: input.value,
        },
      });

      const row = await this.repo.findById(tx, ctx.orgId, created.id);
      return toStatusOptionResponse(row!);
    });
  }

  async update(uuid: string, input: UpdateStatusOptionInput): Promise<StatusOptionResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('StatusOption', uuid);

      if (input.isDefault) {
        await this.repo.clearDefault(
          tx,
          ctx.orgId,
          existing.moduleKey as ModuleKey,
          existing.optionGroup,
        );
      }

      const values: Record<string, unknown> = {};
      if (input.label !== undefined) values.label = input.label;
      if (input.color !== undefined) values.color = input.color;
      if (input.isDefault !== undefined) values.isDefault = input.isDefault;
      if (input.isActive !== undefined) values.isActive = input.isActive;

      const updated = await this.repo.updateWithVersion(
        tx,
        ctx.orgId,
        existing.id,
        input.rowVersion,
        values,
      );
      if (!updated) throw AppError.rowVersionConflict('StatusOption');

      const row = await this.repo.findById(tx, ctx.orgId, existing.id);

      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: existing.id,
        action: 'update',
        delta: this.audit.diff(
          existing as unknown as Record<string, unknown>,
          row as unknown as Record<string, unknown>,
        ),
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'status_option.updated',
        payload: { uuid },
      });

      return toStatusOptionResponse(row!);
    });
  }

  async reorder(input: ReorderStatusOptionsInput): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const ids: number[] = [];
      for (const uuid of input.orderedIds) {
        const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
        if (!row) throw AppError.notFound('StatusOption', uuid);
        ids.push(row.id);
      }
      await this.repo.reorder(tx, ctx.orgId, ids);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('StatusOption', uuid);

      await this.audit.record(tx, { module: MODULE_KEY, recordId: existing.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'status_option.deleted',
        payload: { uuid },
      });

      await this.repo.deleteById(tx, ctx.orgId, existing.id);
    });
  }
}
