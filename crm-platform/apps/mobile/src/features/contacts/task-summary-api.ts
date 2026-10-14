import { taskPageResponseSchema } from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/**
 * The first page of a contact's tasks, for the Activity summary's count only — the same route the Tasks feature's own list
 * calls, read here independently so this feature does not import that one (features stay independent; a shared route is not
 * a shared module).
 */
export const listContactTasksForSummary = (
  contactId: string,
  limit: number,
  signal?: AbortSignal,
) =>
  apiFetch(`/v2/contacts/${encodeURIComponent(contactId)}/tasks`, {
    query: { status: 'all', limit },
    schema: taskPageResponseSchema,
    signal,
  });
