import {
  assigneeResponseSchema,
  boardResponseSchema,
  boardStagePageResponseSchema,
  contactSelectItemSchema,
  dealActivityPageResponseSchema,
  dealActivityResponseSchema,
  dealResponseSchema,
  dealSettingsResponseSchema,
  lostReasonResponseSchema,
  pageResponseSchema,
  pipelineResponseSchema,
  type ActivityType,
  type CreateDealActivityInput,
  type CreateDealInput,
  type DealSource,
  type DealStatus,
  type MarkDealLostInput,
  type MoveDealStageInput,
  type UpdateDealInput,
} from '@crm/contracts';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';

/**
 * The filters the board and the list share. Names and meanings are the API's (`boardQuerySchema`, `listDealsQuerySchema`):
 * `unassigned` and `ownerId` are never sent together.
 */
export type DealFilters = {
  q?: string;
  ownerId?: string;
  unassigned?: boolean;
  source?: DealSource;
};

/** The flat list adds the status and a stage on top of the shared filters. */
export type DealListFilters = DealFilters & { status?: DealStatus; stageId?: string };

const dealPageSchema = pageResponseSchema(dealResponseSchema);

// --- pipelines, lost reasons, settings ---------------------------------------------------------------------------------------

const pipelineListSchema = z.array(pipelineResponseSchema);

/** Every pipeline with its stages, in order. Needs `record.pipelines.read`. */
export const listPipelines = (signal?: AbortSignal) =>
  apiFetch('/v2/pipelines', { schema: pipelineListSchema, signal });

const lostReasonListSchema = z.array(lostReasonResponseSchema);

/** The workspace's catalogue of reasons a deal is lost, active ones only (a picker). Needs `record.pipelines.read`. */
export const listLostReasons = (signal?: AbortSignal) =>
  apiFetch('/v2/deal-lost-reasons', {
    query: { activeOnly: true },
    schema: lostReasonListSchema,
    signal,
  });

/** Whether the workspace insists on a reason for a lost deal. Needs `record.pipelines.read`. */
export const getDealSettings = (signal?: AbortSignal) =>
  apiFetch('/v2/deal-settings', { schema: dealSettingsResponseSchema, signal });

// --- the board and the list --------------------------------------------------------------------------------------------------

/**
 * One pipeline's columns with their counts and totals, and the KPI strip. `limit` is the cards per column on this first page:
 * the app asks for one, since it shows one column at a time and pages that column with `listStageDeals`.
 */
export const getBoard = (
  params: DealFilters & { pipelineId?: string; limit: number },
  signal?: AbortSignal,
) => apiFetch('/v2/deals/board', { query: params, schema: boardResponseSchema, signal });

/** A page of one column, in the column's own order (the order cards were placed in). */
export const listStageDeals = (
  stageId: string,
  params: DealFilters & { limit: number; cursor?: string },
  signal?: AbortSignal,
) =>
  apiFetch(`/v2/deals/board/stages/${encodeURIComponent(stageId)}/deals`, {
    query: params,
    schema: boardStagePageResponseSchema,
    signal,
  });

/** A page of deals across the pipeline, newest first, for the list view. */
export const listDeals = (
  params: DealListFilters & { pipelineId?: string; limit: number; cursor?: string },
  signal?: AbortSignal,
) => apiFetch('/v2/deals', { query: params, schema: dealPageSchema, signal });

// --- one deal ----------------------------------------------------------------------------------------------------------------

export const getDeal = (id: string, signal?: AbortSignal) =>
  apiFetch(`/v2/deals/${encodeURIComponent(id)}`, { schema: dealResponseSchema, signal });

export const createDeal = (body: CreateDealInput, idempotencyKey?: string) =>
  apiFetch('/v2/deals', { method: 'POST', body, schema: dealResponseSchema, idempotencyKey });

