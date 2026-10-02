import type { InvalidCondition, SegmentResponse, SegmentRules } from '@crm/contracts';
import type { SegmentRow } from './segments.repository';

export interface SegmentCountView {
  memberCount: number | null;
  countApproximate: boolean;
  memberCountAt: Date | null;
}

/** The only place a segment row becomes a response: uuids out, internal ids never. */
export function toSegmentResponse(
  row: SegmentRow,
  view: SegmentCountView,
  invalidConditions: InvalidCondition[],
  canEdit: boolean,
): SegmentResponse {
  return {
    id: row.uuid,
    name: row.name,
    description: row.description,
    color: row.color,
    visibility: row.visibility,
    ownerId: row.ownerUuid,
    ownerName: row.ownerName,
    rules: row.rules as SegmentRules,
    rulesVersion: row.rulesVersion,
    memberCount: view.memberCount,
    countApproximate: view.countApproximate,
    memberCountAt: view.memberCountAt ? view.memberCountAt.toISOString() : null,
    invalidConditions,
    canEdit,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
