import { Injectable } from '@nestjs/common';
import type {
  CreateFieldSectionInput,
  FieldSectionResponse,
  ListFieldSectionsQuery,
  ModuleKey,
  PageResponse,
  ReorderFieldSectionsInput,
  UpdateFieldSectionInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { propertyPermissionKey, type PropertyAction } from '../field-metadata-permission';
import { toFieldSectionResponse } from './field-sections.mapper';
import { FieldSectionsRepository } from './field-sections.repository';

const MODULE_KEY = 'field_sections';

/**
 * Field sections — the grouping shell under Settings > Data Management.
 *
 * A whole org's worth of sections for one module is a handful of rows, so
 * `list` returns everything in one page rather than paging a list that will
 * never need it — the contract still carries the standard page envelope for
 * consistency with every other list endpoint.
 */
@Injectable()
export class FieldSectionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: FieldSectionsRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  /**
   * @RequirePermission on the controller only checks "some properties
   * permission for this action" (it's static metadata, blind to moduleKey).
   * This is the real, per-moduleKey check — contact-properties and
   * company-properties must not unlock each other.
   */
  private requireModulePermission(moduleKey: ModuleKey, action: PropertyAction) {
    const ctx = RequestContextStore.require();
    const key = propertyPermissionKey(moduleKey, action);
    if (!this.rbac.can(ctx.grants!, key).allowed) throw AppError.forbidden(key);
  }

  async list(query: ListFieldSectionsQuery): Promise<PageResponse<FieldSectionResponse>> {
    const ctx = RequestContextStore.require();
    this.requireModulePermission(query.moduleKey, 'read');
    return this.db.tx(async (tx) => {
      const rows = await this.repo.listByModule(tx, ctx.orgId, query.moduleKey);
      return {
        data: rows.map(toFieldSectionResponse),
        page: { nextCursor: null, hasMore: false, limit: query.limit },
      };
    });
  }

  async create(input: CreateFieldSectionInput): Promise<FieldSectionResponse> {
    const ctx = RequestContextStore.require();
    this.requireModulePermission(input.moduleKey, 'create');
    return this.db.tx(async (tx) => {
      const position =
        input.position ?? (await this.repo.nextPosition(tx, ctx.orgId, input.moduleKey));

      const created = await this.repo.insert(tx, ctx.orgId, {
        moduleKey: input.moduleKey,
        name: input.name,
        position,
      });

      await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'field_section.created',
        payload: { uuid: created.uuid, moduleKey: input.moduleKey, name: input.name },
      });

      const row = await this.repo.findById(tx, ctx.orgId, created.id);
      return toFieldSectionResponse(row!);
    });
  }

  async update(uuid: string, input: UpdateFieldSectionInput): Promise<FieldSectionResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('FieldSection', uuid);
      this.requireModulePermission(existing.moduleKey as ModuleKey, 'update');

      const values: Record<string, unknown> = {};
      if (input.name !== undefined) values.name = input.name;
      if (input.isActive !== undefined) values.isActive = input.isActive;

      const updated = await this.repo.updateWithVersion(
        tx,
        ctx.orgId,
        existing.id,
        input.rowVersion,
        values,
      );
      if (!updated) throw AppError.rowVersionConflict('FieldSection');

      const after = await this.repo.findById(tx, ctx.orgId, existing.id);

      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: existing.id,
        action: 'update',
        delta: this.audit.diff(
          existing as unknown as Record<string, unknown>,
          after as unknown as Record<string, unknown>,
        ),
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'field_section.updated',
        payload: { uuid },
      });

      return toFieldSectionResponse(after!);
    });
  }

  async reorder(input: ReorderFieldSectionsInput): Promise<void> {
    const ctx = RequestContextStore.require();
    this.requireModulePermission(input.moduleKey, 'update');
    await this.db.tx(async (tx) => {
      const ids: number[] = [];
      const rows = await this.repo.findByUuids(tx, ctx.orgId, input.orderedIds);
      for (const uuid of input.orderedIds) {
        const row = rows.get(uuid);
        // A uuid from a different moduleKey is treated as not found here
        // rather than reordered — orderedIds must all belong to the module
        // the caller declared and was checked against above.
        if (!row || row.moduleKey !== input.moduleKey)
          throw AppError.notFound('FieldSection', uuid);
        ids.push(row.id);
      }
      await this.repo.reorder(tx, ctx.orgId, ids);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('FieldSection', uuid);
      this.requireModulePermission(existing.moduleKey as ModuleKey, 'delete');

      // Fields in this section are not deleted — the FK is ON DELETE SET
      // NULL, so they just become sectionless rather than disappearing.
      await this.audit.record(tx, { module: MODULE_KEY, recordId: existing.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'field_section.deleted',
        payload: { uuid },
      });

      await this.repo.deleteById(tx, ctx.orgId, existing.id);
    });
  }
}
