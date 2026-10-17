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
import type { Tx } from '@crm/db';
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
import { segmentNamesUsing, segmentUsageCounts } from '../segments/segment-usage';

/** Which kind of segment reference a contact option group is (stages and statuses; the lost reason is not filterable). */
function segmentKindOfOptionGroup(
  moduleKey: string,
  optionGroup: string,
): 'stage' | 'status' | undefined {
  if (moduleKey !== 'contacts') return undefined;
  if (optionGroup === 'lifecycle_stage') return 'stage';
  return optionGroup === 'status' || optionGroup === 'contact_status' ? 'status' : undefined;
}

const MODULE_KEY = 'status_options';

/** Won / lost flags exist on the stages of a contact's lifecycle only. */
function flagsAllowed(moduleKey: string, optionGroup: string): boolean {
  return moduleKey === 'contacts' && optionGroup === 'lifecycle_stage';
}

function flagError(message: string): AppError {
  return new AppError(
    ERROR_CODES.STATUS_OPTION_FLAG_INVALID,
    message,
    HttpStatus.UNPROCESSABLE_ENTITY,
    [{ path: 'isWon', message }],
  );
}

function stageError(message: string): AppError {
  return new AppError(
    ERROR_CODES.STATUS_OPTION_STAGE_INVALID,
    message,
    HttpStatus.UNPROCESSABLE_ENTITY,
    [{ path: 'stageOptionId', message }],
  );
}

