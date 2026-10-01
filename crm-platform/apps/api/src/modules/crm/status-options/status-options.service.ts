import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import type {
  CreateStatusOptionInput,
  DeleteStatusOptionQuery,
  ListStatusOptionsQuery,
  ModuleKey,
  PageResponse,
  ReorderStatusOptionsInput,
  StatusOptionResponse,
  StatusOptionUsageQuery,
  StatusOptionUsageResponse,
  UpdateStatusOptionInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { propertyPermissionKey, type PropertyAction } from '../field-metadata-permission';
import { contactColumnFor } from './status-option-columns';
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
    private readonly rbac: RbacService,
  ) {}

  /** See FieldSectionsService.requireModulePermission — same rationale. */
  private requireModulePermission(moduleKey: ModuleKey, action: PropertyAction) {
    const ctx = RequestContextStore.require();
    const key = propertyPermissionKey(moduleKey, action);
    if (!this.rbac.can(ctx.grants!, key).allowed) throw AppError.forbidden(key);
  }

  async list(query: ListStatusOptionsQuery): Promise<PageResponse<StatusOptionResponse>> {
    const ctx = RequestContextStore.require();
    this.requireModulePermission(query.moduleKey, 'read');
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
    this.requireModulePermission(input.moduleKey, 'create');
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
      this.requireModulePermission(existing.moduleKey as ModuleKey, 'update');

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
    this.requireModulePermission(input.moduleKey, 'update');
    await this.db.tx(async (tx) => {
      const ids: number[] = [];
      for (const uuid of input.orderedIds) {
        const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
        if (!row || row.moduleKey !== input.moduleKey)
          throw AppError.notFound('StatusOption', uuid);
        ids.push(row.id);
      }
      await this.repo.reorder(tx, ctx.orgId, ids);
    });
  }

  /** Contacts holding each option of a group, for the "N contacts" column and the delete warning. */
  async usage(query: StatusOptionUsageQuery): Promise<StatusOptionUsageResponse> {
    const ctx = RequestContextStore.require();
    this.requireModulePermission(query.moduleKey, 'read');
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, ctx.orgId, query.moduleKey, query.optionGroup);
      const column = contactColumnFor(query.moduleKey, query.optionGroup);
      const counts = column
        ? await this.repo.countContactsByValue(tx, ctx.orgId, column)
        : new Map<string, number>();
      return {
        data: rows.map((r) => ({ id: r.uuid, value: r.value, count: counts.get(r.value) ?? 0 })),
      };
    });
  }

  /**
   * Deletes an option. When contacts still hold its value the call is refused (409 STATUS_OPTION_IN_USE, with the
   * count) until the caller names another option of the same group in `moveTo`; the contacts are moved in the same
   * transaction, so a failure leaves both the option and the contacts as they were.
   */
  async remove(uuid: string, query: DeleteStatusOptionQuery = {}): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('StatusOption', uuid);
      const moduleKey = existing.moduleKey as ModuleKey;
      this.requireModulePermission(moduleKey, 'delete');

      let moved = 0;
      const column = contactColumnFor(moduleKey, existing.optionGroup);
      if (column) {
        const holders =
          (await this.repo.countContactsByValue(tx, ctx.orgId, column)).get(existing.value) ?? 0;
        if (holders > 0) {
          if (!query.moveTo) {
            throw new AppError(
              ERROR_CODES.STATUS_OPTION_IN_USE,
              `${holders} contact(s) hold "${existing.value}". Choose another option to move them to.`,
              HttpStatus.CONFLICT,
              [{ path: 'contacts', message: String(holders) }],
            );
          }
          const target = await this.repo.findByUuid(tx, ctx.orgId, query.moveTo);
          if (
            !target ||
            target.id === existing.id ||
            target.moduleKey !== existing.moduleKey ||
            target.optionGroup !== existing.optionGroup
          ) {
            throw AppError.notFound('StatusOption', query.moveTo);
          }
          moved = await this.repo.reassignContacts(
            tx,
            ctx.orgId,
            column,
            existing.value,
            target.value,
          );
        }
      }

      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: existing.id,
        action: 'delete',
        ...(moved > 0 ? { delta: { movedContacts: { old: 0, new: moved } } } : {}),
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'status_option.deleted',
        payload: { uuid, movedContacts: moved },
      });

      await this.repo.deleteById(tx, ctx.orgId, existing.id);
    });
  }
}
