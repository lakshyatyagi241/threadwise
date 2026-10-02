import type { LostReasonResponse, PipelineResponse, PipelineStageResponse } from '@crm/contracts';
import type { LostReasonRow, PipelineRow, StageRow } from './pipelines.repository';

export function toStageResponse(row: StageRow): PipelineStageResponse {
  return {
    id: row.uuid,
    pipelineId: row.pipelineUuid,
    name: row.name,
    color: row.color,
    probability: row.probability,
    kind: row.kind,
    sortOrder: row.sortOrder,
    dealCount: row.dealCount,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toPipelineResponse(row: PipelineRow, stages: StageRow[]): PipelineResponse {
  return {
    id: row.uuid,
    name: row.name,
    currency: row.currency,
    isDefault: row.isDefault,
    sortOrder: row.sortOrder,
    stages: stages.filter((s) => s.pipelineId === row.id).map(toStageResponse),
    dealCount: row.dealCount,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toLostReasonResponse(row: LostReasonRow): LostReasonResponse {
  return {
    id: row.uuid,
    name: row.name,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    dealCount: row.dealCount,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
