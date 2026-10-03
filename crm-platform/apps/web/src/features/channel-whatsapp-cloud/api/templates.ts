import { apiFetch } from '@/lib/api/client';
import { templateDetailSchema, templateListSchema } from './pending-contracts';

/** The template library, read-only: the inbox picks an approved template, it never edits one (`/templates` is the library's own screen). */
export const templatesApi = {
  /** Approved templates, newest first, optionally narrowed by a word of the name. */
  approved: (q: string, cursor: string | null, signal?: AbortSignal) =>
    apiFetch('/templates', {
      query: {
        status: 'approved',
        limit: 30,
        q: q.trim() || undefined,
        cursor: cursor ?? undefined,
      },
      schema: templateListSchema,
      signal,
    }),
  get: (id: string, signal?: AbortSignal) =>
    apiFetch(`/templates/${id}`, { schema: templateDetailSchema, signal }),
};
