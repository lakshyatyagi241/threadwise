import type { ContactResponse } from '@crm/contracts';
import type { ContactChip, ContactRow } from './contacts.repository';

/**
 * Row -> API shape.
 *
 * This is where the two conventions meet: snake_case internals become
 * camelCase, and internal bigint ids are replaced by uuids. Nothing outside
 * this function is allowed to put an internal id in a response — keeping the
 * translation in one place is what makes that rule checkable.
 */
export function toContactResponse(
  row: ContactRow,
  chips?: { groups?: ContactChip[]; tags?: ContactChip[] },
): ContactResponse {
  const chip = (c: ContactChip) => ({ id: c.uuid, name: c.name, color: c.color });
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
    lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
    customFields: row.data ?? {},
    source: row.source,
    timezone: row.timezone,
    timezoneSource:
      row.timezone === null
        ? null
        : row.timezoneSource === 'import' || row.timezoneSource === 'api'
          ? row.timezoneSource
          : 'staff',
    isUnsubscribed: row.isUnsubscribed,
    isArchived: row.isArchived,
    ...(chips?.groups ? { groups: chips.groups.map(chip) } : {}),
    ...(chips?.tags ? { tags: chips.tags.map(chip) } : {}),
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
