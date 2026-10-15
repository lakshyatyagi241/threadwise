import {
  contactResponseSchema,
  pageResponseSchema,
  tagResponseSchema,
  type CreateContactInput,
  type ListContactsQuery,
  type UpdateContactInput,
} from '@crm/contracts';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';

/**
 * The contact list answer. The contract has the type but no schema for it, so the schema is the shared page envelope around the
 * shared contact schema, plus the optional `meta.total` the API adds when asked.
 */
export const contactListSchema = pageResponseSchema(contactResponseSchema).extend({
  meta: z.object({ total: z.number(), approximate: z.boolean().optional() }).optional(),
});
export type ContactList = z.infer<typeof contactListSchema>;

/** The filters the app offers. Names and meanings are the API's (`listContactsQuerySchema`). */
export type ContactFilters = Pick<
  ListContactsQuery,
  | 'q'
  | 'lifecycleStage'
  | 'source'
  | 'unsubscribed'
  | 'ownerId'
  | 'unassigned'
  | 'createdFrom'
  | 'createdTo'
  | 'rules'
> & {
  /** Contacts owned by any of these people: their ids, comma-joined as the query string takes them. */
  ownerIds?: string;
};

export type ContactListParams = ContactFilters & { limit: number; cursor?: string };

/** One page of contacts, newest first, with each row's tags. */
export const listContacts = (params: ContactListParams, signal?: AbortSignal) =>
  apiFetch('/v2/contacts', {
    query: { ...params, expand: 'tags' },
    schema: contactListSchema,
    signal,
  });

export const getContact = (id: string, signal?: AbortSignal) =>
  apiFetch(`/v2/contacts/${id}`, { schema: contactResponseSchema, signal });

/**
 * What the create form sends: the contract's input, with `customFields` only for the properties the workspace requires (the app
 * does not edit the others yet), and left out when there are none.
 */
export type NewContact = Omit<CreateContactInput, 'customFields'> & {
  customFields?: Record<string, unknown>;
};

/**
 * Creates a contact. When the email or phone already belongs to a contact, the API answers with that one instead, so the caller
 * only ever needs the id of what comes back.
 */
export const createContact = (body: NewContact, idempotencyKey?: string) =>
  apiFetch('/v2/contacts', {
    method: 'POST',
    body,
    schema: contactResponseSchema,
    idempotencyKey,
  });

/** Changes a contact. `rowVersion` is the version that was read; a stale one is 409 ROW_VERSION_CONFLICT. */
export const updateContact = (id: string, body: UpdateContactInput, idempotencyKey?: string) =>
  apiFetch(`/v2/contacts/${id}`, {
    method: 'PATCH',
    body,
    schema: contactResponseSchema,
    idempotencyKey,
  });

const tagListSchema = z.array(tagResponseSchema);

export const getContactTags = (id: string, signal?: AbortSignal) =>
  apiFetch(`/v2/contacts/${id}/tags`, { schema: tagListSchema, signal });

/** Tags the contact by name; the API creates the tag when no tag has that name (it then needs the tag-create permission). */
export const attachContactTag = (id: string, name: string, idempotencyKey?: string) =>
  apiFetch(`/v2/contacts/${id}/tags`, {
    method: 'POST',
    body: { name },
    schema: tagResponseSchema,
    idempotencyKey,
  });

export const detachContactTag = (id: string, tagId: string) =>
  apiFetch(`/v2/contacts/${id}/tags/${tagId}`, { method: 'DELETE' });

/** Deletes the contact for good (the API does a hard delete). A contact outside the person's scope answers 404. */
export const deleteContact = (id: string) => apiFetch(`/v2/contacts/${id}`, { method: 'DELETE' });
