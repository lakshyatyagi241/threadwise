import type { ContactResponse } from '@crm/contracts';
import type { ContactRow } from './contacts.repository';

/**
 * Row -> API shape.
 *
 * This is where the two conventions meet: snake_case internals become
 * camelCase, and internal bigint ids are replaced by uuids. Nothing outside
 * this function is allowed to put an internal id in a response — keeping the
 * translation in one place is what makes that rule checkable.
 */
export function toContactResponse(row: ContactRow): ContactResponse {
  return {
    id: row.uuid,
    displayId: row.displayId,
    name: row.name,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
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
    leadScore: row.leadScore,
    whatsappSubscriptionStatus: row.whatsappSubscriptionStatus,
    smsSubscriptionStatus: row.smsSubscriptionStatus,
    emailSubscriptionStatus: row.emailSubscriptionStatus,
    emailConfirmed: row.emailConfirmed,
    faxNumber: row.faxNumber,
    lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
    customFields: row.data ?? {},
    isArchived: row.isArchived,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
