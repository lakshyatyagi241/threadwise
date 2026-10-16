import type { ContactResponse } from '@crm/contracts';
import type { ContactChip, ContactRow } from './contacts.repository';
import { maskPhone } from './phone-mask';

/**
 * Row -> API shape.
 *
 * This is where the two conventions meet: snake_case internals become
 * camelCase, and internal bigint ids are replaced by uuids. Nothing outside
 * this function is allowed to put an internal id in a response — keeping the
 * translation in one place is what makes that rule checkable.
 *
 * `canRevealPhone` (the caller's `contacts.phone.reveal` grant, resolved by
 * the service from the request's RBAC context) decides whether `phone` goes
 * out raw or masked. This is the ONLY point in the contacts read path where
 * the response body is built, which is what makes the masking a real
 * server-side control rather than something a client could bypass by reading
 * the network response — the raw number is simply never put in the payload
 * for a caller who lacks the grant.
 */
export function toContactResponse(
  row: ContactRow,
  opts?: { groups?: ContactChip[]; tags?: ContactChip[]; canRevealPhone?: boolean },
): ContactResponse {
  const chip = (c: ContactChip) => ({ id: c.uuid, name: c.name, color: c.color });
  return {
    id: row.uuid,
    displayId: row.displayId,
    name: row.name,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone && !opts?.canRevealPhone ? maskPhone(row.phone) : row.phone,
    companyId: row.companyUuid,
    ownerId: row.ownerUuid,
    lifecycleState: row.lifecycleState,
    lifecycleStage: row.lifecycleStage,
    lifecycleStageDate: row.lifecycleStageDate?.toISOString() ?? null,
    previousLifecycleStage: row.previousLifecycleStage,
    previousLifecycleStageDate: row.previousLifecycleStageDate?.toISOString() ?? null,
    status: row.status,
    lostReason: row.lostReason,
    otherLostReason: row.otherLostReason,
    wonAt: row.wonAt?.toISOString() ?? null,
    lostAt: row.lostAt?.toISOString() ?? null,
    leadScore: row.leadScore,
    leadScoreSource: row.leadScoreSource === 'ai' ? 'ai' : row.leadScore === null ? null : 'manual',
    leadScoreReasons: row.leadScoreSource === 'ai' ? (row.leadScoreReasons ?? []) : null,
    leadScoredAt: row.leadScoredAt?.toISOString() ?? null,
    leadScoreModel: row.leadScoreModel,
    whatsappSubscriptionStatus: row.whatsappSubscriptionStatus,
    smsSubscriptionStatus: row.smsSubscriptionStatus,
    emailSubscriptionStatus: row.emailSubscriptionStatus,
    emailConfirmed: row.emailConfirmed,
    faxNumber: row.faxNumber,
    dateOfBirth: row.dateOfBirth,
    isMinor: row.isMinor === true,
    lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
    customFields: row.data ?? {},
    source: row.source,
    isUnsubscribed: row.isUnsubscribed,
    isArchived: row.isArchived,
    ...(opts?.groups ? { groups: opts.groups.map(chip) } : {}),
    ...(opts?.tags ? { tags: opts.tags.map(chip) } : {}),
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
