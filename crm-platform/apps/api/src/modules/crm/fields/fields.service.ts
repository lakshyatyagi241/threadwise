import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES, FIELD_INLINE_OPTIONS_MAX, RESERVED_ATTRIBUTE_KEYS } from '@crm/contracts';
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
  ReplaceCascadeInput,
  SearchFieldOptionsQuery,
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
import { PlanUsageService } from '../../plans-subscriptions-trials';
import { propertyPermissionKey, type PropertyAction } from '../field-metadata-permission';
import {
  FieldDependenciesRepository,
  type OptionPairValues,
} from './field-dependencies.repository';
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
    private readonly planUsage: PlanUsageService,
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
    return toFieldResponse(row, options, options?.length);
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
      // A field with a very long option list (every City) is listed without them: `optionCount` says how many there are and
      // `GET /fields/:id/option-search` pages through them. The rest keep their options inline, as before.
      const counts = await this.optionsRepo.countByFieldIds(
        tx,
        ctx.orgId,
        optionBacked.map((r) => r.id),
      );
      const inline = optionBacked.filter(
        (r) => query.options === 'all' || (counts.get(r.id) ?? 0) <= FIELD_INLINE_OPTIONS_MAX,
      );
      const optionsByField = await this.optionsRepo.listByFieldIds(
        tx,
        ctx.orgId,
        inline.map((r) => r.id),
      );

      return {
        data: rows.map((row) => {
          if (!OPTION_BACKED_TYPES.has(row.fieldType)) return toFieldResponse(row);
          const options = optionsByField.get(row.id) ?? (counts.has(row.id) ? undefined : []);
          return toFieldResponse(row, options, counts.get(row.id) ?? 0);
        }),
        page: { nextCursor: null, hasMore: false, limit: query.limit },
      };
    });
  }

  /**
   * How many records hold a value for each field of the module ("in use" on the properties screen): contacts and companies keep
   * their values in a custom-data column. Segments filter on contact properties and, through the contact's company, on company ones.
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
          : await this.repo.countCompaniesByKey(tx, ctx.orgId);
      const segments = await segmentUsageCounts(tx, ctx.orgId, 'field');
      // A company property is told apart from a contact property of the same key by its `company.` prefix (segment-usage.ts).
      const segmentRef = (key: string) => (query.moduleKey === 'contacts' ? key : `company.${key}`);
      return {
        data: rows.map((r) => ({
          id: r.uuid,
          key: r.key,
          count: counts.get(r.key) ?? 0,
          segments: segments.get(segmentRef(r.key)) ?? 0,
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
    // The plan's `custom_fields` cap: this endpoint only ever creates non-system fields (the meter excludes the built-in ones).
    return this.db.tx(async (tx) => {
      await this.planUsage.assertCanAddIn(tx, ctx.orgId, 'custom_fields');
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
          : existing.moduleKey === 'companies'
            ? await segmentNamesUsing(tx, ctx.orgId, 'field', `company.${existing.key}`)
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

  /** One page of a field's options for a search box (or the labels of some stored values): see FieldOptionsRepository.search. */
  async searchOptions(
    fieldUuid: string,
    query: SearchFieldOptionsQuery,
  ): Promise<PageResponse<FieldOptionResponse>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const field = await this.requireField(tx, ctx.orgId, fieldUuid);
      this.requireModulePermission(field.moduleKey as ModuleKey, 'read');
      const { rows, nextCursor } = await this.optionsRepo.search(tx, ctx.orgId, field.id, query);
      return {
        data: rows.map(toFieldOptionResponse),
        page: { nextCursor, hasMore: nextCursor !== null, limit: query.limit },
      };
    });
  }

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
      const rows = await this.optionsRepo.findByUuids(tx, ctx.orgId, input.orderedIds);
      for (const uuid of input.orderedIds) {
        const row = rows.get(uuid);
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
      // A cascade link's option pairs mean nothing without it, so they go with it.
      if (existing.dependsOnOptionId === null && existing.dependsOnValue === null) {
        await this.dependenciesRepo.deleteOptionPairsOfChild(
          tx,
          ctx.orgId,
          existing.fieldId,
          existing.dependsOnFieldId,
        );
      }
    });
  }

  /**
   * Make `childUuid`'s choices depend on `dependsOnFieldId`'s: a cascade. It replaces the field's whole cascade (its cascade links and
   * every option pair that feeds its choices), so after it the given parent is the field's only cascade parent.
   */
  async replaceCascade(childUuid: string, input: ReplaceCascadeInput): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const child = await this.requireField(tx, ctx.orgId, childUuid);
      this.requireModulePermission(child.moduleKey as ModuleKey, 'update');
      const parent = await this.requireField(tx, ctx.orgId, input.dependsOnFieldId);
      if (parent.moduleKey !== child.moduleKey) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          'A cascade can only link properties of the same module',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const pairs = await this.resolveOptionPairs(tx, ctx.orgId, parent, child, input.optionPairs);

      await this.dependenciesRepo.deleteOptionPairsOfChild(tx, ctx.orgId, child.id);
      await this.dependenciesRepo.deleteCascadeLinks(tx, ctx.orgId, child.id);
      if (await this.dependenciesRepo.wouldCreateCycle(tx, ctx.orgId, child.id, parent.id)) {
        throw new AppError(
          ERROR_CODES.DEPENDENCY_CYCLE_DETECTED,
          `Making "${child.key}" depend on "${parent.key}" would create a cycle`,
          HttpStatus.CONFLICT,
        );
      }
      await this.dependenciesRepo.insertFieldDependency(tx, ctx.orgId, {
        fieldId: child.id,
        dependsOnFieldId: parent.id,
      });
      await this.dependenciesRepo.insertOptionPairs(tx, ctx.orgId, pairs);
    });
  }

  /** Remove a field's cascade: its cascade links and every option pair that feeds its choices. Its "show only when" rules stay. */
  async removeCascade(childUuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const child = await this.requireField(tx, ctx.orgId, childUuid);
      this.requireModulePermission(child.moduleKey as ModuleKey, 'delete');
      await this.dependenciesRepo.deleteOptionPairsOfChild(tx, ctx.orgId, child.id);
      await this.dependenciesRepo.deleteCascadeLinks(tx, ctx.orgId, child.id);
    });
  }

  /** Every cascade option pair of one module's fields (the choices a cascade child allows under each parent choice). */
  async listModuleOptionDependencies(
    query: FieldUsageQuery,
  ): Promise<FieldOptionDependencyResponse[]> {
    const ctx = RequestContextStore.require();
    this.requireModulePermission(query.moduleKey, 'read');
    return this.db.tx(async (tx) => {
      const rows = await this.dependenciesRepo.listOptionDependenciesByModule(
        tx,
        ctx.orgId,
        query.moduleKey,
      );
      return rows.map(toFieldOptionDependencyResponse);
    });
  }

  /** Checks each pair's options: both must exist and sit on the parent's and the child's field respectively. */
  private async resolveOptionPairs(
    tx: Parameters<FieldsRepository['findByUuid']>[0],
    orgId: number,
    parent: FieldRow,
    child: FieldRow,
    pairs: ReplaceCascadeInput['optionPairs'],
  ): Promise<OptionPairValues[]> {
    const uuids = [...new Set(pairs.flatMap((p) => [p.parentOptionId, p.childOptionId]))];
    const found = await this.optionsRepo.findByUuids(tx, orgId, uuids);
    const out = new Map<string, OptionPairValues>();
    for (const pair of pairs) {
      const parentOption = found.get(pair.parentOptionId);
      if (!parentOption) throw AppError.notFound('FieldOption', pair.parentOptionId);
      const childOption = found.get(pair.childOptionId);
      if (!childOption) throw AppError.notFound('FieldOption', pair.childOptionId);
      if (parentOption.fieldId !== parent.id) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          `That option is not a choice of "${parent.key}"`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (childOption.fieldId !== child.id) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          `That option is not a choice of "${child.key}"`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      out.set(`${parentOption.id}:${childOption.id}`, {
        parentOptionId: parentOption.id,
        childOptionId: childOption.id,
      });
    }
    return [...out.values()];
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
