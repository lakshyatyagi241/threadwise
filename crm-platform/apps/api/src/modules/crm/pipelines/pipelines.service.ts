import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type CreatePipelineInput,
  type CreateStageInput,
  type DeletePipelineQuery,
  type DeleteStageQuery,
  type PipelineResponse,
  type PipelineStageResponse,
  type ReorderPipelinesInput,
  type ReorderStagesInput,
  type StageInput,
  type StageKind,
  type UpdatePipelineInput,
  type UpdateStageInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { onTop } from '../deals/deal-ordering';
import { DealEngine } from '../deals/deal-engine.service';
import { DealsPlan } from '../deals/deals-plan';
import { DealsRepository } from '../deals/deals.repository';
import { toPipelineResponse, toStageResponse } from './pipelines.mapper';
import {
  DEFAULT_LADDER,
  PipelinesRepository,
  type PipelineRow,
  type StageRow,
} from './pipelines.repository';

const MODULE_KEY = 'pipelines';
const STAGE_MODULE_KEY = 'pipeline_stages';

/** Postgres error fields, whether the driver error arrives bare or wrapped by the query layer. */
export function pgError(err: unknown): { code?: string; constraint?: string } {
  const e = err as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  };
  return { code: e.code ?? e.cause?.code, constraint: e.constraint ?? e.cause?.constraint };
}

/**
 * Pipelines and their stages (TW-DEAL-002, 041, 042, 044): the editor Reference documented and never built.
 *
 * Rules: exactly one default pipeline; at most one won and one lost stage per pipeline (won is 100%, lost 0%); names are
 * unique per pipeline / workspace ignoring case; a stage or pipeline that still holds deals is deleted only by moving them
 * (the foreign keys are NO ACTION, so the database refuses what this service forgets to check); the plan's `pipelines` cap
 * is enforced on create.
 */
