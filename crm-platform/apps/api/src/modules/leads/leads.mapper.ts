import {
  LEAD_HOOK_PATH_PREFIX,
  leadFieldMappingSchema,
  type AttributionTouch,
  type LeadEventResponse,
  type LeadSourceResponse,
} from '@crm/contracts';
import { defaultsOf } from './lead-rules';
import type { AttributionRow } from './lead-attributions.repository';
import type { LeadEventRow } from './lead-events.repository';
import type { LeadSourceRow } from './lead-sources.repository';

/**
 * The only place a database row becomes a response. Never carries `token_hash`, `secret_enc` or an internal id: a source shows "ends in
 * ####" and whether a secret is set, nothing it could be rebuilt from.
 */
export function toLeadSourceResponse(row: LeadSourceRow): LeadSourceResponse {
  const mapping = leadFieldMappingSchema.safeParse(row.mapping);
  return {
    id: row.uuid,
    kind: row.kind,
    providerKey: row.providerKey,
    name: row.name,
    status: row.status,
    tokenHint: row.tokenHint,
    tokenRotatedAt: row.tokenRotatedAt?.toISOString() ?? null,
    hasSecret: row.secretEnc !== null,
    externalIdPath: row.externalIdPath,
    mapping: mapping.success ? mapping.data : {},
    defaults: defaultsOf(row),
    rawRetentionDays: row.rawRetentionDays,
    lastEventAt: row.lastEventAt?.toISOString() ?? null,
    needsAttention: row.needsAttention,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The URL path of a hook: shown once, with the token that only create and rotate ever hold. */
export const hookPathFor = (token: string): string => `${LEAD_HOOK_PATH_PREFIX}${token}`;

export function toLeadEventResponse(row: LeadEventRow): LeadEventResponse {
  return {
    id: row.uuid,
    sourceId: row.sourceUuid,
    externalId: row.externalId,
    status: row.status,
    reason: row.reason,
    error: row.error,
    isTest: row.isTest,
    contactId: row.contactUuid,
    dealId: row.dealUuid,
    hasPayload: row.payload !== null,
    payloadExpiresAt: row.payload !== null ? (row.payloadExpiresAt?.toISOString() ?? null) : null,
    attempts: row.attempts,
    duplicateCount: row.duplicateCount,
    receivedAt: row.receivedAt.toISOString(),
    processedAt: row.processedAt?.toISOString() ?? null,
    firstReply: row.firstReply
      ? {
          channel: row.firstReply.channel,
          status: row.firstReply.status,
          reason: row.firstReply.reason,
          dueAt: row.firstReply.dueAt.toISOString(),
          sentAt: row.firstReply.sentAt?.toISOString() ?? null,
          attempts: row.firstReply.attempts,
        }
      : null,
  };
}

export function toAttributionTouch(row: AttributionRow): AttributionTouch {
  return {
    id: row.uuid,
    platform: row.platform,
    sourceLabel: row.sourceLabel,
    campaign: row.campaign,
    adset: row.adset,
    ad: row.ad,
    form: row.form,
    leadSourceId: row.leadSourceUuid,
    capturedAt: row.capturedAt.toISOString(),
  };
}
