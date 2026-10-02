import { Injectable } from '@nestjs/common';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import type { StageRow } from '../pipelines/pipelines.repository';
import { DealActivitiesRepository } from './deal-activities.repository';
import { lostReasonAfter, statusTransition, stampsForKind } from './deal-rules';
import { dealEventPayload } from './deals.mapper';
import { DealsRepository, type DealRow } from './deals.repository';

export const DEAL_MODULE = 'deals';

/** A reason as the deal keeps it: the text (a catalogue name or free text) and the catalogue row when there is one. */
export interface LostReasonValue {
  text: string;
  id: number | null;
}

/**
 * The stage-change engine (WD-DEAL-008). Every writer that puts a deal in a stage (create, drag, mark won/lost, reopen, a stage
 * or pipeline delete that moves its deals) goes through here, so status, stamps, the timeline row, the audit row and the
 * outbox events always agree and are written in the caller's transaction.
 *
 * WaDesk fired these from model hooks and only on update: the first placement of a deal was never logged and never started a
 * flow. Here a create is a placement too (`deal.created` + `deal.stage_changed` with no `fromStageId`).
 */
@Injectable()
export class DealEngine {
  constructor(
    private readonly deals: DealsRepository,
    private readonly activities: DealActivitiesRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Moves a locked deal into `target` (any stage of any pipeline of the workspace; the caller has already checked it may).
   * A move to the stage the deal is already in is not a stage change: the caller reorders instead.
   */
  async changeStage(
    tx: Tx,
    deal: DealRow,
    target: StageRow,
    opts: { sortOrder: bigint; lostReason?: LostReasonValue | null },
  ): Promise<DealRow> {
    const ctx = RequestContextStore.require();
    const stamps = stampsForKind(
      target.kind,
      { status: deal.status, wonAt: deal.wonAt, lostAt: deal.lostAt },
      new Date(),
    );
    const reasonText = lostReasonAfter(
      target.kind,
      deal.lostReason,
      deal.status,
      opts.lostReason?.text ?? null,
    );
    const reasonId =
      target.kind !== 'lost'
        ? null
        : opts.lostReason
          ? opts.lostReason.id
          : deal.status === 'lost'
            ? deal.lostReasonId
            : null;

    const ok = await this.deals.update(tx, ctx.orgId, deal.id, undefined, {
      pipeline_id: target.pipelineId,
      stage_id: target.id,
      status: stamps.status,
      won_at: stamps.wonAt,
      lost_at: stamps.lostAt,
      lost_reason: reasonText,
      lost_reason_id: reasonId,
      sort_order: opts.sortOrder,
    });
    if (!ok) throw new Error('deal vanished while locked');

    const after = (await this.deals.findById(tx, ctx.orgId, deal.id))!;
    const from = { id: deal.stageUuid, name: deal.stageName };
    const to = { id: target.uuid, name: target.name };

    await this.activities.insert(tx, ctx.orgId, {
      dealId: deal.id,
      userId: ctx.userId,
      type: 'stage_change',
      bodyCipher: null,
      meta: { from, to },
    });
    await this.audit.record(tx, {
      module: DEAL_MODULE,
      recordId: deal.id,
      action: 'update',
      delta: {
        stage: { old: from.name, new: to.name },
        ...(deal.status !== after.status
          ? { status: { old: deal.status, new: after.status } }
          : {}),
        ...(deal.lostReason !== after.lostReason
          ? { lostReason: { old: deal.lostReason, new: after.lostReason } }
          : {}),
        ...(deal.pipelineId !== after.pipelineId
          ? { pipeline: { old: deal.pipelineName, new: after.pipelineName } }
          : {}),
      },
    });
    await this.emitMove(tx, deal, after, from.id);
    return after;
  }

  /** The placement of a brand-new deal: a timeline row and the creation events. `after` is the row as inserted. */
  async recordCreated(tx: Tx, after: DealRow): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.activities.insert(tx, ctx.orgId, {
      dealId: after.id,
      userId: ctx.userId,
      type: 'stage_change',
      bodyCipher: null,
      meta: { from: null, to: { id: after.stageUuid, name: after.stageName } },
    });
    await this.audit.record(tx, { module: DEAL_MODULE, recordId: after.id, action: 'insert' });
    await this.outbox.emit(tx, {
      aggregateModule: DEAL_MODULE,
      aggregateId: after.id,
      eventType: 'deal.created',
      payload: dealEventPayload(after),
    });
    await this.outbox.emit(tx, {
      aggregateModule: DEAL_MODULE,
      aggregateId: after.id,
      eventType: 'deal.stage_changed',
      payload: {
        ...dealEventPayload(after),
        fromStageId: null,
        toStageId: after.stageUuid,
        previousStatus: null,
      },
    });
    const outcome = statusTransition(null, after.status);
    if (outcome) {
      await this.outbox.emit(tx, {
        aggregateModule: DEAL_MODULE,
        aggregateId: after.id,
        eventType: `deal.${outcome}`,
        payload: { ...dealEventPayload(after), lostReason: after.lostReason },
      });
    }
  }

  private async emitMove(
    tx: Tx,
    before: DealRow,
    after: DealRow,
    fromStageUuid: string,
  ): Promise<void> {
    await this.outbox.emit(tx, {
      aggregateModule: DEAL_MODULE,
      aggregateId: after.id,
      eventType: 'deal.stage_changed',
      payload: {
        ...dealEventPayload(after),
        fromStageId: fromStageUuid,
        toStageId: after.stageUuid,
        previousStatus: before.status,
        fromPipelineId: before.pipelineUuid,
      },
    });
    const outcome = statusTransition(before.status, after.status);
    if (outcome) {
      await this.outbox.emit(tx, {
        aggregateModule: DEAL_MODULE,
        aggregateId: after.id,
        eventType: `deal.${outcome}`,
        payload: {
          ...dealEventPayload(after),
          lostReason: after.lostReason,
          previousStatus: before.status,
        },
      });
    }
  }
}
