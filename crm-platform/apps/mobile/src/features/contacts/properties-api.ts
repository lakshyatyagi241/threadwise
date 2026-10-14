import {
  assigneeResponseSchema,
  bulkResultSchema,
  fieldDependencyResponseSchema,
  fieldOptionResponseSchema,
  fieldResponseSchema,
  fieldSectionResponseSchema,
  pageResponseSchema,
  statusOptionResponseSchema,
  type FieldResponse,
  type FieldSectionResponse,
  type PageResponse,
  type SetContactAssigneeInput,
  type StatusOptionResponse,
} from '@crm/contracts';
import { z } from 'zod';
import { apiFetch, type ApiRequest } from '@/lib/api';

/**
 * The calls behind a contact's About tab: the workspace's property definitions, their options, the lifecycle stage and status
 * options, the people a contact can be assigned to, and the owner change. The contact itself is read and saved by `./api`.
 */

/** The registry answers in one page today; the loop keeps the screen right if the API ever starts to split it. */
const MAX_PAGES = 20;
const PAGE_LIMIT = 200;

const fieldPageSchema = pageResponseSchema(fieldResponseSchema);
const fieldSectionPageSchema = pageResponseSchema(fieldSectionResponseSchema);
const statusOptionPageSchema = pageResponseSchema(statusOptionResponseSchema);

async function allPages<Item>(
  path: string,
  query: NonNullable<ApiRequest<unknown>['query']>,
  schema: z.ZodType<PageResponse<Item>, z.ZodTypeDef, unknown>,
  signal?: AbortSignal,
): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const answer = await apiFetch(path, {
      query: { ...query, limit: PAGE_LIMIT, cursor },
      schema,
      signal,
    });
    items.push(...answer.data);
    if (!answer.page.hasMore || !answer.page.nextCursor) break;
    cursor = answer.page.nextCursor;
  }
  return items;
}

/**
 * Every property of the contacts module, the switched-off ones included: the screen hides those itself, and knowing their keys
 * is what lets it tell a hidden property from a value that never had a definition.
 */
export const listContactFields = (signal?: AbortSignal) =>
  allPages<FieldResponse>(
    '/v2/fields',
    { moduleKey: 'contacts', includeInactive: true },
    fieldPageSchema,
    signal,
  );

const dependencyListSchema = z.array(fieldDependencyResponseSchema);

/** The workspace's named groups for the contacts module, in the order they were set (the About tab's section headers). */
export const listFieldSections = (signal?: AbortSignal) =>
  allPages<FieldSectionResponse>(
    '/v2/field-sections',
    { moduleKey: 'contacts' },
    fieldSectionPageSchema,
    signal,
  );

/** Which property shows (and is asked for) only when another one holds a value: the rule a new contact's required properties follow. */
export const listContactFieldDependencies = (signal?: AbortSignal) =>
  apiFetch('/v2/fields/dependencies', {
    query: { moduleKey: 'contacts' },
    schema: dependencyListSchema,
    signal,
  });

const optionListSchema = z.array(fieldOptionResponseSchema);

/** The options of one property, for a select field whose definition did not carry them. */
export const listFieldOptions = (fieldId: string, signal?: AbortSignal) =>
  apiFetch(`/v2/fields/${fieldId}/options`, { schema: optionListSchema, signal });

/** Lifecycle stages, statuses and lost reasons (one list; the option group says which is which). */
export const listContactStatusOptions = (signal?: AbortSignal) =>
  allPages<StatusOptionResponse>(
    '/v2/status-options',
    { moduleKey: 'contacts' },
    statusOptionPageSchema,
    signal,
  );

const assigneeListSchema = z.array(assigneeResponseSchema);

/** The active staff a contact can be given to. */
export const listAssignees = (signal?: AbortSignal) =>
  apiFetch('/v2/contacts/assignees', { schema: assigneeListSchema, signal });

/**
 * Gives contacts to someone, or to no one with `ownerId: null`. The answer is a per-contact outcome: a contact that could not
 * be changed is in `failed` and the call still succeeds, so the caller reads the body.
 */
export const setContactAssignee = (body: SetContactAssigneeInput, idempotencyKey?: string) =>
  apiFetch('/v2/contacts/assignee', {
    method: 'POST',
    body,
    schema: bulkResultSchema,
    idempotencyKey,
  });