@Injectable()
export class PipelinesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: PipelinesRepository,
    private readonly dealsRepo: DealsRepository,
    private readonly engine: DealEngine,
    private readonly plan: DealsPlan,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // --- pipelines -------------------------------------------------------------------------------------------------------

  async list(): Promise<PipelineResponse[]> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      let pipelines = await this.repo.listPipelines(tx, ctx.orgId);
      if (pipelines.length === 0) {
        // Every workspace is provisioned with one; this only covers a workspace somebody emptied by hand.
        await this.createDefault(tx, ctx.orgId);
        pipelines = await this.repo.listPipelines(tx, ctx.orgId);
      }
      const stages = await this.repo.stagesOf(
        tx,
        ctx.orgId,
        pipelines.map((p) => p.id),
      );
      return pipelines.map((p) => toPipelineResponse(p, stages));
    });
  }

  async get(uuid: string): Promise<PipelineResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.pipelineByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Pipeline', uuid);
      return toPipelineResponse(row, await this.repo.stagesOf(tx, ctx.orgId, [row.id]));
    });
  }

  async create(input: CreatePipelineInput): Promise<PipelineResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      await this.plan.lockPipelines(tx, ctx.orgId);
      await this.plan.assertCanAddPipeline(
        ctx.orgId,
        await this.repo.countPipelines(tx, ctx.orgId),
      );

      const ladder = normaliseLadder(input.stages ?? DEFAULT_LADDER);
      const existing = await this.repo.defaultPipeline(tx, ctx.orgId);
      const currency = input.currency ?? existing?.currency ?? 'INR';
      const makeDefault = input.isDefault === true || !existing;
      const sortOrder = (await this.repo.maxPipelineOrder(tx, ctx.orgId)) + 1;

      let created: { id: number; uuid: string };
      try {
        created = await tx.transaction(async (sp) => {
          if (makeDefault) await this.repo.clearDefault(sp, ctx.orgId);
          const p = await this.repo.insertPipeline(sp, ctx.orgId, {
            name: input.name,
            currency,
            isDefault: makeDefault,
            sortOrder,
          });
          for (const [i, s] of ladder.entries()) {
            await this.repo.insertStage(sp, ctx.orgId, { pipelineId: p.id, ...s, sortOrder: i });
          }
          return p;
        });
      } catch (err) {
        throw this.translateConflict(err, input.name);
      }

      await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'pipeline.created',
        payload: {
          uuid: created.uuid,
          name: input.name,
          currency,
          isDefault: makeDefault,
          stages: ladder.length,
        },
      });
      const row = (await this.repo.pipelineById(tx, ctx.orgId, created.id))!;
      return toPipelineResponse(row, await this.repo.stagesOf(tx, ctx.orgId, [row.id]));
    });
  }

  async update(uuid: string, input: UpdatePipelineInput): Promise<PipelineResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const existing = await this.repo.pipelineByUuid(tx, ctx.orgId, uuid, true);
      if (!existing) throw AppError.notFound('Pipeline', uuid);

      const patch: { name?: string; currency?: string; isDefault?: boolean } = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.currency !== undefined) patch.currency = input.currency;
      if (input.isDefault === true && !existing.isDefault) patch.isDefault = true;

      let updated: boolean;
      try {
        updated = await tx.transaction(async (sp) => {
          if (patch.isDefault) await this.repo.clearDefault(sp, ctx.orgId);
          return this.repo.updatePipeline(sp, ctx.orgId, existing.id, input.rowVersion, patch);
        });
      } catch (err) {
        throw this.translateConflict(err, input.name ?? existing.name);
      }
      if (!updated) throw AppError.rowVersionConflict('Pipeline');

      const after = (await this.repo.pipelineById(tx, ctx.orgId, existing.id))!;
      const delta = this.audit.diff(
        { name: existing.name, currency: existing.currency, isDefault: existing.isDefault },
        { name: after.name, currency: after.currency, isDefault: after.isDefault },
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
          eventType: 'pipeline.updated',
          payload: { uuid, name: after.name, currency: after.currency, isDefault: after.isDefault },
        });
      }
      return toPipelineResponse(after, await this.repo.stagesOf(tx, ctx.orgId, [after.id]));
    });
  }

  async reorder(input: ReorderPipelinesInput): Promise<PipelineResponse[]> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const all = await this.repo.listPipelines(tx, ctx.orgId);
      const ids = this.orderFrom(all, input.pipelineIds, (p) => p.uuid, 'pipelineIds');
      await this.repo.setPipelineOrder(tx, ctx.orgId, ids);
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: ids[0]!,
        eventType: 'pipeline.reordered',
        payload: { pipelineIds: input.pipelineIds },
      });
      const pipelines = await this.repo.listPipelines(tx, ctx.orgId);
      const stages = await this.repo.stagesOf(
        tx,
        ctx.orgId,
        pipelines.map((p) => p.id),
      );
      return pipelines.map((p) => toPipelineResponse(p, stages));
    });
  }

  async remove(uuid: string, query: DeletePipelineQuery): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const pipeline = await this.repo.pipelineByUuid(tx, ctx.orgId, uuid, true);
      if (!pipeline) throw AppError.notFound('Pipeline', uuid);
      if (pipeline.isDefault) {
        throw new AppError(
          ERROR_CODES.DEAL_PIPELINE_DEFAULT_PROTECTED,
          'The default pipeline cannot be deleted. Make another pipeline the default first.',
          HttpStatus.CONFLICT,
        );
      }

      let moved = 0;
      if (pipeline.dealCount > 0) {
        if (!query.moveDealsToPipelineId) {
          throw new AppError(
            ERROR_CODES.DEAL_PIPELINE_HAS_DEALS,
            `This pipeline holds ${pipeline.dealCount} deals. Choose a pipeline to move them to.`,
            HttpStatus.CONFLICT,
            [{ path: 'moveDealsToPipelineId', message: 'required' }],
          );
        }
        const target = await this.repo.pipelineByUuid(tx, ctx.orgId, query.moveDealsToPipelineId);
        if (!target) throw AppError.notFound('Pipeline', query.moveDealsToPipelineId);
        if (target.id === pipeline.id) {
          throw new AppError(
            ERROR_CODES.DEAL_PIPELINE_TARGET_INVALID,
            'Deals cannot be moved to the pipeline being deleted.',
            HttpStatus.CONFLICT,
          );
        }
        moved = await this.moveAllDeals(tx, pipeline, target);
      }

      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: pipeline.id,
        action: 'delete',
        delta: { name: { old: pipeline.name, new: null }, dealsMoved: { old: moved, new: 0 } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: pipeline.id,
        eventType: 'pipeline.deleted',
        payload: {
          uuid,
          name: pipeline.name,
          dealsMoved: moved,
          movedTo: query.moveDealsToPipelineId ?? null,
        },
      });
      await this.repo.deletePipeline(tx, ctx.orgId, pipeline.id);
    });
  }

  // --- stages ----------------------------------------------------------------------------------------------------------

  async createStage(pipelineUuid: string, input: CreateStageInput): Promise<PipelineStageResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const pipeline = await this.repo.pipelineByUuid(tx, ctx.orgId, pipelineUuid, true);
      if (!pipeline) throw AppError.notFound('Pipeline', pipelineUuid);
      const stages = await this.repo.stagesOf(tx, ctx.orgId, [pipeline.id]);
      if (stages.length >= 30) {
        throw AppError.validation('A pipeline can have at most 30 stages');
      }
      if (input.kind !== 'open' && stages.some((s) => s.kind === input.kind)) {
        throw kindTaken(input.kind);
      }
      const normalised = normaliseLadder([{ ...input }])[0]!;

      // Order: before the named stage; else after the last open stage so Won and Lost stay at the end of the ladder.
      let position: number;
      if (input.beforeStageId) {
        const before = stages.find((s) => s.uuid === input.beforeStageId);
        if (!before) throw AppError.notFound('Stage', input.beforeStageId);
        position = stages.indexOf(before);
      } else if (input.kind === 'open') {
        const lastOpen = stages.reduce((acc, s, i) => (s.kind === 'open' ? i : acc), -1);
        position = lastOpen + 1;
      } else {
        position = stages.length;
      }

      let created: { id: number; uuid: string };
      try {
        created = await tx.transaction((sp) =>
          this.repo.insertStage(sp, ctx.orgId, {
            pipelineId: pipeline.id,
            ...normalised,
            sortOrder: stages.length,
          }),
        );
      } catch (err) {
        throw this.translateStageConflict(err, input.name);
      }
      const ordered = stages.map((s) => s.id);
      ordered.splice(position, 0, created.id);
      await this.repo.setStageOrder(tx, ctx.orgId, pipeline.id, ordered);

      await this.audit.record(tx, {
        module: STAGE_MODULE_KEY,
        recordId: created.id,
        action: 'insert',
      });
      await this.outbox.emit(tx, {
        aggregateModule: STAGE_MODULE_KEY,
        aggregateId: created.id,
        eventType: 'pipeline_stage.created',
        payload: {
          uuid: created.uuid,
          pipelineId: pipelineUuid,
          name: input.name,
          kind: input.kind,
        },
      });
      return toStageResponse((await this.repo.stageById(tx, ctx.orgId, created.id))!);
    });
  }

  async updateStage(uuid: string, input: UpdateStageInput): Promise<PipelineStageResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const stage = await this.repo.stageByUuid(tx, ctx.orgId, uuid);
      if (!stage) throw AppError.notFound('Stage', uuid);
      // Serialize concurrent editors of one ladder on the pipeline row.
      await this.repo.pipelineByUuid(tx, ctx.orgId, stage.pipelineUuid, true);

      const kind: StageKind = input.kind ?? stage.kind;
      if (kind !== stage.kind) {
        if (stage.dealCount > 0) {
          throw new AppError(
            ERROR_CODES.DEAL_STAGE_HAS_DEALS,
            'A stage that holds deals cannot change between open, won and lost. Move its deals first.',
            HttpStatus.CONFLICT,
          );
        }
        if (kind !== 'open') {
          const stages = await this.repo.stagesOf(tx, ctx.orgId, [stage.pipelineId]);
          if (stages.some((s) => s.kind === kind && s.id !== stage.id)) throw kindTaken(kind);
        }
      }
      // A won stage is certain and a lost stage is not; a probability sent for either is ignored.
      const probability =
        kind === 'won'
          ? 100
          : kind === 'lost'
            ? 0
            : (input.probability ?? (kind !== stage.kind ? 0 : undefined));

      let updated: boolean;
      try {
        updated = await tx.transaction((sp) =>
          this.repo.updateStage(sp, ctx.orgId, stage.id, input.rowVersion, {
            name: input.name,
            color: input.color,
            probability,
            kind: kind !== stage.kind ? kind : undefined,
          }),
        );
      } catch (err) {
        throw this.translateStageConflict(err, input.name ?? stage.name);
      }
      if (!updated) throw AppError.rowVersionConflict('Stage');

      const after = (await this.repo.stageById(tx, ctx.orgId, stage.id))!;
      const delta = this.audit.diff(
        { name: stage.name, color: stage.color, probability: stage.probability, kind: stage.kind },
        { name: after.name, color: after.color, probability: after.probability, kind: after.kind },
      );
      if (Object.keys(delta).length > 0) {
        await this.audit.record(tx, {
          module: STAGE_MODULE_KEY,
          recordId: stage.id,
          action: 'update',
          delta,
        });
        await this.outbox.emit(tx, {
          aggregateModule: STAGE_MODULE_KEY,
          aggregateId: stage.id,
          eventType: 'pipeline_stage.updated',
          payload: { uuid, pipelineId: stage.pipelineUuid, name: after.name, kind: after.kind },
        });
      }
      return toStageResponse(after);
    });
  }

  async reorderStages(pipelineUuid: string, input: ReorderStagesInput): Promise<PipelineResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const pipeline = await this.repo.pipelineByUuid(tx, ctx.orgId, pipelineUuid, true);
      if (!pipeline) throw AppError.notFound('Pipeline', pipelineUuid);
      const stages = await this.repo.stagesOf(tx, ctx.orgId, [pipeline.id]);
      const ids = this.orderFrom(stages, input.stageIds, (s) => s.uuid, 'stageIds');
      await this.repo.setStageOrder(tx, ctx.orgId, pipeline.id, ids);
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: pipeline.id,
        eventType: 'pipeline.stages_reordered',
        payload: { uuid: pipelineUuid, stageIds: input.stageIds },
      });
      const row = (await this.repo.pipelineById(tx, ctx.orgId, pipeline.id))!;
      return toPipelineResponse(row, await this.repo.stagesOf(tx, ctx.orgId, [pipeline.id]));
    });
  }

  async removeStage(uuid: string, query: DeleteStageQuery): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const stage = await this.repo.stageByUuid(tx, ctx.orgId, uuid);
      if (!stage) throw AppError.notFound('Stage', uuid);
      // Serialize concurrent editors of one ladder on the pipeline row.
      await this.repo.pipelineByUuid(tx, ctx.orgId, stage.pipelineUuid, true);
      const stages = await this.repo.stagesOf(tx, ctx.orgId, [stage.pipelineId]);
      if (stages.length <= 1) {
        throw new AppError(
          ERROR_CODES.DEAL_STAGE_LAST,
          'A pipeline needs at least one stage.',
          HttpStatus.CONFLICT,
        );
      }

      let moved = 0;
      if (stage.dealCount > 0) {
        if (!query.moveDealsToStageId) {
          throw new AppError(
            ERROR_CODES.DEAL_STAGE_HAS_DEALS,
            `This stage holds ${stage.dealCount} deals. Choose a stage to move them to.`,
            HttpStatus.CONFLICT,
            [{ path: 'moveDealsToStageId', message: 'required' }],
          );
        }
        const target = await this.repo.stageByUuid(tx, ctx.orgId, query.moveDealsToStageId);
        if (!target) throw AppError.notFound('Stage', query.moveDealsToStageId);
        if (target.pipelineId !== stage.pipelineId || target.id === stage.id) {
          throw new AppError(
            ERROR_CODES.DEAL_STAGE_MISMATCH,
            'Deals can only move to another stage of the same pipeline.',
            HttpStatus.UNPROCESSABLE_ENTITY,
            [{ path: 'moveDealsToStageId', message: 'not another stage of this pipeline' }],
          );
        }
        for (const dealId of await this.repo.dealIdsInStage(tx, ctx.orgId, stage.id)) {
          const deal = await this.dealsRepo.findById(tx, ctx.orgId, dealId, true);
          if (!deal) continue;
          const top = onTop(await this.dealsRepo.minOrder(tx, ctx.orgId, target.id, deal.id));
          await this.engine.changeStage(tx, deal, target, { sortOrder: top });
          moved++;
        }
      }

      await this.audit.record(tx, {
        module: STAGE_MODULE_KEY,
        recordId: stage.id,
        action: 'delete',
        delta: { name: { old: stage.name, new: null }, dealsMoved: { old: moved, new: 0 } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: STAGE_MODULE_KEY,
        aggregateId: stage.id,
        eventType: 'pipeline_stage.deleted',
        payload: {
          uuid,
          pipelineId: stage.pipelineUuid,
          name: stage.name,
          dealsMoved: moved,
          movedTo: query.moveDealsToStageId ?? null,
        },
      });
      await this.repo.deleteStage(tx, ctx.orgId, stage.id);
      await this.repo.setStageOrder(
        tx,
        ctx.orgId,
        stage.pipelineId,
        stages.filter((s) => s.id !== stage.id).map((s) => s.id),
      );
    });
  }

  // --- helpers ---------------------------------------------------------------------------------------------------------

  /** Moves every deal of `from` into `to`: open into the first open stage, won into its won stage, lost into its lost stage. */
  private async moveAllDeals(tx: Tx, from: PipelineRow, to: PipelineRow): Promise<number> {
    const ctx = RequestContextStore.require();
    const targetStages = await this.repo.stagesOf(tx, ctx.orgId, [to.id]);
    const byKind = new Map<StageKind, StageRow>();
    for (const s of targetStages) if (!byKind.has(s.kind)) byKind.set(s.kind, s);
    const fromStages = await this.repo.stagesOf(tx, ctx.orgId, [from.id]);
    for (const s of fromStages) {
      if (s.dealCount > 0 && !byKind.has(s.kind)) {
        throw new AppError(
          ERROR_CODES.DEAL_PIPELINE_TARGET_INVALID,
          `The target pipeline has no ${s.kind} stage for the ${s.kind} deals being moved.`,
          HttpStatus.CONFLICT,
          [{ path: 'moveDealsToPipelineId', message: `no ${s.kind} stage` }],
        );
      }
    }
    let moved = 0;
    for (const s of fromStages) {
      const target = byKind.get(s.kind);
      if (!target) continue;
      for (const dealId of await this.repo.dealIdsInStage(tx, ctx.orgId, s.id)) {
        const deal = await this.dealsRepo.findById(tx, ctx.orgId, dealId, true);
        if (!deal) continue;
        const top = onTop(await this.dealsRepo.minOrder(tx, ctx.orgId, target.id, deal.id));
        await this.engine.changeStage(tx, deal, target, { sortOrder: top });
        moved++;
      }
    }
    return moved;
  }

  /** The ids in the requested order, requiring the request to name exactly the rows that exist. */
  private orderFrom<T extends { id: number }>(
    existing: T[],
    requested: string[],
    uuidOf: (row: T) => string,
    field: string,
  ): number[] {
    const byUuid = new Map(existing.map((r) => [uuidOf(r), r.id]));
    const unique = new Set(requested);
    if (
      unique.size !== requested.length ||
      requested.length !== existing.length ||
      requested.some((u) => !byUuid.has(u))
    ) {
      throw new AppError(
        ERROR_CODES.DEAL_ORDER_INVALID,
        'Send every id exactly once, in the order you want.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: field, message: 'must list every existing item exactly once' }],
      );
    }
    return requested.map((u) => byUuid.get(u)!);
  }

  private async createDefault(tx: Tx, orgId: number): Promise<void> {
    const p = await this.repo.insertPipeline(tx, orgId, {
      name: 'Sales Pipeline',
      currency: 'INR',
      isDefault: true,
      sortOrder: 0,
    });
    for (const [i, s] of DEFAULT_LADDER.entries()) {
      await this.repo.insertStage(tx, orgId, { pipelineId: p.id, ...s, sortOrder: i });
    }
  }

  private translateConflict(err: unknown, name: string): unknown {
    const { code, constraint } = pgError(err);
    if (code === '23505' && constraint === 'uq_pipelines_org_lower_name') {
      return new AppError(
        ERROR_CODES.DEAL_PIPELINE_NAME_TAKEN,
        `A pipeline named "${name}" already exists.`,
        HttpStatus.CONFLICT,
      );
    }
    if (code === '23505' && constraint?.startsWith('uq_pipeline_stages_pipeline_lower_name')) {
      return new AppError(
        ERROR_CODES.DEAL_STAGE_NAME_TAKEN,
        'Two stages of a pipeline cannot share a name.',
        HttpStatus.CONFLICT,
      );
    }
    return err;
  }

  private translateStageConflict(err: unknown, name: string): unknown {
    const { code, constraint } = pgError(err);
    if (code === '23505') {
      if (constraint === 'uq_pipeline_stages_one_won') return kindTaken('won');
      if (constraint === 'uq_pipeline_stages_one_lost') return kindTaken('lost');
      if (constraint === 'uq_pipeline_stages_pipeline_lower_name') {
        return new AppError(
          ERROR_CODES.DEAL_STAGE_NAME_TAKEN,
          `This pipeline already has a stage named "${name}".`,
          HttpStatus.CONFLICT,
        );
      }
    }
    return err;
  }
}

