import { minorToMajor, type DealResponse } from '@crm/contracts';
import type { DealRow } from './deals.repository';

export function toDealResponse(row: DealRow): DealResponse {
  return {
    id: row.uuid,
    title: row.title,
    pipeline: { id: row.pipelineUuid, name: row.pipelineName },
    stage: {
      id: row.stageUuid,
      name: row.stageName,
      color: row.stageColor,
      probability: row.stageProbability,
      kind: row.stageKind,
    },
    status: row.status,
    value: minorToMajor(row.valueMinor, row.currency),
    currency: row.currency,
    owner: row.ownerUuid ? { id: row.ownerUuid, name: row.ownerName ?? '' } : null,
    contact: row.contactUuid
      ? {
          id: row.contactUuid,
          name: row.contactName,
          phone: row.contactPhone,
          email: row.contactEmail,
        }
      : null,
    company: row.companyUuid ? { id: row.companyUuid, name: row.companyName ?? '' } : null,
    expectedCloseDate: row.expectedCloseDate,
    source: row.source,
    lostReason: row.lostReason,
    lostReasonId: row.lostReasonUuid,
    notes: row.notes,
    wonAt: row.wonAt ? row.wonAt.toISOString() : null,
    lostAt: row.lostAt ? row.lostAt.toISOString() : null,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The few fields an outbox event carries (identifiers and what a consumer decides on, not the whole row). */
export function dealEventPayload(row: DealRow): Record<string, unknown> {
  return {
    uuid: row.uuid,
    title: row.title,
    pipelineId: row.pipelineUuid,
    stageId: row.stageUuid,
    status: row.status,
    value: minorToMajor(row.valueMinor, row.currency),
    currency: row.currency,
    ownerId: row.ownerUuid,
    contactId: row.contactUuid,
    companyId: row.companyUuid,
    source: row.source,
  };
}