/** Changes a deal's fields. `rowVersion` is the version that was read; a stale one is 409 ROW_VERSION_CONFLICT. */
export const updateDeal = (id: string, body: UpdateDealInput, idempotencyKey?: string) =>
  apiFetch(`/v2/deals/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body,
    schema: dealResponseSchema,
    idempotencyKey,
  });

/** Deletes a deal and its timeline (204, nothing comes back). */
export const deleteDeal = (id: string, idempotencyKey?: string) =>
  apiFetch(`/v2/deals/${encodeURIComponent(id)}`, { method: 'DELETE', idempotencyKey });

/** Moves a deal to a stage. Into a lost stage it may need a reason; the won and lost stamps follow the stage. */
export const moveDealStage = (id: string, body: MoveDealStageInput, idempotencyKey?: string) =>
  apiFetch(`/v2/deals/${encodeURIComponent(id)}/stage`, {
    method: 'PATCH',
    body,
    schema: dealResponseSchema,
    idempotencyKey,
  });

export const markDealWon = (id: string, rowVersion: number, idempotencyKey?: string) =>
  apiFetch(`/v2/deals/${encodeURIComponent(id)}/won`, {
    method: 'POST',
    body: { rowVersion },
    schema: dealResponseSchema,
    idempotencyKey,
  });

export const markDealLost = (id: string, body: MarkDealLostInput, idempotencyKey?: string) =>
  apiFetch(`/v2/deals/${encodeURIComponent(id)}/lost`, {
    method: 'POST',
    body,
    schema: dealResponseSchema,
    idempotencyKey,
  });

/** Puts a won or lost deal back into an open stage (the first open one unless a stage is named). */
export const reopenDeal = (
  id: string,
  body: { stageId?: string; rowVersion: number },
  idempotencyKey?: string,
) =>
  apiFetch(`/v2/deals/${encodeURIComponent(id)}/reopen`, {
    method: 'POST',
    body,
    schema: dealResponseSchema,
    idempotencyKey,
  });

// --- the timeline ------------------------------------------------------------------------------------------------------------

/** A page of the deal's timeline, newest first. */
export const listActivities = (
  dealId: string,
  params: { limit: number; cursor?: string; type?: ActivityType },
  signal?: AbortSignal,
) =>
  apiFetch(`/v2/deals/${encodeURIComponent(dealId)}/activities`, {
    query: params,
    schema: dealActivityPageResponseSchema,
    signal,
  });

export const addActivity = (
  dealId: string,
  body: CreateDealActivityInput,
  idempotencyKey?: string,
) =>
  apiFetch(`/v2/deals/${encodeURIComponent(dealId)}/activities`, {
    method: 'POST',
    body,
    schema: dealActivityResponseSchema,
    idempotencyKey,
  });

/** Marks a timeline task done, or opens it again. Either is harmless to repeat. */
export const setActivityDone = (
  dealId: string,
  activityId: string,
  done: boolean,
  idempotencyKey?: string,
) =>
  apiFetch(
    `/v2/deals/${encodeURIComponent(dealId)}/activities/${encodeURIComponent(activityId)}/${done ? 'complete' : 'reopen'}`,
    { method: 'POST', schema: dealActivityResponseSchema, idempotencyKey },
  );

// --- people ------------------------------------------------------------------------------------------------------------------

const assigneeListSchema = z.array(assigneeResponseSchema);

/** The active staff a deal can be given to. Needs the permission to read contacts: that is where the API keeps this list. */
export const listAssignees = (signal?: AbortSignal) =>
  apiFetch('/v2/contacts/assignees', { schema: assigneeListSchema, signal });

const contactChoiceListSchema = z.array(contactSelectItemSchema);

/** Contacts matching the words, for the "Customer" picker. */
export const searchContacts = (q: string, signal?: AbortSignal) =>
  apiFetch('/v2/contacts/select-data', {
    query: { q: q || undefined, limit: 20 },
    schema: contactChoiceListSchema,
    signal,
  });