/** The groups that hold a contact's status: the only ones an option can be scoped to a stage in. */
const STATUS_GROUPS: readonly string[] = ['status', 'contact_status'];

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

  /**
   * The internal id of the lifecycle stage a status is scoped to, or null for "every stage". The target must be a
   * `lifecycle_stage` option of the caller's workspace (another workspace's uuid is simply not found, RLS) and the option
   * being scoped must be a contact status.
   */
  private async resolveStageScope(
    tx: Tx,
    orgId: number,
    moduleKey: string,
    optionGroup: string,
    stageUuid: string | null | undefined,
  ): Promise<number | null> {
    if (stageUuid === null || stageUuid === undefined) return null;
    if (moduleKey !== 'contacts' || !STATUS_GROUPS.includes(optionGroup)) {
      throw stageError('Only contact statuses can be scoped to a lifecycle stage.');
    }
    const stage = await this.repo.findByUuid(tx, orgId, stageUuid);
    if (!stage) throw AppError.notFound('StatusOption', stageUuid);
    if (stage.moduleKey !== 'contacts' || stage.optionGroup !== 'lifecycle_stage') {
      throw stageError('A status can only be scoped to a lifecycle stage.');
    }
    return stage.id;
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
    if (input.isWon && input.isLost) throw flagError('A stage cannot be both won and lost.');
    if ((input.isWon || input.isLost) && !flagsAllowed(input.moduleKey, input.optionGroup)) {
      throw flagError('Won and lost apply to contact lifecycle stages only.');
    }
    return this.db.tx(async (tx) => {
      const stageOptionId = await this.resolveStageScope(
        tx,
        ctx.orgId,
        input.moduleKey,
        input.optionGroup,
        input.stageOptionId,
      );
      const position =
        input.position ??
        (await this.repo.nextPosition(tx, ctx.orgId, input.moduleKey, input.optionGroup));

      if (input.isDefault) {
        await this.repo.clearDefault(
          tx,
          ctx.orgId,
          input.moduleKey,
          input.optionGroup,
          stageOptionId,
        );
      }

      const created = await this.repo.insert(tx, ctx.orgId, {
        moduleKey: input.moduleKey,
        optionGroup: input.optionGroup,
        value: input.value,
        label: input.label,
        color: input.color,
        position,
        isDefault: input.isDefault,
        isWon: input.isWon,
        isLost: input.isLost,
        stageOptionId,
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

      // Setting one flag clears the other unless the request names both (which is a mistake).
      let isWon = input.isWon ?? existing.isWon;
      let isLost = input.isLost ?? existing.isLost;
      if (input.isWon === true && input.isLost === undefined) isLost = false;
      if (input.isLost === true && input.isWon === undefined) isWon = false;
      if (isWon && isLost) throw flagError('A stage cannot be both won and lost.');
      if (
        (input.isWon !== undefined || input.isLost !== undefined) &&
        (isWon || isLost) &&
        !flagsAllowed(existing.moduleKey, existing.optionGroup)
      ) {
        throw flagError('Won and lost apply to contact lifecycle stages only.');
      }

      // Scope: absent keeps it, null = every stage, a uuid = that stage.
      const scopeChanged = input.stageOptionId !== undefined;
      const stageOptionId = scopeChanged
        ? await this.resolveStageScope(
            tx,
            ctx.orgId,
            existing.moduleKey,
            existing.optionGroup,
            input.stageOptionId,
          )
        : existing.stageOptionId;
      const movedScope = scopeChanged && stageOptionId !== existing.stageOptionId;

      if (input.isDefault) {
        await this.repo.clearDefault(
          tx,
          ctx.orgId,
          existing.moduleKey as ModuleKey,
          existing.optionGroup,
          stageOptionId,
        );
      }

      const values: Record<string, unknown> = {};
      if (movedScope) {
        values.stageOptionId = stageOptionId;
        // A default that moves into a scope which already has one gives way (an explicit isDefault: true wins instead).
        if (
          input.isDefault === undefined &&
          existing.isDefault &&
          (await this.repo.scopeHasDefault(
            tx,
            ctx.orgId,
            existing.moduleKey as ModuleKey,
            existing.optionGroup,
            stageOptionId,
            existing.id,
          ))
        ) {
          values.isDefault = false;
        }
      }
      if (isWon !== existing.isWon) values.isWon = isWon;
      if (isLost !== existing.isLost) values.isLost = isLost;
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
      const rows = await this.repo.findByUuids(tx, ctx.orgId, input.orderedIds);
      for (const uuid of input.orderedIds) {
        const row = rows.get(uuid);
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
      const kind = segmentKindOfOptionGroup(query.moduleKey, query.optionGroup);
      const segments = kind
        ? await segmentUsageCounts(tx, ctx.orgId, kind)
        : new Map<string, number>();
      return {
        data: rows.map((r) => ({
          id: r.uuid,
          value: r.value,
          count: counts.get(r.value) ?? 0,
          segments: segments.get(r.value) ?? 0,
        })),
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
          // A target status scoped to a stage only fits the contacts of that stage (the rest end up with none).
          const targetStage =
            target.stageOptionId !== null
              ? ((await this.repo.findById(tx, ctx.orgId, target.stageOptionId))?.value ?? null)
              : null;
          moved = await this.repo.reassignContacts(
            tx,
            ctx.orgId,
            column,
            existing.value,
            target.value,
            { isWon: target.isWon, isLost: target.isLost, stageValue: targetStage },
          );
        }
      }

      // The statuses scoped to a deleted stage stay, valid in every stage.
      if (moduleKey === 'contacts' && existing.optionGroup === 'lifecycle_stage') {
        await this.repo.unscopeStatuses(tx, ctx.orgId, existing.id);
      }

      // Segments that point at this stage or status are not blocked: their condition now matches nothing and is
      // flagged (invalidConditions). The audit row and the event say which ones, so it is traceable.
      const kind = segmentKindOfOptionGroup(moduleKey, existing.optionGroup);
      const segmentNames = kind ? await segmentNamesUsing(tx, ctx.orgId, kind, existing.value) : [];
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: existing.id,
        action: 'delete',
        ...(moved > 0 || segmentNames.length > 0
          ? {
              delta: {
                ...(moved > 0 ? { movedContacts: { old: 0, new: moved } } : {}),
                ...(segmentNames.length > 0 ? { segments: { old: segmentNames, new: null } } : {}),
              },
            }
          : {}),
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'status_option.deleted',
        payload: { uuid, movedContacts: moved, segments: segmentNames },
      });

      await this.repo.deleteById(tx, ctx.orgId, existing.id);
    });
  }
}
