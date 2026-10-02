import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES, RESERVED_ATTRIBUTE_KEYS } from '@crm/contracts';
import type {
  CreateFieldDependencyInput,
  CreateFieldInput,
  CreateFieldOptionDependencyInput,
  CreateFieldOptionInput,
  FieldDependencyResponse,
  FieldOptionDependencyResponse,
  FieldOptionResponse,
  FieldResponse,
  FieldUsageQuery,
  FieldUsageResponse,
  ListFieldsQuery,
  ModuleKey,
  PageResponse,
  ReorderFieldOptionsInput,
  ReorderFieldsInput,
  UpdateFieldInput,
  UpdateFieldOptionInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { propertyPermissionKey, type PropertyAction } from '../field-metadata-permission';
import { FieldDependenciesRepository } from './field-dependencies.repository';
import { FieldOptionsRepository } from './field-options.repository';
import {
  toFieldDependencyResponse,
  toFieldOptionDependencyResponse,
  toFieldOptionResponse,
  toFieldResponse,
} from './fields.mapper';
import { FieldsRepository, type FieldRow } from './fields.repository';
import type { Tx } from '@crm/db';
import { segmentNamesUsing, segmentUsageCounts } from '../segments/segment-usage';

const MODULE_KEY = 'fields';
/** Types whose values come from a fixed choice list. */
const OPTION_BACKED_TYPES = new Set(['select', 'multiselect', 'radio']);

@Injectable()
export class FieldsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: FieldsRepository,
    private readonly optionsRepo: FieldOptionsRepository,
    private readonly dependenciesRepo: FieldDependenciesRepository,
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

  private async buildFieldResponse(tx: Tx, orgId: number, row: FieldRow): Promise<FieldResponse> {
    const options = OPTION_BACKED_TYPES.has(row.fieldType)
      ? await this.optionsRepo.listByField(tx, orgId, row.id)
      : undefined;
    return toFieldResponse(row, options);
  }

  // --- fields ---------------------------------------------------------

  async list(query: ListFieldsQuery): Promise<PageResponse<FieldResponse>> {
    const ctx = RequestContextStore.require();
    this.requireModulePermission(query.moduleKey, 'read');
    return this.db.tx(async (tx) => {
      const sectionId = query.sectionId
        ? await this.repo.resolveSectionId(tx, ctx.orgId, query.sectionId)
        : undefined;
      if (query.sectionId && sectionId === undefined) {
        return { data: [], page: { nextCursor: null, hasMore: false, limit: query.limit } };
      }

      const rows = await this.repo.listByModule(tx, ctx.orgId, {
        moduleKey: query.moduleKey,
        sectionId,
        includeInactive: query.includeInactive,
      });

      const optionBacked = rows.filter((r) => OPTION_BACKED_TYPES.has(r.fieldType));
      const optionsByField = await this.optionsRepo.listByFieldIds(
        tx,
        ctx.orgId,
        optionBacked.map((r) => r.id),
      );

      return {
        data: rows.map((row) => toFieldResponse(row, optionsByField.get(row.id))),
        page: { nextCursor: null, hasMore: false, limit: query.limit },
      };
    });
  }

  /**
   * How many contacts hold a value for each field of the module ("in use" on the properties screen). Only contacts
   * keep their values in a custom-data column today, so any other module reports zero.
   */
  async usage(query: FieldUsageQuery): Promise<FieldUsageResponse> {
    const ctx = RequestContextStore.require();
    this.requireModulePermission(query.moduleKey, 'read');
    return this.db.tx(async (tx) => {
      const rows = await this.repo.listByModule(tx, ctx.orgId, {
        moduleKey: query.moduleKey,
        includeInactive: true,
      });
      const counts =
        query.moduleKey === 'contacts'
          ? await this.repo.countContactsByKey(tx, ctx.orgId)
          : new Map<string, number>();
      const segments =
        query.moduleKey === 'contacts'
          ? await segmentUsageCounts(tx, ctx.orgId, 'field')
          : new Map<string, number>();
      return {
        data: rows.map((r) => ({
          id: r.uuid,
          key: r.key,
          count: counts.get(r.key) ?? 0,
          segments: segments.get(r.key) ?? 0,
        })),
      };
    });
  }

  async getByUuid(uuid: string): Promise<FieldResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.requireField(tx, ctx.orgId, uuid);
      this.requireModulePermission(row.moduleKey as ModuleKey, 'read');
      return this.buildFieldResponse(tx, ctx.orgId, row);
    });
  }

  async create(input: CreateFieldInput): Promise<FieldResponse> {
    const ctx = RequestContextStore.require();
    this.requireModulePermission(input.moduleKey, 'create');
    // A contact property is also a merge variable ({{key}}): the keys the platform already resolves, or that the
    // contact form stores itself, cannot be redefined (same rule as POST /attributes).
    if (input.moduleKey === 'contacts' && RESERVED_ATTRIBUTE_KEYS.has(input.key)) {
      throw new AppError(
        ERROR_CODES.CON_ATTRIBUTE_KEY_RESERVED,
        `"${input.key}" is a built-in token. Pick another key.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'key', message: 'reserved' }],
      );
    }
    return this.db.tx(async (tx) => {
      const sectionId = await this.repo.resolveSectionId(tx, ctx.orgId, input.sectionId);
      if (sectionId === undefined) throw AppError.notFound('FieldSection', input.sectionId);

      const existing = await this.repo.findByKey(tx, ctx.orgId, input.moduleKey, input.key);
      if (existing) {
        throw new AppError(
          ERROR_CODES.FIELD_KEY_TAKEN,
          `Field key "${input.key}" is already used in ${input.moduleKey}`,
          HttpStatus.CONFLICT,
        );
      }

      const position =
        input.position ?? (await this.repo.nextPosition(tx, ctx.orgId, input.moduleKey, sectionId));

      const created = await this.repo.insert(tx, ctx.orgId, {
        moduleKey: input.moduleKey,
        sectionId,
        key: input.key,
        label: input.label,
        fieldType: input.fieldType,
        isRequired: input.isRequired,
        isHidden: input.isHidden,
        isReadOnly: input.isReadOnly,
        isMasked: input.isMasked,
        isUnique: input.isUnique,
        isQuickCreate: input.isQuickCreate,
        isGlobalSearch: input.isGlobalSearch,
        config: input.config,
        position,
      });

      if (input.options?.length) {
        for (const [index, option] of input.options.entries()) {
          await this.optionsRepo.insert(tx, ctx.orgId, {
            fieldId: created.id,
            value: option.value,
            label: option.label,
            position: option.position ?? index,
          });
        }
      }

      await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'field.created',
        payload: { uuid: created.uuid, moduleKey: input.moduleKey, key: input.key },
      });

      const createdRow = await this.requireField(tx, ctx.orgId, created.uuid);
      return this.buildFieldResponse(tx, ctx.orgId, createdRow);
    });
  }

  async update(uuid: string, input: UpdateFieldInput): Promise<FieldResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const existing = await this.requireField(tx, ctx.orgId, uuid);
      this.requireModulePermission(existing.moduleKey as ModuleKey, 'update');

      const values: Record<string, unknown> = {};
      if (input.label !== undefined) values.label = input.label;
      if (input.isRequired !== undefined) values.isRequired = input.isRequired;
      if (input.isHidden !== undefined) values.isHidden = input.isHidden;
      if (input.isReadOnly !== undefined) values.isReadOnly = input.isReadOnly;
      if (input.isMasked !== undefined) values.isMasked = input.isMasked;
      if (input.isUnique !== undefined) values.isUnique = input.isUnique;
      if (input.isQuickCreate !== undefined) values.isQuickCreate = input.isQuickCreate;
      if (input.isGlobalSearch !== undefined) values.isGlobalSearch = input.isGlobalSearch;
      if (input.isActive !== undefined) values.isActive = input.isActive;
      if (input.config !== undefined) values.config = input.config;
      if (input.sectionId !== undefined) {
        const sectionId = await this.repo.resolveSectionId(tx, ctx.orgId, input.sectionId);
        if (sectionId === undefined) throw AppError.notFound('FieldSection', input.sectionId);
        values.sectionId = sectionId;
      }

      const updated = await this.repo.updateWithVersion(
        tx,
        ctx.orgId,
        existing.id,
        input.rowVersion,
        values,
      );
      if (!updated) throw AppError.rowVersionConflict('Field');

      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: existing.id,
        action: 'update',
        delta: this.audit.diff(existing as unknown as Record<string, unknown>, values),
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'field.updated',
        payload: { uuid, key: existing.key },
      });

      const updatedRow = await this.requireField(tx, ctx.orgId, uuid);
      return this.buildFieldResponse(tx, ctx.orgId, updatedRow);
    });
  }

  async reorder(input: ReorderFieldsInput): Promise<void> {
    const ctx = RequestContextStore.require();
    this.requireModulePermission(input.moduleKey, 'update');
    await this.db.tx(async (tx) => {
      const ids: number[] = [];
      for (const uuid of input.orderedIds) {
        const row = await this.requireField(tx, ctx.orgId, uuid);
        if (row.moduleKey !== input.moduleKey) throw AppError.notFound('Field', uuid);
        ids.push(row.id);
      }
      await this.repo.reorder(tx, ctx.orgId, ids);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const existing = await this.requireField(tx, ctx.orgId, uuid);
      this.requireModulePermission(existing.moduleKey as ModuleKey, 'delete');
      // System fields (first_name, email, ...) render with a "Locked" badge
      // in Data Management for exactly this reason — deleting the ones every
      // other module reads by key is not a per-org decision to allow.
      if (existing.isSystem) {
        throw new AppError(
          ERROR_CODES.FIELD_IS_SYSTEM,
          `Field "${existing.key}" is system-managed and cannot be deleted`,
          HttpStatus.CONFLICT,
        );
      }

      // Segments that filter on this property are not blocked: the condition now matches nothing and is flagged
      // (invalidConditions). The audit row and the event say which ones.
      const segmentNames =
        existing.moduleKey === 'contacts'
          ? await segmentNamesUsing(tx, ctx.orgId, 'field', existing.key)
          : [];
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: existing.id,
        action: 'delete',
        ...(segmentNames.length > 0
          ? { delta: { segments: { old: segmentNames, new: null } } }
          : {}),
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'field.deleted',
        payload: { uuid, key: existing.key, segments: segmentNames },
      });

      // Soft delete: existing contacts.data still has this key, so the
      // column can't disappear from under live records — see Phase 8 exit
      // criteria (versioned/soft-delete, never a naive DELETE).
      await this.repo.deactivate(tx, ctx.orgId, existing.id);
    });
  }

  // --- field options ----------------------------------------------------

  async listOptions(fieldUuid: string): Promise<FieldOptionResponse[]> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const field = await this.requireField(tx, ctx.orgId, fieldUuid);
      this.requireModulePermission(field.moduleKey as ModuleKey, 'read');
      const rows = await this.optionsRepo.listByField(tx, ctx.orgId, field.id);
      return rows.map(toFieldOptionResponse);
    });
  }

  async createOption(
    fieldUuid: string,
    input: CreateFieldOptionInput,
  ): Promise<FieldOptionResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const field = await this.requireField(tx, ctx.orgId, fieldUuid);
      this.requireModulePermission(field.moduleKey as ModuleKey, 'create');
      const position =
        input.position ?? (await this.optionsRepo.nextPosition(tx, ctx.orgId, field.id));

      const created = await this.optionsRepo.insert(tx, ctx.orgId, {
        fieldId: field.id,
        value: input.value,
        label: input.label,
        position,
      });

      const row = await this.optionsRepo.findById(tx, ctx.orgId, created.id);
      return toFieldOptionResponse(row!);
    });
  }

  async updateOption(
    optionUuid: string,
    input: UpdateFieldOptionInput,
  ): Promise<FieldOptionResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const existing = await this.optionsRepo.findByUuid(tx, ctx.orgId, optionUuid);
      if (!existing) throw AppError.notFound('FieldOption', optionUuid);
      this.requireModulePermission(existing.moduleKey as ModuleKey, 'update');

      const values: Record<string, unknown> = {};
      if (input.value !== undefined) values.value = input.value;
      if (input.label !== undefined) values.label = input.label;
      if (input.isHidden !== undefined) values.isHidden = input.isHidden;

      const updated = await this.optionsRepo.updateWithVersion(
        tx,
        ctx.orgId,
        existing.id,
        input.rowVersion,
        values,
      );
      if (!updated) throw AppError.rowVersionConflict('FieldOption');

      const row = await this.optionsRepo.findById(tx, ctx.orgId, existing.id);
      return toFieldOptionResponse(row!);
    });
  }

  async reorderOptions(fieldUuid: string, input: ReorderFieldOptionsInput): Promise<void> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const field = await this.requireField(tx, ctx.orgId, fieldUuid);
      this.requireModulePermission(field.moduleKey as ModuleKey, 'update');
      const ids: number[] = [];
      for (const uuid of input.orderedIds) {
        const row = await this.optionsRepo.findByUuid(tx, ctx.orgId, uuid);
        // Not just "exists" — must belong to *this* field, or a caller could
        // reorder another field's (possibly another module's) options via
        // this endpoint's permission check.
        if (!row || row.fieldId !== field.id) throw AppError.notFound('FieldOption', uuid);
        ids.push(row.id);
      }
      await this.optionsRepo.reorder(tx, ctx.orgId, ids);
    });
  }

  async removeOption(optionUuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const existing = await this.optionsRepo.findByUuid(tx, ctx.orgId, optionUuid);
      if (!existing) throw AppError.notFound('FieldOption', optionUuid);
      this.requireModulePermission(existing.moduleKey as ModuleKey, 'delete');
      await this.optionsRepo.deleteById(tx, ctx.orgId, existing.id);
    });
  }

  // --- field dependencies -----------------------------------------------

  async listModuleDependencies(query: FieldUsageQuery): Promise<FieldDependencyResponse[]> {
    const ctx = RequestContextStore.require();
    this.requireModulePermission(query.moduleKey, 'read');
    return this.db.tx(async (tx) => {
      const rows = await this.dependenciesRepo.listByModule(tx, ctx.orgId, query.moduleKey);
      return rows.map(toFieldDependencyResponse);
    });
  }

  async listDependencies(fieldUuid: string): Promise<FieldDependencyResponse[]> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const field = await this.requireField(tx, ctx.orgId, fieldUuid);
      this.requireModulePermission(field.moduleKey as ModuleKey, 'read');
      const rows = await this.dependenciesRepo.listByField(tx, ctx.orgId, field.id);
      return rows.map(toFieldDependencyResponse);
    });
  }

  async createDependency(input: CreateFieldDependencyInput): Promise<FieldDependencyResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const field = await this.requireField(tx, ctx.orgId, input.fieldId);
      this.requireModulePermission(field.moduleKey as ModuleKey, 'create');
      const dependsOnField = await this.requireField(tx, ctx.orgId, input.dependsOnFieldId);

      const dependsOnOptionId = input.dependsOnOptionId
        ? (await this.optionsRepo.findByUuid(tx, ctx.orgId, input.dependsOnOptionId))?.id
        : undefined;
      if (input.dependsOnOptionId && dependsOnOptionId === undefined) {
        throw AppError.notFound('FieldOption', input.dependsOnOptionId);
      }

      if (
        await this.dependenciesRepo.wouldCreateCycle(tx, ctx.orgId, field.id, dependsOnField.id)
      ) {
        throw new AppError(
          ERROR_CODES.DEPENDENCY_CYCLE_DETECTED,
          `Making "${field.key}" depend on "${dependsOnField.key}" would create a cycle`,
          HttpStatus.CONFLICT,
        );
      }

      const created = await this.dependenciesRepo.insertFieldDependency(tx, ctx.orgId, {
        fieldId: field.id,
        dependsOnFieldId: dependsOnField.id,
        dependsOnOptionId,
        dependsOnValue: input.dependsOnValue,
      });

      const row = await this.dependenciesRepo.findDependencyByUuid(tx, ctx.orgId, created.uuid);
      return toFieldDependencyResponse(row!);
    });
  }

  async removeDependency(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const existing = await this.dependenciesRepo.findDependencyByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('FieldDependency', uuid);
      this.requireModulePermission(existing.moduleKey as ModuleKey, 'delete');
      await this.dependenciesRepo.deleteFieldDependency(tx, ctx.orgId, existing.id);
    });
  }

  // --- field option dependencies -----------------------------------------

  async listOptionDependencies(parentOptionUuid: string): Promise<FieldOptionDependencyResponse[]> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const parent = await this.optionsRepo.findByUuid(tx, ctx.orgId, parentOptionUuid);
      if (!parent) throw AppError.notFound('FieldOption', parentOptionUuid);
      this.requireModulePermission(parent.moduleKey as ModuleKey, 'read');
      const rows = await this.dependenciesRepo.listOptionDependenciesByParent(
        tx,
        ctx.orgId,
        parent.id,
      );
      return rows.map(toFieldOptionDependencyResponse);
    });
  }

  async createOptionDependency(
    input: CreateFieldOptionDependencyInput,
  ): Promise<FieldOptionDependencyResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const parent = await this.optionsRepo.findByUuid(tx, ctx.orgId, input.parentOptionId);
      if (!parent) throw AppError.notFound('FieldOption', input.parentOptionId);
      this.requireModulePermission(parent.moduleKey as ModuleKey, 'create');
      const child = await this.optionsRepo.findByUuid(tx, ctx.orgId, input.childOptionId);
      if (!child) throw AppError.notFound('FieldOption', input.childOptionId);

      const created = await this.dependenciesRepo.insertOptionDependency(tx, ctx.orgId, {
        parentOptionId: parent.id,
        childOptionId: child.id,
      });

      const row = await this.dependenciesRepo.findOptionDependencyByUuid(
        tx,
        ctx.orgId,
        created.uuid,
      );
      return toFieldOptionDependencyResponse(row!);
    });
  }

  async removeOptionDependency(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const existing = await this.dependenciesRepo.findOptionDependencyByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('FieldOptionDependency', uuid);
      this.requireModulePermission(existing.moduleKey as ModuleKey, 'delete');
      await this.dependenciesRepo.deleteOptionDependency(tx, ctx.orgId, existing.id);
    });
  }

  private async requireField(
    tx: Parameters<FieldsRepository['findByUuid']>[0],
    orgId: number,
    uuid: string,
  ) {
    const row = await this.repo.findByUuid(tx, orgId, uuid);
    if (!row) throw AppError.notFound('Field', uuid);
    return row;
  }
}
