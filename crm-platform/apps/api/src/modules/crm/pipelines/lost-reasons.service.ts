import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type CreateLostReasonInput,
  type DealSettingsResponse,
  type LostReasonResponse,
  type ReorderLostReasonsInput,
  type UpdateDealSettingsInput,
  type UpdateLostReasonInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { toLostReasonResponse } from './pipelines.mapper';
import { PipelinesRepository } from './pipelines.repository';
import { pgError } from './pipelines.service';

const MODULE_KEY = 'deal_lost_reasons';

const nameTaken = (name: string) =>
  new AppError(
    ERROR_CODES.DEAL_LOST_REASON_NAME_TAKEN,
    `A lost reason named "${name}" already exists.`,
    HttpStatus.CONFLICT,
  );

/**
 * The lost-reason catalogue and the deal settings (TW-DEAL-043, D-08). Reference had a free-text reason nothing collected; a
 * workspace now keeps a short list reps pick from, and can require one. A deal keeps the reason's name as text, so deleting or
 * renaming a reason never rewrites history.
 */
@Injectable()
export class LostReasonsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: PipelinesRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** `activeOnly` is what a picker wants; the settings screen lists everything. */
  async list(activeOnly: boolean): Promise<LostReasonResponse[]> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) =>
      (await this.repo.listReasons(tx, ctx.orgId, activeOnly)).map(toLostReasonResponse),
    );
  }

  async create(input: CreateLostReasonInput): Promise<LostReasonResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      if (await this.repo.reasonByName(tx, ctx.orgId, input.name)) throw nameTaken(input.name);
      let created: { id: number; uuid: string };
      try {
        created = await tx.transaction(async (sp) =>
          this.repo.insertReason(sp, ctx.orgId, {
            name: input.name,
            isActive: input.isActive ?? true,
            sortOrder: (await this.repo.maxReasonOrder(sp, ctx.orgId)) + 1,
          }),
        );
      } catch (err) {
        if (pgError(err).code === '23505') throw nameTaken(input.name);
        throw err;
      }
      await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'deal_lost_reason.created',
        payload: { uuid: created.uuid, name: input.name },
      });
      return toLostReasonResponse((await this.repo.reasonByUuid(tx, ctx.orgId, created.uuid))!);
    });
  }

  async update(uuid: string, input: UpdateLostReasonInput): Promise<LostReasonResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const existing = await this.repo.reasonByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('Lost reason', uuid);
      if (input.name !== undefined) {
        const clash = await this.repo.reasonByName(tx, ctx.orgId, input.name);
        if (clash && clash.id !== existing.id) throw nameTaken(input.name);
      }
      let updated: boolean;
      try {
        updated = await tx.transaction((sp) =>
          this.repo.updateReason(sp, ctx.orgId, existing.id, input.rowVersion, {
            name: input.name,
            isActive: input.isActive,
          }),
        );
      } catch (err) {
        if (pgError(err).code === '23505') throw nameTaken(input.name ?? existing.name);
        throw err;
      }
      if (!updated) throw AppError.rowVersionConflict('Lost reason');
      const after = (await this.repo.reasonByUuid(tx, ctx.orgId, uuid))!;
      const delta = this.audit.diff(
        { name: existing.name, isActive: existing.isActive },
        { name: after.name, isActive: after.isActive },
      );
      if (Object.keys(delta).length > 0) {
        await this.audit.record(tx, {
          module: MODULE_KEY,
          recordId: existing.id,
          action: 'update',
          delta,
        });
        await this.outbox.emit(tx, {
          aggregateModule: MODULE_KEY,
          aggregateId: existing.id,
          eventType: 'deal_lost_reason.updated',
          payload: { uuid, name: after.name, isActive: after.isActive },
        });
      }
      return toLostReasonResponse(after);
    });
  }

  async reorder(input: ReorderLostReasonsInput): Promise<LostReasonResponse[]> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const all = await this.repo.listReasons(tx, ctx.orgId, false);
      const byUuid = new Map(all.map((r) => [r.uuid, r.id]));
      const unique = new Set(input.reasonIds);
      if (
        unique.size !== input.reasonIds.length ||
        input.reasonIds.length !== all.length ||
        input.reasonIds.some((u) => !byUuid.has(u))
      ) {
        throw new AppError(
          ERROR_CODES.DEAL_ORDER_INVALID,
          'Send every id exactly once, in the order you want.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'reasonIds', message: 'must list every existing item exactly once' }],
        );
      }
      await this.repo.setReasonOrder(
        tx,
        ctx.orgId,
        input.reasonIds.map((u) => byUuid.get(u)!),
      );
      return (await this.repo.listReasons(tx, ctx.orgId, false)).map(toLostReasonResponse);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const existing = await this.repo.reasonByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('Lost reason', uuid);
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: existing.id,
        action: 'delete',
        delta: {
          name: { old: existing.name, new: null },
          deals: { old: existing.dealCount, new: 0 },
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'deal_lost_reason.deleted',
        payload: { uuid, name: existing.name, deals: existing.dealCount },
      });
      // Deals keep the reason text; only their link to the catalogue row is cleared (ON DELETE SET NULL).
      await this.repo.deleteReason(tx, ctx.orgId, existing.id);
    });
  }

  // --- settings --------------------------------------------------------------------------------------------------------

  async settings(): Promise<DealSettingsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx((tx) => this.repo.settings(tx, ctx.orgId));
  }

  async updateSettings(input: UpdateDealSettingsInput): Promise<DealSettingsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const before = await this.repo.settings(tx, ctx.orgId);
      await this.repo.saveSettings(tx, ctx.orgId, input.lostReasonRequired);
      const after = await this.repo.settings(tx, ctx.orgId);
      if (before.lostReasonRequired !== after.lostReasonRequired) {
        await this.audit.record(tx, {
          module: 'deal_settings',
          recordId: ctx.orgId,
          action: 'update',
          delta: {
            lostReasonRequired: { old: before.lostReasonRequired, new: after.lostReasonRequired },
          },
        });
        await this.outbox.emit(tx, {
          aggregateModule: 'deal_settings',
          aggregateId: ctx.orgId,
          eventType: 'deal_settings.updated',
          payload: { lostReasonRequired: after.lostReasonRequired },
        });
      }
      return after;
    });
  }
}
