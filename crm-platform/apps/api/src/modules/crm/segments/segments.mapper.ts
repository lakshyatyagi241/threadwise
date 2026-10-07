import type {
  InvalidCondition,
  SegmentResponse,
  SegmentRules,
  SegmentSharedWith,
} from '@crm/contracts';
import type { SegmentRow } from './segments.repository';

/** The people and teams of one segment as the repository reads them. */
export interface SegmentShareView {
  users: Array<{ uuid: string; name: string; email: string }>;
  teams: Array<{ uuid: string; name: string; memberCount: number }>;
}

export const NO_SHARES: SegmentShareView = { users: [], teams: [] };

const toSharedWith = (v: SegmentShareView, canEdit: boolean): SegmentSharedWith => ({
  users: v.users.map((u) => ({ id: u.uuid, name: u.name, email: canEdit ? u.email : null })),
  teams: v.teams.map((t) => ({ id: t.uuid, name: t.name, memberCount: t.memberCount })),
});

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
  shares: SegmentShareView = NO_SHARES,
): SegmentResponse {
  return {
    id: row.uuid,
    name: row.name,
    description: row.description,
    color: row.color,
    visibility: row.visibility,
    sharedWith: toSharedWith(shares, canEdit),
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
