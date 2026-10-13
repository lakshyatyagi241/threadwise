import { pageResponseSchema, tagResponseSchema } from '@crm/contracts';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';

/**
 * Labels are the tags of the conversation's contact: the same tags the Contacts screens show. These are the calls behind the
 * "Assign labels" sheet of a thread.
 */

const PAGE_LIMIT = 100;
const MAX_PAGES = 10;
const tagPageSchema = pageResponseSchema(tagResponseSchema);
const tagListSchema = z.array(tagResponseSchema);

/** Every tag of the workspace (needs `record.tags.read`), following the pages. */
export async function fetchAllTags(signal?: AbortSignal) {
  const tags: z.infer<typeof tagResponseSchema>[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const answer = await apiFetch('/v2/tags', {
      query: { limit: PAGE_LIMIT, cursor },
      schema: tagPageSchema,
      signal,
    });
    tags.push(...answer.data);
    if (!answer.page.hasMore || !answer.page.nextCursor) break;
    cursor = answer.page.nextCursor;
  }
  return tags;
}

export const fetchContactTags = (contactId: string, signal?: AbortSignal) =>
  apiFetch(`/v2/contacts/${contactId}/tags`, { schema: tagListSchema, signal });

/**
 * Puts a tag on the contact, by id or by name. A name that matches no tag makes a new one, which also needs
 * `record.tags.create`. Putting on a tag the contact already has changes nothing.
 */
export const attachContactTag = (
  contactId: string,
  tag: { tagId: string } | { name: string },
  idempotencyKey?: string,
) =>
  apiFetch(`/v2/contacts/${contactId}/tags`, {
    method: 'POST',
    body: tag,
    schema: tagResponseSchema,
    idempotencyKey,
  });

export const detachContactTag = (contactId: string, tagId: string) =>
  apiFetch(`/v2/contacts/${contactId}/tags/${tagId}`, { method: 'DELETE' });
