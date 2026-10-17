'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  contactAttributionResponseSchema,
  createLeadSourceResponseSchema,
  fieldResponseSchema,
  leadEventDetailResponseSchema,
  leadEventListResponseSchema,
  leadMappingPreviewResponseSchema,
  leadSourceListResponseSchema,
  leadSourceResponseSchema,
  pageResponseSchema,
  pipelineResponseSchema,
  rotateLeadSourceTokenResponseSchema,
  sendTestLeadResponseSchema,
  statusOptionResponseSchema,
  wspMemberSchema,
  type CreateLeadSourceInput,
  type LeadEventStatus,
  type LeadSourceResponse,
  type LeadSourceSecretsResponse,
  type PreviewLeadMappingInput,
  type UpdateLeadSourceInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { MAPPABLE_FIELD_TYPES } from './lib/draft';

/**
 * Every call of the Social leads screens, through the same-origin proxy (`/api/v2/*`). Responses are parsed with the contract
 * schema at the boundary. The token and the shared secret are write only: `createSource` and `rotateToken` hand the one-time
 * token back separately from the source, so a caller can keep the source in the query cache and the token in component state.
 */

export const leadKeys = {
  all: ['lead-sources'] as const,
  list: ['lead-sources', 'list'] as const,
  one: (id: string) => ['lead-sources', 'one', id] as const,
  eventsOf: (id: string) => ['lead-sources', 'events', id] as const,
  events: (id: string, status: string, tests: string) =>
    ['lead-sources', 'events', id, status, tests] as const,
  event: (id: string, eventId: string) => ['lead-sources', 'event', id, eventId] as const,
  attribution: (contactId: string) => ['lead-sources', 'attribution', contactId] as const,
  members: ['lead-sources', 'picker', 'members'] as const,
  pipelines: ['lead-sources', 'picker', 'pipelines'] as const,
  stages: ['lead-sources', 'picker', 'lifecycle-stages'] as const,
  properties: ['lead-sources', 'picker', 'contact-properties'] as const,
  /** Meta lead forms: the overview (Pages and their sync state), one Page's forms, one form source's health. */
  meta: ['lead-sources', 'meta'] as const,
  metaForms: (pageId: string) => ['lead-sources', 'meta', 'forms', pageId] as const,
  metaHealth: (sourceId: string) => ['lead-sources', 'meta', 'health', sourceId] as const,
};

const ROOT = '/lead-sources';

// --- sources ------------------------------------------------------------------------------------------------------------------

/** The sources and whether the server can build a complete webhook address at all (`hookAddress`). */
export const fetchSources = (signal?: AbortSignal) =>
  apiFetch(ROOT, { schema: leadSourceListResponseSchema, signal });

export const fetchSource = (id: string, signal?: AbortSignal) =>
  apiFetch(`${ROOT}/${id}`, { schema: leadSourceResponseSchema, signal });

export interface WithSecrets {
  source: LeadSourceResponse;
  secrets: LeadSourceSecretsResponse;
}

/** Creates the source and splits the one-time token off the response. */
export async function createSource(body: CreateLeadSourceInput): Promise<WithSecrets> {
  const { token, hookPath, hookUrl, hookUrlProblem, ...source } = await apiFetch(ROOT, {
    method: 'POST',
    body,
    schema: createLeadSourceResponseSchema,
  });
  return { source, secrets: { token, hookPath, hookUrl, hookUrlProblem } };
}

export const updateSource = (id: string, body: UpdateLeadSourceInput) =>
  apiFetch(`${ROOT}/${id}`, { method: 'PATCH', body, schema: leadSourceResponseSchema });

/** 204: the source, its URL and its events are gone; the contacts it made stay. */
export const deleteSource = (id: string): Promise<void> =>
  apiFetch(`${ROOT}/${id}`, { method: 'DELETE' });

export async function rotateToken(id: string): Promise<WithSecrets> {
  const { token, hookPath, hookUrl, hookUrlProblem, ...source } = await apiFetch(
    `${ROOT}/${id}/rotate-token`,
    { method: 'POST', schema: rotateLeadSourceTokenResponseSchema },
  );
  return { source, secrets: { token, hookPath, hookUrl, hookUrlProblem } };
}

export const previewMapping = (id: string, body: PreviewLeadMappingInput, signal?: AbortSignal) =>
  apiFetch(`${ROOT}/${id}/mapping-preview`, {
    method: 'POST',
    body,
    schema: leadMappingPreviewResponseSchema,
    signal,
  });

/** A sample (omit `payload`) or the posted payload through the real pipeline, flagged as a test. */
export const sendTestLead = (id: string, payload?: Record<string, unknown>) =>
  apiFetch(`${ROOT}/${id}/test`, {
    method: 'POST',
    body: payload ? { payload } : {},
    schema: sendTestLeadResponseSchema,
  });

// --- events -------------------------------------------------------------------------------------------------------------------

export interface EventsQuery {
  status?: LeadEventStatus;
  isTest?: 'true' | 'false';
  limit?: number;
  cursor?: string;
}

export const fetchEvents = (id: string, q: EventsQuery, signal?: AbortSignal) =>
  apiFetch(`${ROOT}/${id}/events`, {
    query: { limit: 25, ...q },
    schema: leadEventListResponseSchema,
    signal,
  });

