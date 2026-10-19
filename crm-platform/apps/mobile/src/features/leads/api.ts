import {
  leadEventListResponseSchema,
  leadSourceListResponseSchema,
  leadSourceResponseSchema,
  sendTestLeadResponseSchema,
  type LeadEventStatus,
  type LeadSourceStatus,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/** Every lead source of the workspace, newest first, each with how many of its leads need attention. */
export const listLeadSources = (signal?: AbortSignal) =>
  apiFetch('/v2/lead-sources', { schema: leadSourceListResponseSchema, signal });

export const getLeadSource = (id: string, signal?: AbortSignal) =>
  apiFetch(`/v2/lead-sources/${id}`, { schema: leadSourceResponseSchema, signal });

/** Pauses or resumes a source. `rowVersion` is the version that was read; a stale one is 409 ROW_VERSION_CONFLICT. */
export const setLeadSourceStatus = (
  id: string,
  rowVersion: number,
  status: LeadSourceStatus,
  idempotencyKey?: string,
) =>
  apiFetch(`/v2/lead-sources/${id}`, {
    method: 'PATCH',
    body: { rowVersion, status },
    schema: leadSourceResponseSchema,
    idempotencyKey,
  });

export interface LeadEventParams {
  limit: number;
  cursor?: string;
  status?: LeadEventStatus;
}

/** One page of the leads a source received, newest first, with what became of each. No raw payloads. */
export const listLeadEvents = (sourceId: string, params: LeadEventParams, signal?: AbortSignal) =>
  apiFetch(`/v2/lead-sources/${sourceId}/events`, {
    query: { limit: params.limit, cursor: params.cursor, status: params.status },
    schema: leadEventListResponseSchema,
    signal,
  });

/** Runs a lead that needs review or failed through the source's current settings again. Answers `{ event }`: the lead as it is now. */
export const retryLeadEvent = (sourceId: string, eventId: string, idempotencyKey?: string) =>
  apiFetch(`/v2/lead-sources/${sourceId}/events/${eventId}/retry`, {
    method: 'POST',
    schema: sendTestLeadResponseSchema,
    idempotencyKey,
  });