function kindTaken(kind: StageKind): AppError {
  return new AppError(
    ERROR_CODES.DEAL_STAGE_KIND_TAKEN,
    `This pipeline already has a ${kind} stage.`,
    HttpStatus.CONFLICT,
  );
}

/**
 * A ladder as it will be stored. Rejects duplicate names (any case) and more than one won or lost stage up front, so the
 * caller gets one clear problem rather than a constraint violation halfway through the inserts. A won stage is 100%, a lost
 * stage 0%; an open stage without a probability starts at 0.
 */
export function normaliseLadder(
  stages: ReadonlyArray<
    Pick<StageInput, 'name'> & Partial<Pick<StageInput, 'color' | 'probability' | 'kind'>>
  >,
): Array<{ name: string; color: string; probability: number; kind: StageKind }> {
  const seen = new Set<string>();
  let won = 0;
  let lost = 0;
  return stages.map((s) => {
    const name = s.name.trim();
    const key = name.toLowerCase();
    if (seen.has(key)) {
      throw new AppError(
        ERROR_CODES.DEAL_STAGE_NAME_TAKEN,
        `Two stages are both named "${name}".`,
        HttpStatus.CONFLICT,
        [{ path: 'stages', message: name }],
      );
    }
    seen.add(key);
    const kind = s.kind ?? 'open';
    if (kind === 'won' && ++won > 1) throw kindTaken('won');
    if (kind === 'lost' && ++lost > 1) throw kindTaken('lost');
    return {
      name,
      color: s.color ?? '#6366F1',
      probability: kind === 'won' ? 100 : kind === 'lost' ? 0 : (s.probability ?? 0),
      kind,
    };
  });
}