/** Audited: opening a stored payload writes an audit row, so it is called only when the person opens the event. */
export const fetchEvent = (id: string, eventId: string, signal?: AbortSignal) =>
  apiFetch(`${ROOT}/${id}/events/${eventId}`, { schema: leadEventDetailResponseSchema, signal });

/** The answer carries the event as it stands after the retry (the contracts have no schema of its own: it is the test answer's shape). */
export const retryEvent = (id: string, eventId: string) =>
  apiFetch(`${ROOT}/${id}/events/${eventId}/retry`, {
    method: 'POST',
    schema: sendTestLeadResponseSchema,
  });

// --- contact attribution ------------------------------------------------------------------------------------------------------

export const fetchAttribution = (contactId: string, signal?: AbortSignal) =>
  apiFetch(`/contacts/${contactId}/attribution`, {
    schema: contactAttributionResponseSchema,
    signal,
  });

// --- pickers (the same lists other screens use) ---------------------------------------------------------------------------------

/** Reads a cursor list to its end (bounded): these lists are short and a picker must never show half of one. */
async function allPages<T>(
  path: string,
  item: z.ZodType<T, z.ZodTypeDef, unknown>,
  query: Record<string, string | number | boolean | undefined>,
  signal?: AbortSignal,
): Promise<T[]> {
  const schema = pageResponseSchema(item);
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const page = await apiFetch(path, { query: { limit: 100, ...query, cursor }, schema, signal });
    out.push(...page.data);
    if (!page.page.hasMore || !page.page.nextCursor) break;
    cursor = page.page.nextCursor;
  }
  return out;
}

export interface Member {
  id: string;
  name: string;
  email: string;
}

/**
 * The workspace's active members (`/workspace/members`: any signed-in member may read it). The owner and notify pickers offer
 * these; the API accepts only active users and answers LEAD_DEFAULTS_INVALID otherwise.
 */
export const fetchMembers = async (signal?: AbortSignal): Promise<Member[]> =>
  (await allPages('/workspace/members', wspMemberSchema, {}, signal))
    .filter((m) => m.status === 'active')
    .map((m) => ({ id: m.id, name: m.fullName, email: m.email }));

export interface PipelineChoice {
  id: string;
  name: string;
  isDefault: boolean;
  stages: Array<{ id: string; name: string; kind: 'open' | 'won' | 'lost' }>;
}

export const fetchPipelines = async (signal?: AbortSignal): Promise<PipelineChoice[]> =>
  (await apiFetch('/pipelines', { schema: z.array(pipelineResponseSchema), signal })).map((p) => ({
    id: p.id,
    name: p.name,
    isDefault: p.isDefault,
    stages: [...p.stages]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
  }));

export interface StageChoice {
  /** What `defaults.lifecycleStage` holds. */
  value: string;
  label: string;
}

/** Contact lifecycle stages a lead can start in: active, and not a lost stage (the API refuses those). */
export const fetchLifecycleStages = async (signal?: AbortSignal): Promise<StageChoice[]> =>
  (await allPages('/status-options', statusOptionResponseSchema, { moduleKey: 'contacts' }, signal))
    .filter((o) => o.optionGroup === 'lifecycle_stage' && o.isActive && !o.isLost)
    .sort((a, b) => a.position - b.position)
    .map((o) => ({ value: o.value, label: o.label }));

export interface PropertyChoice {
  key: string;
  label: string;
}

/** Contact properties a lead can fill: the ones `/fields` hands out, active, custom, of a type that can take a mapped value. */
export const fetchContactProperties = async (signal?: AbortSignal): Promise<PropertyChoice[]> =>
  (await allPages('/fields', fieldResponseSchema, { moduleKey: 'contacts' }, signal))
    .filter((f) => f.isActive && !f.isSystem && MAPPABLE_FIELD_TYPES.has(f.fieldType))
    .map((f) => ({ key: f.key, label: f.label }));

const PICKER_STALE = 5 * 60_000;

export const useMembers = (enabled = true) =>
  useQuery({
    queryKey: leadKeys.members,
    queryFn: ({ signal }) => fetchMembers(signal),
    staleTime: PICKER_STALE,
    retry: false,
    enabled,
  });

export const usePipelines = (enabled = true) =>
  useQuery({
    queryKey: leadKeys.pipelines,
    queryFn: ({ signal }) => fetchPipelines(signal),
    staleTime: PICKER_STALE,
    retry: false,
    enabled,
  });

export const useLifecycleStages = (enabled = true) =>
  useQuery({
    queryKey: leadKeys.stages,
    queryFn: ({ signal }) => fetchLifecycleStages(signal),
    staleTime: PICKER_STALE,
    retry: false,
    enabled,
  });

export const useContactProperties = (enabled = true) =>
  useQuery({
    queryKey: leadKeys.properties,
    queryFn: ({ signal }) => fetchContactProperties(signal),
    staleTime: PICKER_STALE,
    retry: false,
    enabled,
  });

/**
 * A contact's lead attribution (first and latest touch). Failing quietly (`retry: false`) is deliberate: a contact page must look
 * the same for someone without access, on a plan without the lead pipeline, or against a server that lacks the route.
 */
export function useContactAttribution(contactId: string, enabled = true) {
  return useQuery({
    queryKey: leadKeys.attribution(contactId),
    queryFn: ({ signal }) => fetchAttribution(contactId, signal),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}
